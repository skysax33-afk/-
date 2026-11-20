/**
 * mail.gs（Step 4: メール送信）のテスト。MailApp / Session はスタブで、実際には送らない
 *
 * 使い方（リポジトリ直下で）:
 *   node test/test_mail.js        … NGがあれば終了コード1
 *
 * 1. 送信: 1回で1通、宛先は自分（Session のアドレス）、テキスト版は dailyMessage と同じ
 * 2. 件名: 日付・曜日（JST）と★の要約
 * 3. HTML: 見出し・件数・色・エスケープ・タグの対応
 * 4. 例外的な呼ばれ方: トリガーのイベントオブジェクト、宛先が取れないとき
 * 5. 1年分（2026-11-21から毎朝7:00 JST）: 崩れがなく、Gmail が本文を省略する102KBより小さい
 */
const vm = require('vm');
const { loadGas, STUB_EMAIL } = require('./run_gas.js');

const ctx = loadGas();
const g = (expr) => vm.runInContext(expr, ctx);
const DAY = 86400000;
const AT_0721 = Date.UTC(2026, 10, 20, 22, 0); // 2026-11-21 07:00 JST

let allOk = true;
function check(ok, label, detail) {
  console.log(`  ${ok ? 'OK ' : 'NG '}${label}`);
  if (!ok && detail) console.log(`       ${detail}`);
  allOk = allOk && ok;
}
const broken = (s) => /undefined|NaN|null|\[object/.test(s);
const count = (s, sub) => s.split(sub).length - 1;

/** スタブで1通送って、その記録を返す */
function send(arg) {
  ctx.__sent.length = 0;
  ctx.__arg = arg;
  const ret = g('sendDailyMail(__arg)');
  return { ret, mails: ctx.__sent.slice() };
}

function testSend() {
  console.log('送信');
  const date = new Date(AT_0721);
  const { ret, mails } = send(date);
  const m = mails[0] || {};
  check(mails.length === 1, '1回の呼び出しで1通だけ送る', `${mails.length}通`);
  check(m.to === STUB_EMAIL && ret.to === STUB_EMAIL, '宛先はスクリプトを動かす自分のアドレス（Session から取得）');
  check(m.options && m.options.name === g('MAIL_SENDER_NAME'), `差出人名は「${g('MAIL_SENDER_NAME')}」`);
  ctx.__d = date;
  check(m.body === g('dailyMessage(__d)'), 'テキスト版は Step 3 の通知文（dailyMessage）と同じ');
  check(m.options && typeof m.options.htmlBody === 'string' && m.options.htmlBody.length > 0, 'HTML 版が付いている');
  check(ret.subject === m.subject, '戻り値の件名が送った件名と同じ');
}

function testSubject() {
  console.log('件名');
  ctx.__d = new Date(AT_0721);
  const ev = g('evaluateDay(__d)');
  const subject = g('mailSubject_')(ev);
  const label = { '恋愛/人間関係': '恋愛' };
  const expected = '11/21（土）の星回り  ' + ev.stars.map((s) => `${label[s.theme] || s.theme}${s.stars}`).join(' ');
  check(subject === expected, `2026-11-21 07:00 JST →「${subject}」`, `期待: ${expected}`);
  check(/^\d{1,2}\/\d{1,2}（[日月火水木金土]）の星回り {2}仕事[1-5] 恋愛[1-5] 心[1-5] 体調[1-5] お金[1-5]$/.test(subject),
    '形式: 「M/D（曜）の星回り  仕事N 恋愛N 心N 体調N お金N」');
  // UTC では前日でも、JST の日付と曜日で書く
  ctx.__d = new Date(Date.UTC(2026, 10, 21, 23, 30)); // 2026-11-22 08:30 JST（日）
  const s2 = g('mailSubject_(evaluateDay(__d))');
  check(s2.startsWith('11/22（日）'), '日付と曜日は JST（UTC 11/21 23:30 →「11/22（日）」）', s2);
}

function testHtml() {
  console.log('HTML');
  ctx.__d = new Date(AT_0721);
  const ev = g('evaluateDay(__d)');
  const html = g('mailHtml_')(ev);
  const items = [].concat(ev.today, ev.good, ev.caution, ev.period);
  const colors = g('MAIL_COLORS');
  check(['テーマ別', '今日の流れ', '追い風', '注意点', 'この時期のテーマ'].every((h) => html.includes(`${h}</h3>`)), '5つの見出しがある');
  check(count(html, 'border-left:4px') === items.length, `アスペクトの件数（${items.length}件）だけ枠がある`);
  check(items.every((h) => html.includes(g('itemText_')(h)[1])), '各アスペクトの解説文が入っている');
  check(ev.stars.every((s) => html.includes(`${s.theme}</td>`)), '★のテーマが全部ある');
  check(count(html, '★') === ev.stars.reduce((a, s) => a + s.stars, 0)
    && count(html, '☆') === ev.stars.reduce((a, s) => a + 5 - s.stars, 0), '★と☆の数が評価と合う');
  check(items.every((h) => g('itemHtml_')(h, ev.date).includes(`border-left:4px solid ${colors[h.category]}`)),
    '枠の色: 調和=青・緊張=赤・中立=灰');
  check(ev.good.every((h) => h.category === 'harmony') && ev.caution.every((h) => h.category === 'tension'),
    '追い風は青・注意点は赤の枠だけになる（区分と分類が一致）');
  check(html.includes(`color:${colors.harmony};">追い風</h3>`) && html.includes(`color:${colors.tension};">注意点</h3>`),
    '見出しの色: 追い風=青・注意点=赤');
  check(ev.period.every((h) => html.includes(g('periodText_')(h.period, ev.date).slice(1, -1))), 'この時期のテーマに期間が入っている');
  check(count(html, '<div') === count(html, '</div>') && count(html, '<span') === count(html, '</span>')
    && count(html, '<tr>') === count(html, '</tr>'), 'div・span・tr の開始と終了の数が合う');
  check(!broken(html), '崩れ（undefined・NaN など）がない');
  check(g('escapeHtml_')('<b>"A&B"</b>') === '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;', 'HTML の特殊文字をエスケープする');
  const parts = g('itemTitleParts_')(Object.assign({}, ev.period[0] || ev.good[0], { retro: true, orb: 0.05 }));
  check(parts.length === 3 && parts[0].includes('（逆行中） → 出生の') && parts[2] === 'ほぼ正確',
    '見出し: 逆行中の表示と「ほぼ正確」', JSON.stringify(parts));
}

function testUnusualCalls() {
  console.log('例外的な呼ばれ方');
  // 時間主導型トリガーは関数にイベントオブジェクトを渡す → 現在時刻として扱う
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const today = `${nowJst.getUTCMonth() + 1}/${nowJst.getUTCDate()}（`;
  let r;
  try {
    r = send({ authMode: 'FULL', triggerUid: '12345' });
  } catch (e) {
    r = { error: e.message, mails: [] };
  }
  check(r.mails.length === 1 && r.mails[0].subject.startsWith(today),
    'トリガーのイベントオブジェクトが渡っても、現在時刻で1通送る', r.error || (r.mails[0] || {}).subject);
  check(send().mails.length === 1 && send().mails[0].subject.startsWith(today), '引数なしでも現在時刻で送る');

  // 宛先が取れないときは送らずにエラー
  const original = ctx.Session;
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => '' }) };
  let error = '';
  ctx.__sent.length = 0;
  try {
    g('sendDailyMail(new Date())');
  } catch (e) {
    error = e.message;
  }
  ctx.Session = original;
  check(error.includes('メールアドレスを取得できません') && ctx.__sent.length === 0, '宛先が取れないときは送らずにエラーにする', error);
}

function testYear() {
  console.log('1年分（2026-11-21 から365日・毎朝7:00 JST）');
  let maxHtml = 0;
  let maxSubject = 0;
  const bad = [];
  for (let i = 0; i < 365; i++) {
    const { mails } = send(new Date(AT_0721 + i * DAY));
    const m = mails[0];
    maxHtml = Math.max(maxHtml, Buffer.byteLength(m.options.htmlBody, 'utf8'));
    maxSubject = Math.max(maxSubject, Array.from(m.subject).length);
    if (broken(m.subject) || broken(m.body) || broken(m.options.htmlBody)) bad.push(new Date(AT_0721 + i * DAY).toISOString().slice(0, 10));
  }
  check(bad.length === 0, '件名・テキスト版・HTML 版に崩れがない', bad.slice(0, 5).join(', '));
  check(maxHtml < 102 * 1024, `HTML の最大 ${(maxHtml / 1024).toFixed(1)}KB（Gmail が本文を省略する102KB未満）`);
  console.log(`  件名の最大: ${maxSubject}字`);
}

testSend();
testSubject();
testHtml();
testUnusualCalls();
testYear();
process.exit(allOk ? 0 : 1);
