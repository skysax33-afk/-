/**
 * トランジット通知Bot — ephemeris.gs（Step 1: 天体位置計算）
 *
 * 太陽〜冥王星の黄経（トロピカル・春分点は観測日の分点）と、
 * 出生図の ASC / MC を計算する。外部APIなし・GAS単体で完結。
 * 計算法: Paul Schlyter「How to compute planetary positions」準拠
 *        （月・木星・土星・天王星は摂動項込み、冥王星は1885〜2099年用の近似式）
 */

// ===== 出生データ =====
const NATAL = {
  year: 1998, month: 12, day: 28,
  hour: 13, minute: 8,
  tz: 9,                 // JST
  lat: 35.0116,          // 京都市中京区
  lon: 135.7681,
};

const PLANETS = ['太陽', '月', '水星', '金星', '火星', '木星', '土星', '天王星', '海王星', '冥王星'];
const SIGNS = ['牡羊座', '牡牛座', '双子座', '蟹座', '獅子座', '乙女座',
               '天秤座', '蠍座', '射手座', '山羊座', '水瓶座', '魚座'];

// ===== 数学ユーティリティ =====
const RAD = Math.PI / 180;
const sind = (x) => Math.sin(x * RAD);
const cosd = (x) => Math.cos(x * RAD);
const atan2d = (y, x) => Math.atan2(y, x) / RAD;
const norm360 = (x) => ((x % 360) + 360) % 360;

/** Date → Schlyterの日数 d（2000年1月0日 0:00 UT 起点） */
function dayNumber_(date) {
  return date.getTime() / 86400000 - 10956;
}

