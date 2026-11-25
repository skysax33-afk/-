// 灯守りの迷宮の自動プレイテスト。ブラウザ（Playwright の Chromium）で実際にゲームを動かして確かめる。
// NG が1つでもあれば終了コード1。
//
// 初回だけ:  cd game/test && npm install && npx playwright install chromium
// 実行:      node game/test/play.js            （リポジトリのどこからでも可）
//            node game/test/play.js --shots    （画面写真を一時フォルダに保存し、その場所を表示）
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME = path.join(__dirname, '..', 'index.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-test-'));
const PAGE = path.join(TMP, 'page.html');
const SHOTS = process.argv.includes('--shots');

// 公開時と同じく、ゲームのファイルを HTML の骨組みで包む
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}[hidden]{display:none!important}</style>'
  + '</head><body>' + fs.readFileSync(GAME, 'utf8') + '</body></html>');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? `  （${detail}）` : ''}`);
}

// 仕様（game/ART_SPEC.md）で決めた主の順番
const BOSS_ORDER = ['岩殻の王 ドルグ', '灯喰いの母 ネルヴァ', '沈鐘の巨蟹', '溺れた大司教', '堕ちた灯守り', '灯を呑むもの'];

// ページの中で動かす道具（自動で戦う bot と、テスト用の無敵）
const HELPERS = `
window.__t = {
  hits: 0,
  // 被ダメージを無効にして回数だけ数える。攻撃力も上げて主戦を早く終わらせる
  god(atk) {
    window.__origDamage = window.__origDamage || damagePlayer;
    damagePlayer = () => { __t.hits++; };
    if (atk) { player.mods.atk = atk; computeStats(); }
  },
  skipLevelUps() {
    while (run.pendingLv > 0) { state = 'levelup'; buildCards(); chooseCard(0); }
    show('levelup', false); state = 'play';
  },
  jumpTo(f) { __t.skipLevelUps(); run.floor = f - 1; map.stairs = { x: player.x, y: player.y }; onStairs = true; descend(); __t.skipLevelUps(); },
  // 一番近い敵（いなければ階段）へ向かって戦う。sec 秒ぶんを早回しで進める
  bot(sec, opts = {}) {
    const log = { floors: [], died: false, error: null, bossKilled: false };
    let nav = null, navT = 0;
    const ticks = Math.round(sec * 30);
    for (let i = 0; i < ticks; i++) {
      if (state === 'levelup') { chooseCard(i % 3); continue; }
      if (state === 'dead') { deadT = 0; endRun('dead'); log.died = true; break; }
      if (state !== 'play') break;
      let tgt = null, bd = 1e9;
      for (const e of enemies) { if (e.hp <= 0) continue; const f = flowAt(e); if (f >= 0 && f < bd) { bd = f; tgt = e; } }
      if (!tgt && map.stairs) tgt = map.stairs;
      input.keys.clear(); input.atkKey = false;
      if (tgt) {
        if (navT-- <= 0) { nav = bfs(map, Math.floor(tgt.x / TILE), Math.floor(tgt.y / TILE)); navT = 6; }
        const d = Math.sqrt(dist2(player, tgt));
        let dx = tgt.x - player.x, dy = tgt.y - player.y;
        if (!los(player, tgt) && nav) {
          const tx = Math.floor(player.x / TILE), ty = Math.floor(player.y / TILE);
          let best = nav[ty * map.W + tx], bx = 0, by = 0;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = nav[(ty + ay) * map.W + tx + ax]; if (v >= 0 && v < best) { best = v; bx = ax; by = ay; } }
          dx = (tx + bx + 0.5) * TILE - player.x; dy = (ty + by + 0.5) * TILE - player.y;
        }
        const isEnemy = tgt.hp != null;
        if (!isEnemy || d > 60) {
          if (dx < -4) input.keys.add('KeyA'); if (dx > 4) input.keys.add('KeyD');
          if (dy < -4) input.keys.add('KeyW'); if (dy > 4) input.keys.add('KeyS');
        }
        if (isEnemy && d < 110) input.atkKey = true;
        if (isEnemy && d < 120 && i % 20 === 0) input.queue.push('whirl');
        if (isEnemy && d < 400 && i % 25 === 0) input.queue.push('bolt');
        if (i % 90 === 0) input.queue.push('dash');
        if (!isEnemy && onStairs) { descend(); log.floors.push(run.floor); }
      }
      readInput();
      try {
        update(1 / 30);
        if (i % 15 === 0) render(performance.now() + i * 33, 1 / 30);
        if (i % 30 === 0) { updateHud(); drawMini(1); }
      } catch (err) { log.error = String(err && err.stack || err); break; }
      if (bossRef && bossRef.hp <= 0) log.bossKilled = true;
      if (opts.untilFloor && run.floor >= opts.untilFloor) break;
    }
    log.floor = run.floor; log.kills = run.kills; log.lv = player.lv; log.state = state;
    return log;
  },
};`;

(async () => {
  const browser = await chromium.launch();
  const pageErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.goto(pathToFileURL(PAGE).href);
  await page.waitForTimeout(600);
  await page.addScriptTag({ content: HELPERS });

  // 1. 起動
  check('起動して灯台（拠点）の画面が出る', await page.isVisible('#base') && await page.isVisible('#btnStart'));
  if (SHOTS) await page.screenshot({ path: path.join(TMP, 'base.png') });

  // 2. 区画と抽選表
  const zone = await page.evaluate(() => {
    const zones = [1, 10, 11, 20, 21, 30, 31, 41].map(f => zoneForFloor(f));
    const empty = []; const fallback = []; const missing = [];
    for (let f = 1; f <= 40; f++) {
      if (f % 5 === 0) continue;
      const pool = floorEnemyTypes(f);
      if (!pool.length) empty.push(f);
      const z = zoneForFloor(f);
      const hasOwn = Object.values(ETYPES).some(d => d.zone === z && f >= d.from);
      if (f <= 30 && hasOwn && pool.some(o => ETYPES[o.k].zone !== z)) fallback.push(f);
    }
    for (const [k, d] of Object.entries(ETYPES)) {
      const f = d.from % 5 === 0 ? d.from + 1 : d.from;
      if (!floorEnemyTypes(f).some(o => o.k === k)) missing.push(`${k}@${f}`);
    }
    return { zones, empty, fallback, missing, types: Object.keys(ETYPES).length };
  });
  check('区画: 1〜10=坑道・11〜20=聖堂・21〜30=奥底・31〜は繰り返し', JSON.stringify(zone.zones) === JSON.stringify([1, 1, 2, 2, 3, 3, 1, 2]), zone.zones.join(','));
  check('抽選表: 1〜40階で空の階がない', zone.empty.length === 0, zone.empty.length ? '空: ' + zone.empty.join(',') : `敵 ${zone.types} 種`);
  check('抽選表: 各敵が「出る階」から抽選に入る', zone.missing.length === 0, zone.missing.join(' '));
  check('抽選表: その区画の敵がいる階では、ほかの区画の敵で代用しない', zone.fallback.length === 0, zone.fallback.length ? '代用あり: ' + zone.fallback.join(',') : '');

  // 3. 被弾ありの通常プレイ
  await page.click('#btnStart');
  await page.waitForTimeout(200);
  const normal = await page.evaluate(() => __t.bot(150));
  check('通常プレイ: 150秒ぶん戦ってもエラーが出ない', !normal.error, normal.error || `地下${normal.floor}階・Lv${normal.lv}・${normal.kills}体${normal.died ? '・倒れた' : ''}`);
  if (normal.died) check('倒れたら結果画面が出る', await page.isVisible('#result'));
  // 倒れなかったときは「灯台へ戻る」で挑戦を終える
  if (!normal.died) await page.evaluate(() => { if (state !== 'result') { __t.skipLevelUps(); endRun('retreat'); } });
  check('挑戦を終えると結果画面が出る', await page.isVisible('#result'));
  await page.click('#btnResBack');

  // 4. 主 6体（テスト用の無敵）: 正しい順番で出て、倒すと階段が出る
  await page.click('#btnStart');
  await page.waitForTimeout(200);
  await page.evaluate(() => { __t.skipLevelUps(); __t.god(60); });
  for (let i = 0; i < 7; i++) {
    const f = 5 * (i + 1);
    const r = await page.evaluate(f => {
      __t.jumpTo(f);
      const name = bossRef && bossRef.name;
      const log = __t.bot(240, { untilFloor: f + 1 });
      return { name, killed: log.bossKilled, next: log.floor > f, error: log.error };
    }, f);
    check(`主（地下${f}階）: ${BOSS_ORDER[i % 6]} が出て、倒すと階段が出る`, r.name === BOSS_ORDER[i % 6] && r.killed && r.next && !r.error, r.error || `出た主: ${r.name}`);
    if (SHOTS && i === 0) await page.screenshot({ path: path.join(TMP, 'after-boss.png') });
  }

  // 5. 火薬虫: 自爆は報酬なし・膨らみ中に倒すと爆発しない
  if (await page.evaluate(() => !!ETYPES.beetle)) {
    const b = await page.evaluate(() => {
      __t.jumpTo(6); enemies = []; hazards = [];
      damagePlayer = __origDamage; player.iframes = 0; player.hp = player.maxHp = 1e6;
      const e1 = makeEnemy('beetle', player.x + 60, player.y, 6, false); e1.aggro = true; enemies.push(e1);
      const k0 = run.kills, hp0 = player.hp;
      for (let i = 0; i < 60; i++) { updateFlow(); updateEnemies(1 / 30); updateHazards(1 / 30); enemies = enemies.filter(e => e.hp > 0); }
      const self = { gone: !enemies.includes(e1), kills: run.kills - k0, hurt: player.hp < hp0 };
      hazards = []; player.iframes = 0;
      const e2 = makeEnemy('beetle', player.x + 60, player.y, 6, false); e2.aggro = true; enemies = [e2];
      for (let i = 0; i < 5; i++) { updateFlow(); updateEnemies(1 / 30); updateHazards(1 / 30); }
      const fused = !!e2.fuse, k1 = run.kills, hp1 = player.hp;
      hitEnemy(e2, 1e6);
      for (let i = 0; i < 40; i++) { updateHazards(1 / 30); enemies = enemies.filter(e => e.hp > 0); }
      const killed = { fused, kills: run.kills - k1, hurt: player.hp < hp1 };
      __t.god();
      return { self, killed };
    });
    check('火薬虫: 近づくと自爆してダメージ、報酬なし', b.self.gone && b.self.kills === 0 && b.self.hurt, JSON.stringify(b.self));
    check('火薬虫: 膨らみ中に倒すと爆発せず、報酬あり', b.killed.fused && b.killed.kills === 1 && !b.killed.hurt, JSON.stringify(b.killed));
  }

  // 6. 敵ごとに1体ずつ出して15秒戦わせる（エラーが出ないこと。攻撃が当たった回数も表示）
  const perType = await page.evaluate(() => {
    const out = [];
    for (const [k, d] of Object.entries(ETYPES)) {
      const f = d.from % 5 === 0 ? d.from + 1 : d.from;
      __t.jumpTo(f); enemies = []; hazards = []; eshots = [];
      player.mods.atk = 1; computeStats();
      const e = makeEnemy(k, player.x + 100, player.y, f, false); e.aggro = true; e.hp = e.maxHp = 1e9; enemies.push(e);
      __t.hits = 0; let error = null;
      try {
        for (let i = 0; i < 450; i++) {
          input.keys.clear(); input.atkKey = i % 60 < 20; readInput();
          update(1 / 30);
          if (i % 30 === 0) render(performance.now() + i * 33, 1 / 30);
          if (state === 'levelup') __t.skipLevelUps();
        }
      } catch (err) { error = String(err && err.stack || err); }
      out.push({ k, name: d.name, hits: __t.hits, error });
    }
    return out;
  });
  for (const r of perType) check(`敵 ${r.name}（${r.k}）: 15秒戦ってエラーなし`, !r.error, r.error || `攻撃が当たった回数 ${r.hits}`);
  if (SHOTS) {
    await page.evaluate(() => { __t.jumpTo(11); enemies = []; let i = 0; for (const k of Object.keys(ETYPES)) { enemies.push(makeEnemy(k, player.x - 260 + (i % 6) * 100, player.y - 120 + Math.floor(i / 6) * 90, 11, false)); i++; } player.stats.light = 900; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(TMP, 'enemies.png') });
  }

  // 7. スマホ（タッチ操作・はみ出し）
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  mp.on('pageerror', e => pageErrors.push('スマホ: ' + e.message));
  await mp.goto(pathToFileURL(PAGE).href);
  await mp.waitForTimeout(600);
  const overflowBase = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || [...document.querySelectorAll('.screen')].some(s => !s.classList.contains('hidden') && s.scrollWidth > s.clientWidth));
  check('スマホ: 灯台の画面が横にはみ出さない', !overflowBase);
  await mp.tap('#btnStart');
  await mp.waitForTimeout(300);
  await mp.evaluate(() => { while (run.pendingLv > 0) { state = 'levelup'; chooseCard(0); } });
  const cdp = await m.newCDPSession(mp);
  const x0 = await mp.evaluate(() => player.x);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 600, id: 1 }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100 + i * 6, y: 600, id: 1 }] }); await mp.waitForTimeout(30); }
  await mp.waitForTimeout(500);
  const x1 = await mp.evaluate(() => player.x);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('スマホ: 左側をなぞると移動する', x1 > x0 + 20, `${Math.round(x0)} → ${Math.round(x1)}`);
  const box = await mp.locator('#tbAtk').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 40, y: box.y + 40, id: 2 }] });
  await mp.waitForTimeout(120);
  const atk = await mp.evaluate(() => input.atk && player.atkCd > 0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('スマホ: 攻撃ボタンで攻撃する', atk);
  if (SHOTS) await mp.screenshot({ path: path.join(TMP, 'mobile.png') });

  check('ブラウザのエラーが出ていない', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '));
  await browser.close();

  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length} 項目中 NG ${ng}`);
  if (SHOTS) console.log(`画面写真: ${TMP}`);
  else fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(ng ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
