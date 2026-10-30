/* Phase6C1：冻结态 —— 折射层是否「只在页面有其他 damage 时才被合成」 */
import puppeteer from 'puppeteer';
const W = 1348, H = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(4500);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(900);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar-label') || el;
    const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1300);
}
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(500);
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; window.__v = v; if (v) v.useDefaultRenderLoop = false; });
await sleep(2500);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const sample = (a, b) => page.evaluate(async (a, b, rect) => {
  const dec = async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width };
  };
  const A = await dec(a), B = await dec(b);
  const pt = (x, y) => { const i = (y * A.w + x) * 4; return [A.d[i], A.d[i + 1], A.d[i + 2]]; };
  const out = {};
  for (const [k, x, y] of [['topEdge', rect.x + 160, rect.y + 2], ['leftEdge', rect.x + 3, rect.y + 190], ['center', rect.x + 160, rect.y + 250]]) {
    const p = pt(Math.round(x), Math.round(y)); const q = pt(Math.round(x), Math.round(y));
    out[k] = p.join(',');
  }
  let cm = 0, ct = 0;
  for (let y = Math.round(rect.y + rect.h * 0.4); y < Math.round(rect.y + rect.h * 0.6); y++)
    for (let x = Math.round(rect.x + rect.w * 0.35); x < Math.round(rect.x + rect.w * 0.65); x++) {
      const i = (y * A.w + x) * 4;
      cm = Math.max(cm, Math.abs(A.d[i] - B.d[i])); ct++;
    }
  out.centerDiff = cm;
  return out;
}, a, b, rect);

const setOff = () => page.evaluate(() => window.__gevEdge.set({ band: 0.02, bandMin: 0.02, bandFrac: 0.00002 }));
const setOn = () => page.evaluate(() => window.__gevEdge.set({ band: 10, bandMin: 7, bandFrac: 0.20 }));

await setOn(); await sleep(700); const onA = await shot();
await setOff(); await sleep(700); const offA = await shot();
console.log('冻结         on', JSON.stringify(await sample(onA, onA)), '| off', JSON.stringify(await sample(offA, offA)), '| Δcenter', (await sample(onA, offA)).centerDiff);

/* 制造无关 damage：一个 2x2 透明 div 每帧移动 1px（不改任何布局/像素） */
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'pz-damage';
  d.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;pointer-events:none;opacity:0.02;background:#000;z-index:2147483600';
  document.body.appendChild(d);
  let i = 0;
  window.__pz = setInterval(() => { d.style.transform = 'translate(' + (i++ % 2) + 'px,0)'; }, 16);
});
await setOn(); await sleep(800); const onB = await shot();
await setOff(); await sleep(800); const offB = await shot();
console.log('冻结+damage  on', JSON.stringify(await sample(onB, onB)), '| off', JSON.stringify(await sample(offB, offB)), '| Δcenter', (await sample(onB, offB)).centerDiff);
await page.evaluate(() => { clearInterval(window.__pz); const d = document.getElementById('pz-damage'); if (d) d.remove(); });
await browser.close();
