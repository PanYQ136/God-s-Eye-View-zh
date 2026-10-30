/* Phase6C1 探针：这块 canvas 的位图到底有没有进合成？
   1) 打印 cv 的 attrs / 计算样式 / GL context attributes
   2) 平灰底 + testBg128：on / off / 手动 clear 红 三态，读同一批屏幕像素的原值
   3) 同批像素再读 canvas 自身 toDataURL，对照
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, H = 774, OUT = '.gev-logs/lc/phase6c1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 600000, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(5000);
await page.mouse.move(4, 400);
const cdp = await page.createCDPSession();
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(900);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => { const el = document.getElementById('data-panel'); const t = el.querySelector('.panel-header') || el; const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1300);
}
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testBg(true, 8, 128);
});
await sleep(1500);

const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const attrs = await page.evaluate(() => {
  const cv = document.getElementById('gev-edge-lens');
  const cs = getComputedStyle(cv);
  const gl = cv.getContext('webgl2');
  const a = gl ? gl.getContextAttributes() : null;
  return {
    attrWH: [cv.width, cv.height], cssWH: [cs.width, cs.height], rect: cv.getBoundingClientRect().toJSON(),
    opacity: cs.opacity, display: cs.display, visibility: cs.visibility, zIndex: cs.zIndex, mixBlend: cs.mixBlendMode,
    filter: cs.filter, transform: cs.transform, isolation: cs.isolation, contain: cs.contain,
    attrs: a, lost: gl ? gl.isContextLost() : 'nogl', parent: cv.parentElement && cv.parentElement.tagName,
    canvases: [...document.querySelectorAll('canvas')].map((c) => ({ id: c.id || c.className, w: c.width, h: c.height, z: getComputedStyle(c).zIndex, vis: getComputedStyle(c).visibility, op: getComputedStyle(c).opacity })),
  };
});
console.log('ATTRS', JSON.stringify(attrs, null, 1));

const pts = {
  topEdge3: [Math.round(r.x + r.w / 2), Math.round(r.y + 3)],
  topEdge1: [Math.round(r.x + r.w / 2), Math.round(r.y + 1)],
  leftEdge2: [Math.round(r.x + 2), Math.round(r.y + r.h / 2)],
  center: [Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)],
  underOnly: [900, 400],
};
const sample = async (b64) => page.evaluate(async (b64, pts) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = {};
  for (const k of Object.keys(pts)) {
    const [x, y] = pts[k]; const i = (y * bmp.width + x) * 4;
    out[k] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }
  return out;
}, b64, pts);
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const sampleCanvas = async () => page.evaluate(async (pts) => {
  const cv = document.getElementById('gev-edge-lens');
  const url = cv.toDataURL('image/png');
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c2 = document.createElement('canvas'); c2.width = bmp.width; c2.height = bmp.height;
  const cx = c2.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = {};
  for (const k of Object.keys(pts)) { const [x, y] = pts[k]; const i = (y * bmp.width + x) * 4; out[k] = [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
  return out;
}, pts);

const S_on = await shot();
const C_on = await sampleCanvas();
await page.evaluate(() => window.__gevEdge.off());
await sleep(700);
const S_off = await shot();
const P_on = await sample(S_on), P_off = await sample(S_off);
await page.evaluate(() => {
  const cv = document.getElementById('gev-edge-lens');
  const gl = cv.getContext('webgl2');
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish();
});
await sleep(700);
const S_red = await shot();
const P_red = await sample(S_red);
await page.evaluate(() => { const cv = document.getElementById('gev-edge-lens'); const gl = cv.getContext('webgl2'); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish(); });
await sleep(400);

const cmp = {};
for (const k of Object.keys(pts)) cmp[k] = { canvas: C_on[k], on: P_on[k], off: P_off[k], red: P_red[k] };
console.log('COMPARE ' + JSON.stringify(cmp, null, 1));
writeFileSync(`${OUT}/vis.json`, JSON.stringify({ rect: r, attrs, pts, cmp }, null, 1));
writeFileSync(`${OUT}/vis-on.png`, Buffer.from(S_on, 'base64'));
writeFileSync(`${OUT}/vis-off.png`, Buffer.from(S_off, 'base64'));
writeFileSync(`${OUT}/vis-red.png`, Buffer.from(S_red, 'base64'));
await browser.close();
