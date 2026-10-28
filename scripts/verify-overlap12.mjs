#!/usr/bin/env node
/**
 * verify-overlap12.mjs —— 12 组合（左2 × 右3 × dock2）布局验收
 *   每组合：三张卡同时展开（走 __gevLc.open，纯布局校验）→ 落定后
 *   · 所有可见卡两两 overlap = 0
 *   · 7 张卡的 header 全部可见 + 命中自己（elementFromPoint）
 *   · 无 .gev-lc-hid / visibility:hidden / 残留 placeholder / 卡片越界
 * 输出 .gev-logs/t_b37e6b4b/overlap12.json
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const VW = Number(process.env.VW || 1536), VH = Number(process.env.VH || 730);
const OUT = '.gev-logs/t_b37e6b4b';
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', `--window-size=${VW},${VH + 90}`, '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1500);

const settle = async (maxMs = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => (document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : 0));
    if (!n) { await sleep(60); return true; }
    await sleep(60);
  }
  return false;
};
const closeAll = async () => {
  await page.evaluate((IDS) => IDS.forEach((id) => { const s = window.__gevLc.info(id); if (s && s.floating) window.__gevLc.close(id); }), IDS);
  await sleep(600); await settle();
};
const probe = () => page.evaluate((IDS) => {
  const st = window.__gevLc.state();
  const hitOf = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    const head = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle') || el;
    const b = head.getBoundingClientRect();
    let hit = null, ok = false;
    for (let k = 1; k <= 9 && !ok; k++) {
      const x = Math.round(b.left + (b.width * k) / 10), y = Math.round(b.top + b.height / 2);
      const t = document.elementFromPoint(x, y);
      const owner = t && t.closest('.gev-lc');
      const inHeader = t && t.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle');
      if (owner && owner.id === id && inHeader) { ok = true; hit = [x, y]; }
    }
    hitOf[id] = { ok, hit, headRect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
  }
  return {
    st, hitOf,
    hidClass: [...document.querySelectorAll('.gev-lc-hid')].map((e) => e.id),
    placeholders: document.querySelectorAll('.gev-lc-placeholder').length,
    ghosts: [...document.querySelectorAll('.gev-lc-ghost')].length,
    vw: innerWidth, vh: innerHeight,
  };
}, IDS);
const ovl = (st) => {
  const vis = IDS.filter((id) => st[id] && st[id].disp !== 'none' && st[id].vis === 'visible' && st[id].w > 4 && st[id].h > 4);
  const out = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = st[vis[i]], b = st[vis[j]];
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w > 1 && h > 1) out.push({ a: vis[i], b: vis[j], area: w * h });
  }
  return out;
};

const L = ['data-panel', 'scene-panel'], R = ['pp-toggles', 'cctv-panel', 'global-context-panel'], D = ['location-bar', 'control-panel'];
const rows = [];
for (const l of L) for (const r of R) for (const d of D) {
  await closeAll();
  await page.evaluate((a) => { window.__gevLc.open(a[0]); window.__gevLc.open(a[1]); window.__gevLc.open(a[2]); }, [l, r, d]);
  await sleep(500); await settle(2500);
  const p = await probe();
  const overlaps = ovl(p.st);
  const notOpen = [l, r, d].filter((id) => !p.st[id].floating);
  const badHit = IDS.filter((id) => !p.hitOf[id].ok);
  const offscreen = IDS.filter((id) => p.st[id].x < 0 || p.st[id].y < 0 || p.st[id].x + p.st[id].w > p.vw + 1 || p.st[id].y + p.st[id].h > p.vh + 1);
  rows.push({ combo: [l, r, d], overlaps, notOpen, badHit, offscreen, hidClass: p.hidClass, placeholders: p.placeholders, floating: [l, r, d].filter((id) => p.st[id].floating).length, state: p.st, hit: p.hitOf });
  const phOk = p.placeholders === [l, r, d].filter((id) => p.st[id].floating).length;
  console.log(`${l.replace('-panel', '')}+${r.replace('-panel', '')}+${d.replace('-bar', '')}: ovl=${overlaps.length} notOpen=${notOpen.length} badHit=[${badHit.join(',')}] offscreen=[${offscreen.join(',')}] ph=${p.placeholders}/${rows.length ? 3 : 3}${phOk ? '' : ' PH_MISMATCH'} hid=${p.hidClass.length}`);
}
const fails = rows.filter((r) => r.overlaps.length || r.notOpen.length || r.badHit.length || r.offscreen.length || r.placeholders !== r.floating || r.hidClass.length);
// 全部关闭后：不许留 placeholder / ghost / 偏移
await closeAll();
const after = await probe();
const leftover = after.placeholders;
fs.writeFileSync(OUT + '/overlap12.json', JSON.stringify({ rows, errors: errs, afterClose: { placeholders: leftover, hidClass: after.hidClass, state: after.st } }, null, 1));
console.log('\n12 组合：' + (fails.length ? 'FAIL ' + JSON.stringify(fails.map((f) => f.combo)) : 'PASS（全部 overlap=0，header 全部可点，无隐藏、无占位错配）'));
console.log('全关后残留 placeholder:', leftover, '| hidClass:', after.hidClass.length, '| console errors:', errs.length);
await browser.close();
process.exit(fails.length || errs.length || leftover ? 1 : 0);
