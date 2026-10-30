/* Phase6C1 探针10：冻结 Cesium 后，纹理是否失效（on() 在 postRender 外上传） */
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
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; window.__v = v; if (v) v.useDefaultRenderLoop = false; });
await sleep(800);
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(400);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const prof = (a, b) => page.evaluate(async (a, b, rect) => {
  const dec = async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width };
  };
  const A = await dec(a), B = await dec(b);
  const out = {};
  const edges = { top: ['y', rect.y, Math.round(rect.x + rect.w * 0.35), Math.round(rect.x + rect.w * 0.65), rect.h * 0.3, rect.h * 0.7],
    left: ['x', rect.x, Math.round(rect.y + rect.h * 0.3), Math.round(rect.y + rect.h * 0.7), rect.w * 0.3, rect.w * 0.7],
    bot: ['y', rect.y + rect.h, Math.round(rect.x + rect.w * 0.35), Math.round(rect.x + rect.w * 0.65), 0, 0],
    right: ['x', rect.x + rect.w, Math.round(rect.y + rect.h * 0.3), Math.round(rect.y + rect.h * 0.7), 0, 0] };
  for (const [k, e] of Object.entries(edges)) {
    const [axis, e0] = e;
    let u0, u1;
    if (axis === 'y') { u0 = Math.round(rect.x + rect.w * 0.35); u1 = Math.round(rect.x + rect.w * 0.65); }
    else { u0 = Math.round(rect.y + rect.h * 0.3); u1 = Math.round(rect.y + rect.h * 0.7); }
    const p = [];
    for (let j = 0; j <= 12; j++) {
      const t0 = Math.round(e0) + j;
      let s = 0, n = 0;
      for (let u = u0; u < u1; u++) {
        const i = axis === 'y' ? (t0 * A.w + u) * 4 : (u * A.w + t0) * 4;
        s += Math.abs(0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2]));
        n++;
      }
      p.push(n ? +(s / n).toFixed(1) : 0);
    }
    let cm = 0;
    for (let y = Math.round(rect.y + rect.h * 0.4); y < Math.round(rect.y + rect.h * 0.6); y++)
      for (let x = Math.round(rect.x + rect.w * 0.35); x < Math.round(rect.x + rect.w * 0.65); x++) {
        const i = (y * A.w + x) * 4;
        cm = Math.max(cm, Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2]));
      }
    out[k] = { prof: p, peak: Math.max(...p.slice(0, 6)), centerMax: cm };
  }
  return out;
}, a, b, rect);

/* 1) 冻结后：off / on（on 在 postRender 外上传 = 可能是空纹理） */
await page.evaluate(() => window.__gevEdge.off()); await sleep(400);
const off = await shot();
await page.evaluate(() => window.__gevEdge.on()); await sleep(500);
const onNoRender = await shot();
/* 2) 再补一次真渲染（postRender 同帧上传） */
await page.evaluate(() => { try { window.__v.scene.requestRender(); if (window.__v.render) window.__v.render(); } catch (e) {} });
await sleep(500);
const onRender = await shot();
const A1 = await prof(onNoRender, off);
const A2 = await prof(onRender, off);
console.log('frozen / on(no render) :', JSON.stringify(A1));
console.log('frozen / on + render   :', JSON.stringify(A2));
await browser.close();
