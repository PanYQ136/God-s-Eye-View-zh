import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, H = 774;
const b = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'load' });
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => 0)) break; await sleep(400); }
await sleep(5000);
const cdp = await p.createCDPSession();
const st = () => p.evaluate(() => { const s = window.__gevEdge.stats(); return { frames: s.frames, skip: s.skip, drawFps: s.drawFps, tex: s.tex, err: s.err, enabled: s.enabled, surf: (s.surfaces || []).map((x) => x.id + ':' + x.band).join(','), canvases: document.querySelectorAll('#gev-edge-lens').length, opacity: (document.getElementById('gev-edge-lens') || {}).style ? document.getElementById('gev-edge-lens').style.opacity : null }; });
console.log('pre-freeze', JSON.stringify(await st()));
await p.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; v.useDefaultRenderLoop = false; });
await sleep(1500);
const a = await st(); await sleep(1500); const bb = await st();
console.log('post-freeze', JSON.stringify(a), '->', JSON.stringify({ frames: bb.frames, skip: bb.skip }));
/* lens off/on 是否重画 */
await p.evaluate(() => window.__gevEdge.off());
await sleep(800);
const c = await st();
await p.evaluate(() => window.__gevEdge.on());
await sleep(1200);
const d = await st();
console.log('off', JSON.stringify({ frames: c.frames, tex: c.tex }), 'on', JSON.stringify({ frames: d.frames, tex: d.tex, err: d.err }));
/* 像素：卡片顶沿是否存在透镜（与关掉对比） */
const px = async () => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  return p.evaluate(async (b64, rect) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    const out = [];
    for (let k = 0; k <= 18; k++) {
      let s = 0, n = 0;
      for (let x = Math.round(rect.x + rect.w * 0.3); x < Math.round(rect.x + rect.w * 0.7); x++) {
        const i = ((Math.round(rect.y) + k) * bmp.width + x) * 4;
        s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
      }
      out.push(+(s / n).toFixed(1));
    }
    return out;
  }, data, await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; }));
};
const onP = await px();
await p.evaluate(() => window.__gevEdge.off());
await sleep(800);
const offP = await px();
await p.evaluate(() => window.__gevEdge.on());
await sleep(900);
console.log('profile lens ON ', JSON.stringify(onP));
console.log('profile lens OFF', JSON.stringify(offP));
await b.close();
