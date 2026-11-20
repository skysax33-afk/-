/**
 * src/*.gs を Node 上で実行するためのハーネス（GAS固有APIはスタブ）
 *
 * 使い方:
 *   node test/run_gas.js --call testStep1          … 任意のGAS関数を実行
 *   node test/run_gas.js --positions in.json out.json
 *       in.json  = { "lat": 35.0, "lon": 135.7, "timestamps": [ms, ...] }
 *       out.json = [ { "p": planetPositions(), "a": angles() }, ... ]
 *   node test/run_gas.js --aspects in.json out.json
 *       in.json  = { "timestamps": [ms, ...], "cases": [ { "transit": {...}, "natal": {...} }, ... ] }
 *       out.json = { "table": { aspects, group, bonus }, "natal": natalPoints_(),
 *                    "dates": [ transitAspects(), ... ], "cases": [ findAspects(), ... ] }
 *   node test/run_gas.js --message 2026-12-01T07:00+09:00
 *       … 指定日時の通知文（dailyMessage）を表示。日時を省略すると現在
 *   node test/run_gas.js --mail [日時] [出力.html]
 *       … sendDailyMail をスタブで実行（実際には送らない）。件名・テキスト版を表示し、
 *         HTML 版をファイルに書き出す（省略時 test/mail_preview.tmp.html。ブラウザで開いて確認）
 *
 * 他のテストからは require('./run_gas.js').loadGas() で GAS のコンテキストを作れる。
 * GAS のサービスは下の ctx のスタブで置き換える（MailApp は送らずに ctx.__sent に記録する）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

function formatDate(date, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
            .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
}

// スタブの送信先（実在しないアドレス）
const STUB_EMAIL = 'me@example.com';

function loadGas() {
  const sent = [];
  const ctx = {
    console,
    Logger: { log: (...args) => console.log(...args) },
    Utilities: { formatDate },
    MailApp: {
      sendEmail: (to, subject, body, options) => { sent.push({ to, subject, body, options }); },
      getRemainingDailyQuota: () => 100 - sent.length,
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => STUB_EMAIL }) },
    __sent: sent,
  };
  vm.createContext(ctx);
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort();
  files.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: `src/${f}` });
  });
  return ctx;
}

function main() {
  const [mode, a1, a2] = process.argv.slice(2);
  const ctx = loadGas();
  if (mode === '--call') {
    vm.runInContext(`${a1}()`, ctx);
  } else if (mode === '--positions') {
    const input = JSON.parse(fs.readFileSync(a1, 'utf8'));
    ctx.__input = input;
    const out = vm.runInContext(
      '__input.timestamps.map((t) => { const d = new Date(t); ' +
      'return { p: planetPositions(d), a: angles(d, __input.lat, __input.lon) }; })',
      ctx);
    fs.writeFileSync(a2, JSON.stringify(out));
  } else if (mode === '--aspects') {
    ctx.__input = JSON.parse(fs.readFileSync(a1, 'utf8'));
    const out = vm.runInContext(
      '({ table: { aspects: ASPECTS, group: ORB_GROUP, bonus: NATAL_ORB_BONUS }, natal: natalPoints_(), ' +
      'dates: (__input.timestamps || []).map((t) => transitAspects(new Date(t))), ' +
      'cases: (__input.cases || []).map((c) => findAspects(c.transit, c.natal)) })',
      ctx);
    fs.writeFileSync(a2, JSON.stringify(out));
  } else if (mode === '--message') {
    const date = a1 ? new Date(a1) : new Date();
    if (isNaN(date.getTime())) {
      console.error(`日時を読めません: ${a1}（例: 2026-12-01T07:00+09:00）`);
      process.exit(2);
    }
    ctx.__date = date;
    console.log(vm.runInContext('dailyMessage(__date)', ctx));
  } else if (mode === '--mail') {
    const date = a1 ? new Date(a1) : new Date();
    if (isNaN(date.getTime())) {
      console.error(`日時を読めません: ${a1}（例: 2026-12-01T07:00+09:00）`);
      process.exit(2);
    }
    ctx.__date = date;
    vm.runInContext('sendDailyMail(__date)', ctx);
    const mail = ctx.__sent[0];
    const out = a2 || path.join(__dirname, 'mail_preview.tmp.html');
    fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${mail.subject}</title>\n${mail.options.htmlBody}\n`);
    console.log(`宛先: ${mail.to}（スタブ）\n差出人名: ${mail.options.name}\n件名: ${mail.subject}\n`);
    console.log(mail.body);
    console.log(`\nHTML 版: ${out}`);
  } else {
    console.error('usage: node test/run_gas.js --call <fn> | --positions <in.json> <out.json>' +
                  ' | --aspects <in.json> <out.json> | --message [日時] | --mail [日時] [出力.html]');
    process.exit(2);
  }
}

module.exports = { loadGas, STUB_EMAIL };

if (require.main === module) main();
