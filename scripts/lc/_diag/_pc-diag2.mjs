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
const sample = async (label, pts) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const out = await p.evaluate(async (b64, pts) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    return pts.map((pt) => {
      let s = 0, n = 0;
      for (let y = pt[1]; y < pt[1] + pt[3]; y++) for (let x = pt[0]; x < pt[0] + pt[2]; x++) { const i = (y * bmp.width + x) * 4; s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
      return +(s / n).toFixed(1);
    });
  }, data, pts);
  console.log(label, JSON.stringify(out));
};
const r = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) }; });
/* 只留 lens：隐藏卡内内容 + 黑色遮板(z3) */
await p.evaluate(() => { const d = document.createElement('div'); d.id = 'pc-black'; d.style.cssText = 'position:fixed;inset:0;z-index:3;background:#000;pointer-events:none'; document.body.appendChild(d); });
await p.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(800);
const pts = [[r.x + 40, r.y + 1, 60, 2], [r.x + 40, r.y + 4, 60, 4], [r.x + 40, r.y + 9, 60, 4], [r.x + 1, r.y + 20, 2, 8]];
await sample('A none(testBg off)', pts);
await p.evaluate(() => window.__gevEdge.testBg(true, -1, null)); /* 纯白 */
await sleep(1200);
await sample('B white texture', pts);
console.log('state', await p.evaluate(() => ({ tex: window.__gevEdge.stats().tex, tb: window.__gevEdge.cfg().testBg, flat: window.__gevEdge.cfg().testBgFlat })));
await p.evaluate(() => window.__gevEdge.testBg(true, 8, 100));
await sleep(1200);
await sample('C flat100 texture', pts);
/* 关掉 lens → 只剩底板 */
await p.evaluate(() => window.__gevEdge.off());
await sleep(700);
await sample('D lens off', pts);
await p.evaluate(() => window.__gevEdge.on());
await sleep(700);
await sample('E lens on again', pts);
console.log('stats', await p.evaluate(() => { const s = window.__gevEdge.stats(); return { frames: s.frames, drawFps: s.drawFps, err: s.err, scale: s.scale, canvas: s.canvas, surfaces: s.surfaces.filter((x) => x.id === 'data-panel') }; }));
await b.close();
