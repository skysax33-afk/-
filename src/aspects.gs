/**
 * トランジット通知Bot — aspects.gs（Step 2: アスペクト判定）
 *
 * トランジット10天体 × 出生図（10天体＋ASC＋MC）のアスペクトを判定する。
 * ephemeris.gs の planetPositions / planetLongitudes / angles / natalDate_ / NATAL / norm360 を使う。
 * ※ ファイルの読み込み順に依存しないよう、ephemeris.gs の定数・関数は
 *   トップレベルでは参照せず、関数の中でだけ使う。
 */

// ===== アスペクトとオーブ（度） =====
// orb はトランジット天体のグループ別の許容幅
//   moon  = 月
//   inner = 太陽・水星・金星・火星
//   outer = 木星・土星・天王星・海王星・冥王星
const ASPECTS = [
  { angle: 0,   name: 'コンジャンクション', orb: { moon: 5,   inner: 2.5, outer: 1.5 } },
  { angle: 30,  name: 'セミセクスタイル',   orb: { moon: 1.5, inner: 1,   outer: 0.5 } },
  { angle: 45,  name: 'セミスクエア',       orb: { moon: 1.5, inner: 1,   outer: 0.5 } },
  { angle: 60,  name: 'セクスタイル',       orb: { moon: 3,   inner: 2,   outer: 1 } },
  { angle: 72,  name: 'クインタイル',       orb: { moon: 1.5, inner: 1,   outer: 0.5 } },
  { angle: 90,  name: 'スクエア',           orb: { moon: 5,   inner: 2.5, outer: 1.5 } },
  { angle: 120, name: 'トライン',           orb: { moon: 5,   inner: 2.5, outer: 1.5 } },
  { angle: 135, name: 'セスキコードレート', orb: { moon: 1.5, inner: 1,   outer: 0.5 } },
  { angle: 144, name: 'バイクインタイル',   orb: { moon: 1.5, inner: 1,   outer: 0.5 } },
  { angle: 150, name: 'クインカンクス',     orb: { moon: 2,   inner: 1.5, outer: 1 } },
  { angle: 180, name: 'オポジション',       orb: { moon: 5,   inner: 2.5, outer: 1.5 } },
];

const ORB_GROUP = {
  月: 'moon',
  太陽: 'inner', 水星: 'inner', 金星: 'inner', 火星: 'inner',
  木星: 'outer', 土星: 'outer', 天王星: 'outer', 海王星: 'outer', 冥王星: 'outer',
};

// 出生図側がこの感受点のときはオーブを広げる（度）
const NATAL_ORB_BONUS = { 太陽: 0.5, 月: 0.5, ASC: 0.5, MC: 0.5 };

/** 出生図の感受点（10天体＋ASC＋MC）の黄経 { 太陽: 黄経, …, ASC, MC } */
function natalPoints_() {
  const date = natalDate_();
  const points = planetLongitudes(date);
  const ang = angles(date, NATAL.lat, NATAL.lon);
  points.ASC = ang.ASC;
  points.MC = ang.MC;
  return points;
}

/** アスペクト × トランジット天体 × 出生図の感受点 → 許容オーブ（度） */
function orbLimit_(aspect, transitName, natalName) {
  return aspect.orb[ORB_GROUP[transitName]] + (NATAL_ORB_BONUS[natalName] || 0);
}

/**
 * アスペクト判定
 * @param {Object} transit planetPositions() の戻り値 { 太陽: { lon, speed, retro }, … }
 * @param {Object} natal   { 太陽: 黄経, …, ASC: 黄経, MC: 黄経 }
 * @return {Array} [{ transit, natal, aspect, angle, orb, applying }]（オーブの小さい順）
 *   orb: 正確な角度からのずれ（度・0以上）／applying: true=接近・false=分離
 */
function findAspects(transit, natal) {
  const hits = [];
  Object.keys(transit).forEach((t) => {
    const { lon, speed } = transit[t];
    Object.keys(natal).forEach((n) => {
      const delta = norm360(lon - natal[n] + 180) - 180; // トランジット − 出生（-180〜180）
      const sep = Math.abs(delta);                         // 離角（0〜180）
      let best = null;
      ASPECTS.forEach((a) => {
        const orb = Math.abs(sep - a.angle);
        if (orb <= orbLimit_(a, t, n) && (!best || orb < best.orb)) best = { a, orb };
      });
      if (!best) return;
      // 出生図は動かないので、オーブの増減はトランジット天体の速度だけで決まる:
      //   d(離角)/dt = sign(delta) × speed
      //   d(オーブ)/dt = sign(離角 − アスペクト角) × d(離角)/dt  … 負なら接近
      const applying = Math.sign(sep - best.a.angle) * Math.sign(delta) * speed < 0;
      hits.push({
        transit: t, natal: n, aspect: best.a.name, angle: best.a.angle,
        orb: best.orb, applying: applying,
      });
    });
  });
  return hits.sort((x, y) => x.orb - y.orb);
}

/** 指定日時のトランジット × 出生図のアスペクト一覧 */
function transitAspects(date) {
  return findAspects(planetPositions(date), natalPoints_());
}

/** オーブ（度）→ 「1°05'」形式 */
function formatOrb(orb) {
  let deg = Math.floor(orb);
  let min = Math.round((orb - deg) * 60);
  if (min === 60) { deg += 1; min = 0; }
  return `${deg}°${String(min).padStart(2, '0')}'`;
}

// ===== 動作確認用 =====
function testStep2() {
  const now = new Date();
  const pos = planetPositions(now);
  const hits = findAspects(pos, natalPoints_());
  const lines = [`【トランジット → 出生図】${Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')}　${hits.length}件`];
  hits.forEach((h) => lines.push(
    `${h.transit}${pos[h.transit].retro ? '℞' : ''} ${h.aspect}（${h.angle}°） 出生の${h.natal}` +
    `　オーブ ${formatOrb(h.orb)} ${h.applying ? '接近' : '分離'}`));
  Logger.log(lines.join('\n'));
}
