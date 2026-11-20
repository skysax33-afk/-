/**
 * トランジット通知Bot — interpret.gs（Step 3: 解釈文の生成）
 *
 * Step 2 のアスペクトを評価（調和/緊張の分類・重要度・テーマ別★・期間）し、定型文で通知文にする。
 *   evaluateDay(date) … 評価だけを行い、文章を含まない構造化データを返す
 *   renderMessage(ev) … 評価 → 通知文。将来 LLM に差し替えるときは、ここだけを置き換える
 * ※ ephemeris.gs / aspects.gs の定数・関数はトップレベルでは参照せず、関数の中でだけ使う。
 */

// ===== 評価の設定 =====
const HARMONY_ANGLES = [30, 60, 72, 120, 144];
const TENSION_ANGLES = [45, 90, 135, 150, 180];

// 合（0°）の分類はトランジット天体で決める（neutral は★に影響しない）
const CONJ_CATEGORY = {
  金星: 'harmony', 木星: 'harmony',
  火星: 'tension', 土星: 'tension', 天王星: 'tension', 海王星: 'tension', 冥王星: 'tension',
  太陽: 'neutral', 月: 'neutral', 水星: 'neutral',
};
const CATEGORY_SIGN = { harmony: 1, tension: -1, neutral: 0 };

const MAJOR_ANGLES = [0, 60, 90, 120, 180];
const SEPARATING_FACTOR = 0.8; // 分離中のアスペクトは重要度を0.8倍
const EXACT_ORB = 1 / 6;       // オーブがこれ未満（10′）なら「ほぼ正確」と書く

// 通知の各区分に載せる件数
const SECTION_COUNTS = { today: 1, good: 2, caution: 2, period: 2 };

// ★評価のテーマと、数える出生図の感受点
const THEMES = [
  { name: '仕事',          points: ['MC', '太陽', '土星', '水星'] },
  { name: '恋愛/人間関係', points: ['金星', '火星', '月'] },
  { name: '心',            points: ['月', '海王星', '冥王星'] },
  { name: '体調',          points: ['ASC', '火星', '太陽'] },
  { name: 'お金',          points: ['金星', '木星', '土星'] },
];

// 点数 → ★ の境界 [★2以上, ★3以上, ★4以上, ★5以上]
// test/calibrate_stars.js の出力を貼る（出生図・オーブ・重みを変えたら取り直す）
// 21915日分（2000〜2059年の毎朝7:00 JST）から算出。下位10%=★1・〜30%=★2・〜70%=★3・〜90%=★4・上位10%=★5
const STAR_THRESHOLDS = {
  '仕事': [-1.41, -0.56, 0.57, 1.42],
  '恋愛/人間関係': [-1.25, -0.5, 0.49, 1.25],
  '心': [-1.26, -0.48, 0.5, 1.2],
  '体調': [-1.11, -0.45, 0.45, 1.29],
  'お金': [-1.12, -0.46, 0.36, 1.11],
};

// 期間を探す範囲（日）。これを超えて続くものは「以前」「以降」と書く
const PERIOD_SEARCH_DAYS = 800;

