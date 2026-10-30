import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, H = 774;
const b = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('console', (m) => { if (/gev-edge/.test(m.text())) console.log('PAGE:', m.text().slice(0, 160)); });
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'load' });
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => 0)) break; await sleep(400); }
await sleep(5000);
const cdp = await p.createCDPSession();
const lum = async (label) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const out = await p.evaluate(async (b64, pts) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    return pts.map((pt) => {
      let s = 0, n = 0, chr = 0;
      for (let y = pt[1]; y < pt[1] + pt[3]; y++) for (let x = pt[0]; x < pt[0] + pt[2]; x++) {
        const i = (y * bmp.width + x) * 4;
        s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        chr = Math.max(chr, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]));
        n++;
      }
      return [+(s / n).toFixed(1), chr];
    });
  }, data, [[60, 300, 40, 20], [60, 96, 60, 3], [60, 101, 60, 6], [900, 400, 40, 20]]);
  console.log(label, JSON.stringify(out));
};
const st = () => p.evaluate(() => { const s = window.__gevEdge.stats(); return { tex: s.tex, err: s.err, count: s.count, enabled: window.__gevEdge.cfg().enabled, tb: window.__gevEdge.cfg().testBg, flat: window.__gevEdge.cfg().testBgFlat, scale: s.scale }; });
const r = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) }; });
console.log('rect', r, 'state', JSON.stringify(await st()));
await lum('base(real map)');
await p.evaluate(() => window.__gevEdge.testBg(true, 8, 100));
await sleep(1200);
console.log('testbg flat100 state', JSON.stringify(await st()));
await lum('testbg100');
await p.evaluate(() => { const d = document.createElement('div'); d.id = 'pc-black'; d.style.cssText = 'position:fixed;inset:0;z-index:3;background:#000;pointer-events:none'; document.body.appendChild(d); });
await sleep(900);
await lum('testbg100+black');
await p.evaluate(() => { const dv = document.getElementById('pc-black'); dv.style.zIndex = '9999'; });
await sleep(900);
await lum('testbg100+blackOnTop(z9999)');
await p.evaluate(() => window.__gevEdge.testBg(true, 8, null));
await sleep(1200);
await p.evaluate(() => { const dv = document.getElementById('pc-black'); dv.style.zIndex = '3'; });
await sleep(900);
await lum('stripes+black');
console.log('final state', JSON.stringify(await st()));
await b.close();
