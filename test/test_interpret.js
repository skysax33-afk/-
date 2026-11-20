/**
 * interpret.gs（Step 3: 解釈文の生成）のテスト
 *
 * 使い方（リポジトリ直下で）:
 *   node test/test_interpret.js        … NGがあれば終了コード1
 *
 * 1. 文章の部品: 全組み合わせ（10天体 × 12感受点 × 11アスペクト × 接近/分離/正確）で穴がないか
 * 2. 分類・重要度・テーマ点数・★・区分の選び方: 手計算ケース
 * 3. ★の分布: 2000〜2059年（5日おき）で ★1〜5 が 10/20/40/20/10% 付近か
 * 4. 期間: オーブに入る日・出る日が本当に境界になっているか
 * 5. 通知文: 2026-11-21 から1年分の毎朝7:00 JST で、崩れ・文字数を確認
 */
const vm = require('vm');
const { loadGas } = require('./run_gas.js');
const { rawScores, FROM, TO } = require('./calibrate_stars.js');

const ctx = loadGas();
const g = (expr) => vm.runInContext(expr, ctx);
const DAY = 86400000;

let allOk = true;
function check(ok, label, detail) {
  console.log(`  ${ok ? 'OK ' : 'NG '}${label}`);
  if (!ok && detail) console.log(`       ${detail}`);
  allOk = allOk && ok;
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
const broken = (s) => /undefined|NaN|null|\{|\}/.test(s);

// ===== 1. 文章の部品 =====
function testParts() {
  console.log('文章の部品');
  const PLANETS = g('PLANETS');
  const ASPECTS = g('ASPECTS');
  const TRANSIT_TEXT = g('TRANSIT_TEXT');
  const NATAL_TEXT = g('NATAL_TEXT');
  const natalNames = PLANETS.concat(['ASC', 'MC']);
  check(PLANETS.every((p) => TRANSIT_TEXT[p]), 'トランジット10天体すべてに文章がある');
  check(natalNames.every((p) => NATAL_TEXT[p]), '出生図の12感受点すべてに文章がある');
  check(g('THEMES').every((th) => th.points.every((p) => NATAL_TEXT[p])), '★テーマの感受点名がすべて正しい');
  const thr = g('STAR_THRESHOLDS');
  check(g('THEMES').every((th) => thr[th.name] && thr[th.name].length === 4
    && thr[th.name].every((v, i, a) => i === 0 || a[i - 1] < v)), '★の境界が全テーマにあり、小さい順に並んでいる');

  const itemText = g('itemText_');
  const category = g('aspectCategory_');
  let count = 0;
  const bad = [];
  PLANETS.forEach((t) => natalNames.forEach((n) => ASPECTS.forEach((a) => {
    [[true, 1], [false, 1], [true, 0.05]].forEach(([applying, orb]) => {
      const hit = { transit: t, natal: n, aspect: a.name, angle: a.angle, orb, applying, retro: false };
      hit.category = category(hit);
      const [head, body] = itemText(hit);
      count++;
      if (broken(head) || broken(body) || !body.includes(NATAL_TEXT[n].area) || !head.includes(t)) {
        bad.push(`${t}→${n} ${a.name}: ${head} / ${body}`);
      }
    });
  })));
  check(bad.length === 0, `全${count}通りの文章に崩れがない`, bad.slice(0, 3).join('\n       '));
}

// ===== 2. 手計算ケース =====
function testHandCases() {
  console.log('手計算ケース');
  const category = g('aspectCategory_');
  const cat = (transit, angle) => category({ transit, angle });
  check(cat('金星', 0) === 'harmony' && cat('木星', 0) === 'harmony', '合: 金星・木星は調和');
  check(['火星', '土星', '天王星', '海王星', '冥王星'].every((p) => cat(p, 0) === 'tension'), '合: 火星・土星・天王星・海王星・冥王星は緊張');
  check(['太陽', '月', '水星'].every((p) => cat(p, 0) === 'neutral'), '合: 太陽・月・水星は中立');
  check([30, 60, 72, 120, 144].every((a) => cat('火星', a) === 'harmony'), '30°・60°・72°・120°・144° は調和');
  check([45, 90, 135, 150, 180].every((a) => cat('金星', a) === 'tension'), '45°・90°・135°・150°・180° は緊張');

  // 重要度 = 重み × (1 − オーブ/許容) × (分離なら0.8)
  const imp = g('importance_');
  const cases = [
    ['火星 トライン 太陽・オーブ1.0・接近（許容3.0）', { transit: '火星', natal: '太陽', angle: 120, orb: 1.0, applying: true }, 1.0 * (1 - 1 / 3)],
    ['冥王星 30° 太陽・オーブ0.6・分離（許容1.0）', { transit: '冥王星', natal: '太陽', angle: 30, orb: 0.6, applying: false }, 0.4 * 0.4 * 0.8],
    ['金星 150° 水星・オーブ0.5・接近（許容1.5）', { transit: '金星', natal: '水星', angle: 150, orb: 0.5, applying: true }, 0.6 * (1 - 0.5 / 1.5)],
    ['月 合 月・オーブ0・正確（許容5.5、分離扱い）', { transit: '月', natal: '月', angle: 0, orb: 0, applying: false }, 1.0 * 1 * 0.8],
  ];
  cases.forEach(([label, hit, expected]) => {
    const got = imp(hit);
    check(near(got, expected), `重要度: ${label} = ${expected.toFixed(4)}`, `結果 ${got}`);
  });

  // テーマ点数（調和＋・緊張−・中立0、出生図側の感受点で数える）
  const raw = g('themeRawScores_')([
    { natal: '太陽', category: 'harmony', score: 0.5 },
    { natal: 'MC', category: 'tension', score: 0.2 },
    { natal: '月', category: 'neutral', score: 0.9 },
    { natal: '金星', category: 'harmony', score: 0.3 },
  ]);
  const expRaw = { 仕事: 0.3, '恋愛/人間関係': 0.3, 心: 0, 体調: 0.5, お金: 0.3 };
  check(Object.keys(expRaw).every((k) => near(raw[k], expRaw[k])), 'テーマ点数（太陽+0.5・MC−0.2・月 中立・金星+0.3）',
    JSON.stringify(raw));

  // ★: 境界ちょうどは上の★に入る
  const thr = g('STAR_THRESHOLDS')['仕事'];
  const stars = g('starsOf_');
  const got = [thr[0] - 1, thr[0], thr[1], (thr[1] + thr[2]) / 2, thr[2], thr[3], thr[3] + 1].map((v) => stars('仕事', v));
  check(JSON.stringify(got) === JSON.stringify([1, 2, 3, 3, 4, 5, 5]), '★: 境界ちょうどは上の★、範囲の外は★1/★5', JSON.stringify(got));

  // 区分の選び方
  const items = [
    { id: '月a', transit: '月', category: 'harmony', score: 0.3 },
    { id: '月b', transit: '月', category: 'tension', score: 0.5 },
    { id: '太陽合', transit: '太陽', category: 'neutral', score: 0.9 },
    { id: '火星調和', transit: '火星', category: 'harmony', score: 0.4 },
    { id: '金星調和', transit: '金星', category: 'harmony', score: 0.6 },
    { id: '水星調和', transit: '水星', category: 'harmony', score: 0.2 },
    { id: '火星緊張', transit: '火星', category: 'tension', score: 0.7 },
    { id: '木星', transit: '木星', category: 'harmony', score: 0.1 },
    { id: '土星', transit: '土星', category: 'tension', score: 0.3 },
    { id: '冥王星', transit: '冥王星', category: 'harmony', score: 0.2 },
  ];
  const sec = g('selectSections_')(items);
  const ids = (list) => list.map((h) => h.id).join(',');
  check(ids(sec.today) === '月b', '今日の流れ: 月だけから重要度1位（分類は問わない）', ids(sec.today));
  check(ids(sec.good) === '金星調和,火星調和', '追い風: 太陽〜火星の調和から上位2件（中立の合は入らない）', ids(sec.good));
  check(ids(sec.caution) === '火星緊張', '注意点: 太陽〜火星の緊張から上位（1件しかなければ1件）', ids(sec.caution));
  check(ids(sec.period) === '土星,冥王星', 'この時期のテーマ: 木星〜冥王星から上位2件', ids(sec.period));
}

// ===== 3. ★の分布 =====
function testDistribution() {
  console.log('★の分布（2000〜2059年・5日おき）');
  const scores = rawScores(ctx, FROM, TO, 5);
  const stars = g('starsOf_');
  const target = [10, 20, 40, 20, 10];
  g('THEMES').forEach((th) => {
    const n = [0, 0, 0, 0, 0];
    scores.forEach((s) => { n[stars(th.name, s[th.name]) - 1]++; });
    const pct = n.map((x) => (x / scores.length) * 100);
    const ok = pct.every((p, i) => Math.abs(p - target[i]) <= 3);
    check(ok, `${th.name}: ★1〜5 = ${pct.map((p) => p.toFixed(0)).join('/')}%（目標 10/20/40/20/10 ±3）`);
  });
}

// ===== 4. 期間 =====
function testPeriods() {
  console.log('期間（2000〜2059年の181日おき）');
  const natal = g('natalPoints_()');
  const lonAt = g('planetLongitudes');
  const limitOf = (h) => g('orbLimit_')(g('aspectByAngle_')(h.angle), h.transit, h.natal);
  const orbAt = (h, t) => {
    const sep = Math.abs((((lonAt(new Date(t))[h.transit] - natal[h.natal]) % 360) + 540) % 360 - 180);
    return Math.abs(sep - h.angle);
  };
  let n = 0;
  const bad = [];
  for (let t = FROM; t < TO; t += 181 * DAY) {
    g('evaluateDay')(new Date(t)).period.forEach((h) => {
      n++;
      const p = h.period;
      const limit = limitOf(h);
      const s = p.start.getTime();
      const e = p.end.getTime();
      const errs = [];
      if (!(s <= t && t <= e)) errs.push('今日が期間に入っていない');
      if (orbAt(h, s) > limit || orbAt(h, e) > limit) errs.push('始まり/終わりの日がオーブ外');
      if (!p.openStart && orbAt(h, s - DAY) <= limit) errs.push('始まりの前日もオーブ内');
      if (!p.openEnd && orbAt(h, e + DAY) <= limit) errs.push('終わりの翌日もオーブ内');
      if (orbAt(h, p.peak.getTime()) > orbAt(h, t) + 1e-12) errs.push('「最も近い日」が今日より遠い');
      if (p.peak.getTime() !== t + p.peakDays * DAY) errs.push('peakDays が peak と合わない');
      if (errs.length) bad.push(`${new Date(t).toISOString().slice(0, 10)} ${h.transit}→${h.natal} ${h.aspect}: ${errs.join('・')}`);
    });
  }
  check(bad.length === 0, `${n}件の期間で、始まり・終わりがオーブの境界と一致`, bad.slice(0, 3).join('\n       '));
}

// ===== 5. 通知文 =====
function testMessages() {
  console.log('通知文（2026-11-21 から365日・毎朝7:00 JST）');
  const start = Date.UTC(2026, 10, 20, 22, 0);
  const headings = ['■ テーマ別', '■ 今日の流れ', '■ 追い風', '■ 注意点', '■ この時期のテーマ'];
  const lens = [];
  const bad = [];
  const empty = { 今日の流れ: 0, 追い風: 0, 注意点: 0, この時期のテーマ: 0 };
  for (let i = 0; i < 365; i++) {
    const t = start + i * DAY;
    const msg = g('dailyMessage')(new Date(t));
    lens.push(Array.from(msg).length);
    if (broken(msg) || !headings.every((h) => msg.includes(h))) bad.push(new Date(t).toISOString().slice(0, 10));
    msg.split('\n■ ').slice(1).forEach((sec) => {
      const title = sec.split('\n')[0];
      if (title in empty && sec.includes('目立つ配置はありません')) empty[title]++;
    });
  }
  const max = Math.max(...lens);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  check(bad.length === 0, '崩れ（undefined・NaN・波かっこ）や見出しの抜けがない', bad.slice(0, 5).join(', '));
  check(max <= 5000, `文字数: 平均 ${avg.toFixed(0)} 字・最大 ${max} 字（LINE のテキスト上限 5000 字以内）`);
  console.log(`  「目立つ配置はありません」になった日数: ${Object.entries(empty).map(([k, v]) => `${k} ${v}`).join('／')}`);
}

testParts();
testHandCases();
testDistribution();
testPeriods();
testMessages();
process.exit(allOk ? 0 : 1);