// ===== 文章の部品 =====
// kw: 1行目に添える意味。harmony / tension / conj: 2行目の定型文（{area} に出生側の領域が入る）
const TRANSIT_TEXT = {
  太陽: {
    kw: '意識・活力',
    harmony: '{area}に自然と意識が向き、自分らしく力を発揮しやすい状態です。',
    tension: '{area}をめぐって、自分の意志と周りの状況がかみ合わず、葛藤を感じやすい状態です。',
    conj: '{area}に意識が集まり、そのテーマが自分にとって大きく感じられる状態です。',
  },
  月: {
    kw: '気分・感情',
    harmony: '{area}が満たされやすく、穏やかに過ごしやすい一日です。',
    tension: '{area}をめぐって心が揺れやすく、小さなことにも反応しやすい一日です。',
    conj: '{area}に意識が向きやすく、感情がいつもより表に出やすい一日です。',
  },
  水星: {
    kw: '思考・伝達',
    harmony: '{area}に関わることで頭がよく働き、考えを整理したり言葉にしたりしやすい状態です。',
    tension: '{area}をめぐって考えすぎたり、言葉の行き違いが起きたりしやすい状態です。',
    conj: '{area}について考えたり話したりする機会が増えやすい状態です。',
  },
  金星: {
    kw: '愛情・楽しみ',
    harmony: '{area}に心地よさや喜びを感じやすく、人とも和やかに関われる状態です。',
    tension: '{area}をめぐって、楽な方へ流されたり、好みや価値観のずれを感じたりしやすい状態です。',
    conj: '{area}に穏やかな喜びが加わり、楽しさや人との親しみを感じやすい状態です。',
  },
  火星: {
    kw: '行動力・意欲',
    harmony: '{area}に関わることへ意欲が湧き、無理なく行動に移しやすい状態です。',
    tension: '{area}をめぐって焦りや苛立ちが生じやすく、衝突や無理をしやすい状態です。',
    conj: '{area}に強い勢いが加わり、行動的になれる一方で、性急になりやすい状態です。',
  },
  木星: {
    kw: '拡大・成長',
    harmony: '{area}がゆるやかに広がり、伸ばしたり実らせたりしやすい時期です。',
    tension: '{area}をめぐって、楽観や手の広げすぎから行き過ぎが生じやすい時期です。',
    conj: '{area}に拡大の力が加わり、成長やチャンスの機会が巡りやすい時期です。',
  },
  土星: {
    kw: '責任・試練',
    harmony: '{area}が着実に固まり、地道な努力が形になりやすい時期です。',
    tension: '{area}をめぐって制限や重圧を感じやすく、見直しを迫られやすい時期です。',
    conj: '{area}が試され、責任や現実的な課題と正面から向き合うことになりやすい時期です。',
  },
  天王星: {
    kw: '変化・刺激',
    harmony: '{area}に新鮮な刺激が入り、前向きな変化を取り入れやすい時期です。',
    tension: '{area}をめぐって予想外の出来事や急な変化が起きやすく、落ち着かない時期です。',
    conj: '{area}に大きな変化の風が吹き、これまでの枠から抜け出したくなりやすい時期です。',
  },
  海王星: {
    kw: '理想・曖昧さ',
    harmony: '{area}に関わることで直感やイメージが冴え、物事を柔らかく受け止められる時期です。',
    tension: '{area}をめぐって迷いや思い込みが生じやすく、判断がぼやけやすい時期です。',
    conj: '{area}の輪郭がゆらぎ、理想と現実の境目があいまいになりやすい時期です。',
  },
  冥王星: {
    kw: '変容・深い力',
    harmony: '{area}に関わることで深いところから力が湧き、根本的な立て直しを進めやすい時期です。',
    tension: '{area}をめぐって強いこだわりや抗いがたい圧力を感じやすく、根本からの変化を迫られやすい時期です。',
    conj: '{area}が根底から作り変えられていく、大きな転換の時期です。',
  },
};

// kw: 1行目に添える意味 / area: 2行目の {area} に入る領域
const NATAL_TEXT = {
  太陽:   { kw: '自分らしさ・目標', area: '自分らしさや目標' },
  月:     { kw: '感情・安心感',     area: '気持ちや安心感' },
  水星:   { kw: '考え方・会話',     area: '考え方や会話' },
  金星:   { kw: '好み・親しみ',     area: '好きなことや人との親しみ' },
  火星:   { kw: 'やる気・行動',     area: 'やる気や行動' },
  木星:   { kw: '成長・楽観',       area: '成長や楽しみ' },
  土星:   { kw: '責任・積み重ね',   area: '責任や積み重ねてきたもの' },
  天王星: { kw: '自由・個性',       area: '自由や個性' },
  海王星: { kw: '理想・感受性',     area: '理想や感受性' },
  冥王星: { kw: 'こだわり・本質',   area: '深いこだわりや本質的な欲求' },
  ASC:    { kw: '体・第一印象',     area: '体調や周りに与える印象' },
  MC:     { kw: '仕事・社会的立場', area: '仕事や社会での立場' },
};

// ===== 評価 =====
/** 角度 → ASPECTS の要素 */
function aspectByAngle_(angle) {
  return ASPECTS.filter((a) => a.angle === angle)[0];
}

