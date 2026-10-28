#!/usr/bin/env node
/** qa-expand-click.mjs —— 用「真实鼠标点击 header」复验 3 个原重叠 combo（走 App 自己的折叠逻辑，不只是 __gevLc.open） */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2500);

const measure = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-gfx-fab'];
  const rects = {};
  for (const id of ids) {
    const e = document.getElementById(id); if (!e) continue;
    const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    rects[id] = { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), vis: s.visibility, op: Number(s.opacity), collapsed: e.classList.contains('collapsed') };
  }
  const vis = Object.keys(rects).filter((k) => rects[k].vis !== 'hidden' && rects[k].op > 0.05 && rects[k].w > 4 && rects[k].h > 4);
  const ov = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const A = rects[vis[i]], B = rects[vis[j]];
    const w = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const h = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    if (w > 0 && h > 0) ov.push({ a: vis[i], b: vis[j], area: Math.round(w * h) });
  }
  const floatIds = window.__gevLc._ids();
  return { rects, overlaps: ov, floating: floatIds };
});

// 找一个可点的「空白」点（优先卡片空白区，避开 header 按钮/内部控件）
const headerPoint = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const boxes = ['.panel-inner', '.pp-panel-body', '.location-inner', '.panel-header', '.pp-header-row', '.dock-tray-toggle'];
  const BAD = 'button,input,select,a,[role=slider],.pp-toggle-btn,.pp-collapse-btn,.panel-collapse-btn,.gev-lc-edge';
  for (const sel of boxes) {
    const node = el.querySelector(sel);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) continue;
    for (let fy = 0.15; fy <= 0.9; fy += 0.15) for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const top = document.elementFromPoint(x, y);
      if (!top || !el.contains(top)) continue;
      if (top.closest(BAD)) continue;
      return { x: Math.round(x), y: Math.round(y), sel };
    }
  }
  return null;
}, id);

const clickCard = async (id) => {
  const p = await headerPoint(id);
  if (!p) { console.log('  !! no header point for', id); return false; }
  await page.mouse.click(p.x, p.y);
  await sleep(650);
  return true;
};

const res = [];
for (const rail of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
  await page.evaluate(() => (window.__gevLc._ids() || []).forEach((id) => window.__gevLc.close(id)));
  await sleep(900);
  const base = await measure();
  // 真实点击：data → rail → control（每步等动画）
  await clickCard('data-panel');
  await clickCard(rail);
  await clickCard('control-panel');
  await sleep(900);
  const m = await measure();
  res.push({ rail, baseOverlaps: base.overlaps.length, overlaps: m.overlaps, floating: m.floating, rects: m.rects });
  console.log(`CLICK combo data+${rail}+control: overlaps=${m.overlaps.length} ${JSON.stringify(m.overlaps)}`);
  console.log('   floating:', m.floating.join(','), '| control:', JSON.stringify(m.rects['control-panel']), '|', rail, JSON.stringify(m.rects[rail]));
}
console.log('console errors:', errs.length, errs.slice(0, 3));
await browser.close();
