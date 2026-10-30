/* Phase6C1 探针：折射 canvas 自身像素 & 合成栈。只读，不改源码。 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6c1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); } catch {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(4500);
await page.mouse.move(4, 400);

const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const t = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar-label') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  }, id);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(1100);
};
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(500);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') { await clickHeader('data-panel'); }
ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);

const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
const s0 = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  return { band: s.band, dispPx: s.dispPx, gain: s.gain, bandAlpha: s.bandAlpha, rimAmt: s.rimAmt,
    scale: s.scale, canvas: s.canvas, count: s.count, err: s.err, tex: s.tex, frames: s.frames,
    surfaces: s.surfaces, drawFps: s.drawFps };
});
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, left: b.left }; });

/* 冻结 Cesium */
const frozen = await page.evaluate(() => {
  const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer || null;
  if (!v || !('useDefaultRenderLoop' in v)) return false;
  v.useDefaultRenderLoop = false; return true;
});
await sleep(1000);
/* 只留卡壳 */
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
});
await sleep(600);

/* 合成栈信息 */
const stack = await page.evaluate((r) => {
  const cv = document.getElementById('gev-edge-lens');
  const cs = cv ? getComputedStyle(cv) : null;
  const cb = cv ? cv.getBoundingClientRect() : null;
  const mapCv = document.querySelectorAll('canvas');
  const mapInfo = [...mapCv].filter((c) => c.id !== 'gev-edge-lens').map((c) => {
    const s = getComputedStyle(c); const b = c.getBoundingClientRect();
    return { cls: c.className || c.id, z: s.zIndex, op: s.opacity, pos: s.position, w: Math.round(b.width), h: Math.round(b.height),
      pe: s.pointerEvents, vis: s.visibility, par: c.parentElement ? (c.parentElement.id || c.parentElement.className) : '' };
  });
  const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; };
  return {
    lens: cv ? { z: cs.zIndex, op: cs.opacity, pos: cs.position, pe: cs.pointerEvents, mix: cs.mixBlendMode,
      filter: cs.filter, w: Math.round(cb.width), h: Math.round(cb.height), attrW: cv.width, attrH: cv.height,
      display: cs.display, parent: cv.parentElement ? (cv.parentElement.id || cv.parentElement.className) : '' } : null,
    mapInfo,
    hitTop: at(r.x + r.w * 0.5, r.y + 2), hitLeft: at(r.x + 2, r.y + r.h * 0.5),
    hitInside: at(r.x + r.w * 0.5, r.y + r.h * 0.5),
    domOrder: cv ? [...document.body.children].indexOf(cv) : -1,
  };
}, rect);

/* 折射 canvas 自身像素：4 条边各取一行（横带） */
const grabRow = async (x, y, w) => {
  await page.evaluate((g) => { window.__gevEdgeGrab = g; window.__gevEdgeGrabOut = null; window.__gevEdge.on(); }, { x, y, w });
  for (let i = 0; i < 40; i++) {
    const o = await page.evaluate(() => window.__gevEdgeGrabOut);
    if (o) return o;
    await sleep(60);
  }
  return { err: 'timeout' };
};
const rows = {};
rows.top = await grabRow(Math.round(rect.x + 120), Math.round(rect.y + 1), 40);
rows.left = await grabRow(Math.round(rect.x - 4), Math.round(rect.y + rect.h * 0.5), 32);
rows.right = await grabRow(Math.round(rect.x + rect.w - 20), Math.round(rect.y + rect.h * 0.5), 32);
rows.bot = await grabRow(Math.round(rect.x + 120), Math.round(rect.y + rect.h - 3), 40);

const fmt = (o) => {
  if (!o || o.err) return String(o && o.err);
  return o.row.map((p, i) => `${i}:${p[0]},${p[1]},${p[2]},a${p[3]}`).join(' | ');
};
console.log('GPU       ', gpu && gpu.renderer, 'software=', gpu && gpu.software);
console.log('phase     ', ph, 'frozen=', frozen, 'errs=', errs.slice(0, 3));
console.log('stats     ', JSON.stringify(s0));
console.log('rect      ', JSON.stringify(rect));
console.log('stack     ', JSON.stringify(stack, null, 1));
console.log('ROW top   ', fmt(rows.top));
console.log('ROW left  ', fmt(rows.left));
console.log('ROW right ', fmt(rows.right));
console.log('ROW bot   ', fmt(rows.bot));
writeFileSync(`${OUT}/probe.json`, JSON.stringify({ gpu, ph, frozen, s0, rect, stack, rows, errs }, null, 1));
await browser.close();