/** ケプラー方程式を解いて離心近点角Eを返す（度） */
function solveKepler_(M, e) {
  let E = M + (e / RAD) * sind(M) * (1 + e * cosd(M));
  for (let k = 0; k < 10; k++) {
    const dE = (E - (e / RAD) * sind(E) - M) / (1 - e * cosd(E));
    E -= dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  return E;
}

/** 軌道要素 → 黄道直交座標 [x, y, z] */
function orbitToXYZ_(el) {
  const M = norm360(el.M);
  const E = solveKepler_(M, el.e);
  const xv = el.a * (cosd(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * sind(E);
  const v = atan2d(yv, xv);
  const r = Math.sqrt(xv * xv + yv * yv);
  const vw = v + el.w;
  return [
    r * (cosd(el.N) * cosd(vw) - sind(el.N) * sind(vw) * cosd(el.i)),
    r * (sind(el.N) * cosd(vw) + cosd(el.N) * sind(vw) * cosd(el.i)),
    r * (sind(vw) * sind(el.i)),
  ];
}

/** 軌道要素（Schlyter） */
function elements_(d) {
  return {
    sun:     { N: 0, i: 0, w: 282.9404 + 4.70935e-5 * d, a: 1.0,
               e: 0.016709 - 1.151e-9 * d, M: 356.0470 + 0.9856002585 * d },
    moon:    { N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d,
               a: 60.2666, e: 0.054900, M: 115.3654 + 13.0649929509 * d },
    mercury: { N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.00e-8 * d, w: 29.1241 + 1.01444e-5 * d,
               a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d },
    venus:   { N: 76.6799 + 2.46590e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.8910 + 1.38374e-5 * d,
               a: 0.723330, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d },
    mars:    { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d,
               a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d },
    jupiter: { N: 100.4542 + 2.76854e-5 * d, i: 1.3030 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d,
               a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.8950 + 0.0830853001 * d },
    saturn:  { N: 113.6634 + 2.38980e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d,
               a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.9670 + 0.0334442282 * d },
    uranus:  { N: 74.0005 + 1.3978e-5 * d, i: 0.7733 + 1.9e-8 * d, w: 96.6612 + 3.0565e-5 * d,
               a: 19.18171 - 1.55e-8 * d, e: 0.047318 + 7.45e-9 * d, M: 142.5905 + 0.011725806 * d },
    neptune: { N: 131.7806 + 3.0173e-5 * d, i: 1.7700 - 2.55e-7 * d, w: 272.8461 - 6.027e-6 * d,
               a: 30.05826 + 3.313e-8 * d, e: 0.008606 + 2.15e-9 * d, M: 260.2471 + 0.005995147 * d },
  };
}

/** 直交座標 → [黄経, 黄緯, 距離] */
function toSpherical_(x, y, z) {
  return [norm360(atan2d(y, x)), atan2d(z, Math.sqrt(x * x + y * y)), Math.sqrt(x * x + y * y + z * z)];
}

/** 球座標 → 直交座標 */
function toXYZ_(lon, lat, r) {
  return [r * cosd(lat) * cosd(lon), r * cosd(lat) * sind(lon), r * sind(lat)];
}

/**
 * 指定日時の地心黄経を全天体分返す
 * @param {Date} date
 * @return {Object} { 太陽: 黄経, 月: 黄経, ... }（度・0〜360）
 */
function planetLongitudes(date) {
  const d = dayNumber_(date);
  const el = elements_(d);

  // 太陽（＝地球の位置の反転）
  const s = el.sun;
  const sunXYZ = orbitToXYZ_(s);
  const sunLon = toSpherical_(sunXYZ[0], sunXYZ[1], sunXYZ[2])[0];

  // 平均近点角（摂動計算用）
  const Ms = norm360(s.M);
  const Mm = norm360(el.moon.M);
  const Mj = norm360(el.jupiter.M);
  const Msa = norm360(el.saturn.M);
  const Mu = norm360(el.uranus.M);

  // 月（地心軌道＋摂動）
  const mo = el.moon;
  const moonXYZ = orbitToXYZ_(mo);
  let [moonLon, moonLat] = toSpherical_(moonXYZ[0], moonXYZ[1], moonXYZ[2]);
  const Ls = Ms + s.w;
  const Lm = Mm + mo.w + mo.N;
  const D = Lm - Ls;
  const F = Lm - mo.N;
  moonLon += -1.274 * sind(Mm - 2 * D) + 0.658 * sind(2 * D) - 0.186 * sind(Ms)
           - 0.059 * sind(2 * Mm - 2 * D) - 0.057 * sind(Mm - 2 * D + Ms)
           + 0.053 * sind(Mm + 2 * D) + 0.046 * sind(2 * D - Ms) + 0.041 * sind(Mm - Ms)
           - 0.035 * sind(D) - 0.031 * sind(Mm + Ms) - 0.015 * sind(2 * F - 2 * D)
           + 0.011 * sind(Mm - 4 * D);

  const result = { 太陽: sunLon, 月: norm360(moonLon) };

  // 惑星（日心 → 地心）
  const keys = [['水星', 'mercury'], ['金星', 'venus'], ['火星', 'mars'], ['木星', 'jupiter'],
                ['土星', 'saturn'], ['天王星', 'uranus'], ['海王星', 'neptune']];
  keys.forEach(([name, key]) => {
    let [x, y, z] = orbitToXYZ_(el[key]);
    if (key === 'jupiter' || key === 'saturn' || key === 'uranus') {
      let [lon, lat, r] = toSpherical_(x, y, z);
      if (key === 'jupiter') {
        lon += -0.332 * sind(2 * Mj - 5 * Msa - 67.6) - 0.056 * sind(2 * Mj - 2 * Msa + 21)
             + 0.042 * sind(3 * Mj - 5 * Msa + 21) - 0.036 * sind(Mj - 2 * Msa)
             + 0.022 * cosd(Mj - Msa) + 0.023 * sind(2 * Mj - 3 * Msa + 52)
             - 0.016 * sind(Mj - 5 * Msa - 69);
      } else if (key === 'saturn') {
        lon += 0.812 * sind(2 * Mj - 5 * Msa - 67.6) - 0.229 * cosd(2 * Mj - 4 * Msa - 2)
             + 0.119 * sind(Mj - 2 * Msa - 3) + 0.046 * sind(2 * Mj - 6 * Msa - 69)
             + 0.014 * sind(Mj - 3 * Msa + 32);
        lat += -0.020 * cosd(2 * Mj - 4 * Msa - 2) + 0.018 * sind(2 * Mj - 6 * Msa - 49);
      } else {
        lon += 0.040 * sind(Msa - 2 * Mu + 6) + 0.035 * sind(Msa - 3 * Mu + 33)
             - 0.015 * sind(Mj - Mu + 20);
      }
      [x, y, z] = toXYZ_(lon, lat, r);
    }
    result[name] = toSpherical_(x + sunXYZ[0], y + sunXYZ[1], z + sunXYZ[2])[0];
  });

  // 冥王星（1885〜2099年用の近似式・観測日の分点）
  const S = 50.03 + 0.033459652 * d;
  const P = 238.95 + 0.003968789 * d;
  const pLon = 238.9508 + 0.00400703 * d
    - 19.799 * sind(P) + 19.848 * cosd(P) + 0.897 * sind(2 * P) - 4.956 * cosd(2 * P)
    + 0.610 * sind(3 * P) + 1.211 * cosd(3 * P) - 0.341 * sind(4 * P) - 0.190 * cosd(4 * P)
    + 0.128 * sind(5 * P) - 0.034 * cosd(5 * P) - 0.038 * sind(6 * P) + 0.031 * cosd(6 * P)
    + 0.020 * sind(S - P) - 0.010 * cosd(S - P);
  const pLat = -3.9082
    - 5.453 * sind(P) - 14.975 * cosd(P) + 3.527 * sind(2 * P) + 1.673 * cosd(2 * P)
    - 1.051 * sind(3 * P) + 0.328 * cosd(3 * P) + 0.179 * sind(4 * P) - 0.292 * cosd(4 * P)
    + 0.019 * sind(5 * P) + 0.100 * cosd(5 * P) - 0.031 * sind(6 * P) - 0.026 * cosd(6 * P)
    + 0.011 * cosd(S - P);
  const pR = 40.72 + 6.68 * sind(P) + 6.90 * cosd(P) - 1.18 * sind(2 * P) - 0.03 * cosd(2 * P)
    + 0.15 * sind(3 * P) - 0.14 * cosd(3 * P);
  const [px, py, pz] = toXYZ_(pLon, pLat, pR);
  result['冥王星'] = toSpherical_(px + sunXYZ[0], py + sunXYZ[1], pz + sunXYZ[2])[0];

  return result;
}

/**
 * 黄経に加えて逆行フラグも返す（前後12時間の差分で判定）
 * @return {Object} { 太陽: {lon, retro}, ... }
 */
function planetPositions(date) {
  const now = planetLongitudes(date);
  const before = planetLongitudes(new Date(date.getTime() - 12 * 3600000));
  const after = planetLongitudes(new Date(date.getTime() + 12 * 3600000));
  const out = {};
  PLANETS.forEach((name) => {
    let speed = after[name] - before[name];
    if (speed > 180) speed -= 360;
    if (speed < -180) speed += 360;
    out[name] = { lon: now[name], speed: speed, retro: speed < 0 };
  });
  return out;
}

/** ASC / MC（度）を返す */
function angles(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
             + 0.000387933 * T * T - (T * T * T) / 38710000;
  const ramc = norm360(gmst + lon);
  const eps = 23.4392911 - 0.0130042 * T;
  const mc = norm360(atan2d(sind(ramc), cosd(ramc) * cosd(eps)));
  const asc = norm360(atan2d(cosd(ramc), -(sind(ramc) * cosd(eps) + Math.tan(lat * RAD) * sind(eps))));
  return { ASC: asc, MC: mc };
}

/** 出生データ → Date（UT） */
function natalDate_() {
  return new Date(Date.UTC(NATAL.year, NATAL.month - 1, NATAL.day,
                           NATAL.hour - NATAL.tz, NATAL.minute));
}

/** 黄経 → 「山羊座 6°42'」形式 */
function formatLon(lon) {
  const signIdx = Math.floor(lon / 30);
  const inSign = lon - signIdx * 30;
  let deg = Math.floor(inSign);
  let min = Math.round((inSign - deg) * 60);
  if (min === 60) { deg += 1; min = 0; }
  return `${SIGNS[signIdx]} ${deg}°${String(min).padStart(2, '0')}'`;
}

// ===== 動作確認用 =====
function testStep1() {
  const natal = natalDate_();
  const natalPos = planetPositions(natal);
  const natalAng = angles(natal, NATAL.lat, NATAL.lon);
  const lines = ['【出生図】'];
  PLANETS.forEach((p) => lines.push(`${p}: ${formatLon(natalPos[p].lon)}${natalPos[p].retro ? ' ℞' : ''}`));
  lines.push(`ASC: ${formatLon(natalAng.ASC)}`, `MC: ${formatLon(natalAng.MC)}`);

  const now = new Date();
  const nowPos = planetPositions(now);
  lines.push('', `【現在のトランジット】${Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')}`);
  PLANETS.forEach((p) => lines.push(`${p}: ${formatLon(nowPos[p].lon)}${nowPos[p].retro ? ' ℞' : ''}`));

  Logger.log(lines.join('\n'));
}
