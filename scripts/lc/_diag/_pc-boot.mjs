import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: false, executablePath: 'C:\Program Files\Google\Chrome\Application\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on('console', (m) => { if (/gev-edge/.test(m.text())) console.log('PAGE:', m.text().slice(0, 120)); });
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'load' });
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => 0)) break; await sleep(400); }
await sleep(4000);
console.log('stats', JSON.stringify(await p.evaluate(() => { const s = window.__gevEdge.stats(); return { count: s.count, band: s.band, gain: s.gain, dispPx: s.dispPx, bandAlpha: s.bandAlpha, rimAmt: s.rimAmt, err: s.err, gpu: (window.__gevGpu.probe() || {}).renderer }; })));
await b.close();
