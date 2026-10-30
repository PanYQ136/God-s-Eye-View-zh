/* Phase6C1 探针 d：为什么「画布有内容」但「屏幕没有」—— 三种假设一次分辨
   H1 内容太淡：gain 拉到 20，屏幕是否爆亮？
   H2 rAF 路径的 GL 不进合成：evaluate 里直接 clear 蓝 → 屏幕蓝；再让 shader 画回来 → 蓝消失？
   H3 需要额外一帧：on() 之后再等 2 个 rAF / 300ms 再截。
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
  if (ok) break; await sleep(300);
}
await sleep(3500);
await page.mouse.move(4, 400);
const cdp = await page.createCDPSession();
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(800);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => { const el = document.getElementById('data-panel'); const t = el.querySelector('.panel-header') || el; const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testBg(true, 8, 128);
});
await sleep(1200);
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const P = [[Math.round(r.x + r.w / 2), Math.round(r.y + 1)], [Math.round(r.x + r.w / 2), Math.round(r.y + 3)], [Math.round(r.x + 2), Math.round(r.y + r.h / 2)], [Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)]];
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const sample = async (b64) => page.evaluate(async (b64, P) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  return P.map(([x, y]) => { const i = (y * bmp.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; });
}, b64, P);
const rep = async (tag) => { const s = await shot(); const v = await sample(s); console.log(tag.padEnd(26), JSON.stringify(v)); return v; };

console.log('采样点（top+1, top+3, left+2, center）', JSON.stringify(P));
await rep('base(gain=1)');
await page.evaluate(() => window.__gevEdge.set({ gain: 20 }));
await sleep(900);
await rep('H1 gain=20');
await page.evaluate(() => { window.__gevEdge.set({ gain: 1 }); window.__gevEdge.off(); });
await sleep(500);
await page.evaluate(() => { const cv = document.getElementById('gev-edge-lens'); const gl = cv.getContext('webgl2'); gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); });
await sleep(500);
await rep('H2 blue clear');
await page.evaluate(() => { const cv = document.getElementById('gev-edge-lens'); const gl = cv.getContext('webgl2'); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); window.__gevEdge.on(); });
await sleep(900);
await rep('H2 on() after clear');
await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60)))));
await rep('H3 after 2 rAF');
await page.evaluate(() => new Promise((res) => setTimeout(res, 400)));
await rep('H3 after 400ms');
/* H4：把画布内容「提交」一次 —— evaluate 里直接触发一次真实 GL 绘制（drawArrays），看屏幕 */
await page.evaluate(() => { const cv = document.getElementById('gev-edge-lens'); const gl = cv.getContext('webgl2'); gl.finish(); });
await sleep(400);
const afterFinish = await rep('H4 gl.finish()');
writeFileSync(`${OUT}/probe-d.json`, JSON.stringify({ r, P, afterFinish }, null, 1));
await browser.close();