/** 重要度の重み: メジャー 1.0／150° 0.6／その他のマイナー 0.4 */
function aspectWeight_(angle) {
  if (MAJOR_ANGLES.indexOf(angle) >= 0) return 1.0;
  return angle === 150 ? 0.6 : 0.4;
}

/** アスペクト → 'harmony' | 'tension' | 'neutral' */
function aspectCategory_(hit) {
  if (hit.angle === 0) return CONJ_CATEGORY[hit.transit];
  return HARMONY_ANGLES.indexOf(hit.angle) >= 0 ? 'harmony' : 'tension';
}

/** 重要度 = アスペクトの重み × オーブの狭さ（1 − オーブ/許容オーブ）× 接近中かどうか */
function importance_(hit) {
  const limit = orbLimit_(aspectByAngle_(hit.angle), hit.transit, hit.natal);
  return aspectWeight_(hit.angle) * (1 - hit.orb / limit) * (hit.applying ? 1 : SEPARATING_FACTOR);
}

/** findAspects の結果に retro / category / score を足す */
function scoredAspects_(date, natal) {
  const pos = planetPositions(date);
  return findAspects(pos, natal).map((h) => {
    const item = Object.assign({}, h, { retro: pos[h.transit].retro });
    item.category = aspectCategory_(item);
    item.score = importance_(item);
    return item;
  });
}

/** テーマ別の点数 { 仕事: 点数, … }（調和は＋、緊張は−、中立は0） */
function themeRawScores_(items) {
  const out = {};
  THEMES.forEach((th) => {
    out[th.name] = items
      .filter((h) => th.points.indexOf(h.natal) >= 0)
      .reduce((sum, h) => sum + CATEGORY_SIGN[h.category] * h.score, 0);
  });
  return out;
}

/** 点数 → ★の数（1〜5） */
function starsOf_(theme, raw) {
  return 1 + STAR_THRESHOLDS[theme].filter((t) => raw >= t).length;
}

/** 各区分に載せるアスペクトを重要度の高い順に選ぶ */
function selectSections_(items) {
  const top = (list, n) => list.slice().sort((a, b) => b.score - a.score).slice(0, n);
  const group = (h) => ORB_GROUP[h.transit];
  const inner = items.filter((h) => group(h) === 'inner');
  return {
    today: top(items.filter((h) => group(h) === 'moon'), SECTION_COUNTS.today),
    good: top(inner.filter((h) => h.category === 'harmony'), SECTION_COUNTS.good),
    caution: top(inner.filter((h) => h.category === 'tension'), SECTION_COUNTS.caution),
    period: top(items.filter((h) => group(h) === 'outer'), SECTION_COUNTS.period),
  };
}

/**
 * アスペクトがオーブ内にある期間（同じ時刻で1日ずつ前後に探す）
 * @return {Object} { start, end, peak: Date, peakDays: 今日から何日後か, openStart, openEnd }
 */
function aspectPeriod_(hit, date, natal) {
  const limit = orbLimit_(aspectByAngle_(hit.angle), hit.transit, hit.natal);
  const dayAt = (k) => new Date(date.getTime() + k * 86400000);
  const orbAt = (k) => {
    const lon = planetLongitudes(dayAt(k))[hit.transit];
    return Math.abs(Math.abs(norm360(lon - natal[hit.natal] + 180) - 180) - hit.angle);
  };
  let peak = 0;
  let peakOrb = orbAt(0);
  const scan = (dir) => {
    let last = 0;
    for (let k = dir; Math.abs(k) <= PERIOD_SEARCH_DAYS; k += dir) {
      const orb = orbAt(k);
      if (orb > limit) return { last: last, open: false };
      last = k;
      if (orb < peakOrb) { peak = k; peakOrb = orb; }
    }
    return { last: last, open: true };
  };
  const back = scan(-1);
  const fwd = scan(1);
  return {
    start: dayAt(back.last), end: dayAt(fwd.last), peak: dayAt(peak), peakDays: peak,
    openStart: back.open, openEnd: fwd.open,
  };
}

