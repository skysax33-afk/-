/**
 * ★評価の境界（interpret.gs の STAR_THRESHOLDS）を決めるスクリプト
 *
 * 使い方（リポジトリ直下で）:
 *   node test/calibrate_stars.js
 *
 * 2000〜2059年の毎朝7:00 JST のテーマ別点数を集め、
 * 下位10%=★1・〜30%=★2・〜70%=★3・〜90%=★4・上位10%=★5 になる境界を出力する。
 * 出力された STAR_THRESHOLDS を interpret.gs に貼る。出生図（NATAL）やオーブ・重みを変えたら取り直す。
 */
const vm = require('vm');
const { loadGas } = require('./run_gas.js');

const FROM = Date.UTC(1999, 11, 31, 22, 0); // 2000-01-01 07:00 JST
const TO = Date.UTC(2059, 11, 31, 22, 0);   // 2060-01-01 07:00 JST（含まない）
const QUANTILES = [0.1, 0.3, 0.7, 0.9];

/** 毎朝（stepDays 日おき）のテーマ別点数 [{ 仕事: 点数, … }, …] */
function rawScores(ctx, from, to, stepDays = 1) {
  ctx.__from = from;
  ctx.__to = to;
  ctx.__step = stepDays * 86400000;
  return vm.runInContext(
    '(() => { const natal = natalPoints_(); const out = []; ' +
    'for (let t = __from; t < __to; t += __step) out.push(themeRawScores_(scoredAspects_(new Date(t), natal))); ' +
    'return out; })()',
    ctx);
}

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
}

function main() {
  const ctx = loadGas();
  const scores = rawScores(ctx, FROM, TO);
  const themes = Object.keys(scores[0]);
  const thresholds = {};
  themes.forEach((th) => {
    const sorted = scores.map((s) => s[th]).sort((a, b) => a - b);
    thresholds[th] = QUANTILES.map((q) => Math.round(quantile(sorted, q) * 100) / 100);
  });

  console.log(`// ${scores.length}日分（2000〜2059年の毎朝7:00 JST）から算出`);
  console.log('const STAR_THRESHOLDS = {');
  themes.forEach((th) => {
    console.log(`  '${th}': [${thresholds[th].join(', ')}],`);
  });
  console.log('};');
}

if (require.main === module) main();

module.exports = { rawScores, FROM, TO, QUANTILES };
