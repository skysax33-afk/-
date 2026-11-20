/**
 * src/*.gs を Node 上で実行するためのハーネス（GAS固有APIはスタブ）
 *
 * 使い方:
 *   node test/run_gas.js --call testStep1          … 任意のGAS関数を実行
 *   node test/run_gas.js --positions in.json out.json
 *       in.json  = { "lat": 35.0, "lon": 135.7, "timestamps": [ms, ...] }
 *       out.json = [ { "p": planetPositions(), "a": angles() }, ... ]
 *
 * Step 3 以降で UrlFetchApp / PropertiesService などを使うときは、
 * 下の ctx にスタブを足して Node 上で検証する。
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

function loadGas() {
  const ctx = {
    console,
    Logger: { log: (...args) => console.log(...args) },
    Utilities: { formatDate },
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
  } else {
    console.error('usage: node test/run_gas.js --call <fn> | --positions <in.json> <out.json>');
    process.exit(2);
  }
}

main();