/**
 * 1日分の評価（文章は含まない）
 * @return {Object} { date, stars: [{ theme, score, stars }], today, good, caution, period }
 *   today / good / caution / period は findAspects の要素に retro・category・score を足したもの。
 *   period の要素には期間 period: { start, end, peak, peakDays, openStart, openEnd } も付く
 */
function evaluateDay(date) {
  const natal = natalPoints_();
  const items = scoredAspects_(date, natal);
  const raw = themeRawScores_(items);
  const sec = selectSections_(items);
  sec.period.forEach((h) => { h.period = aspectPeriod_(h, date, natal); });
  return {
    date: date,
    stars: THEMES.map((th) => ({ theme: th.name, score: raw[th.name], stars: starsOf_(th.name, raw[th.name]) })),
    today: sec.today,
    good: sec.good,
    caution: sec.caution,
    period: sec.period,
  };
}

// ===== 文章化（定型文） =====
/** Date → JSTの { y, m, d, w（曜日） } */
function jst_(date) {
  const t = new Date(date.getTime() + 9 * 3600000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: '日月火水木金土'[t.getUTCDay()] };
}

/** Date → 「11/23」形式（基準日と年が違えば「2027/1/5」） */
function monthDay_(date, ref) {
  const a = jst_(date);
  return (a.y === jst_(ref).y ? '' : `${a.y}/`) + `${a.m}/${a.d}`;
}

/** 期間 → 「（10/28〜12/5頃、最も近づくのは11/23頃）」 */
function periodText_(p, ref) {
  const s = monthDay_(p.start, ref) + (p.openStart ? '以前' : '');
  const e = monthDay_(p.end, ref) + (p.openEnd ? '以降' : '');
  let peak = '今日が最も近い';
  if (p.peakDays > 0) peak = `最も近づくのは${monthDay_(p.peak, ref)}頃`;
  if (p.peakDays < 0) peak = `最も近づいたのは${monthDay_(p.peak, ref)}頃`;
  return `（${s}〜${e}頃、${peak}）`;
}

/** アスペクト1件 → [1行目（句点なし）, 2行目] */
function itemText_(hit) {
  const T = TRANSIT_TEXT[hit.transit];
  const N = NATAL_TEXT[hit.natal];
  const subject = `${hit.transit}（${T.kw}${hit.retro ? '・逆行中' : ''}）が、出生の${hit.natal}（${N.kw}）`;
  const exact = hit.orb < EXACT_ORB;
  let head;
  if (hit.angle === 0) {
    head = subject + (exact ? 'にほぼぴったり重なっています'
      : hit.applying ? 'に重なろうとしています' : 'に重なった後、離れつつあります');
  } else {
    const adj = hit.category === 'harmony' ? '調和的な' : '緊張をはらむ';
    head = `${subject}と${adj}${hit.angle}°（${hit.aspect}）` + (exact ? 'をほぼ正確に作っています'
      : hit.applying ? 'に近づいています' : 'から離れつつあります');
  }
  const body = T[hit.angle === 0 ? 'conj' : hit.category].replace('{area}', N.area);
  return [head, body];
}

/** 評価 → 通知文 */
function renderMessage(ev) {
  const d = jst_(ev.date);
  const lines = [`【${d.m}/${d.d}（${d.w}）の星回り】`, '', '■ テーマ別'];
  ev.stars.forEach((s) => lines.push(`${s.theme} ${'★'.repeat(s.stars)}${'☆'.repeat(5 - s.stars)}`));
  const section = (title, items) => {
    lines.push('', `■ ${title}`);
    if (!items.length) {
      lines.push('・目立つ配置はありません');
      return;
    }
    items.forEach((h) => {
      const [head, body] = itemText_(h);
      lines.push(`・${head}${h.period ? periodText_(h.period, ev.date) : ''}。`, `　→ ${body}`);
    });
  };
  section('今日の流れ', ev.today);
  section('追い風', ev.good);
  section('注意点', ev.caution);
  section('この時期のテーマ', ev.period);
  return lines.join('\n');
}

/** 指定日時の通知文 */
function dailyMessage(date) {
  return renderMessage(evaluateDay(date));
}

// ===== 動作確認用 =====
function testStep3() {
  Logger.log(dailyMessage(new Date()));
}
