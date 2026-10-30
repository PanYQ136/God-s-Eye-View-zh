import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'load' });
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => 0)) break; await sleep(400); }
await sleep(4000);
console.log('cfg0', await p.evaluate(() => { const c = window.__gevEdge.cfg(); return { tb: c.testBg, flat: c.testBgFlat, band: c.band, thick: c.thick, gain: c.gain, lensPow: c.lensPow, ba: c.bandAlpha }; }));
await p.evaluate(() => window.__gevEdge.testBg(true, 8, 100));
await sleep(1500);
console.log('cfg1', await p.evaluate(() => { const c = window.__gevEdge.cfg(); const s = window.__gevEdge.stats(); return { tb: c.testBg, flat: c.testBgFlat, tex: s.tex, err: s.err, frames: s.frames, drawFps: s.drawFps }; }));
await p.evaluate(() => window.__gevEdge.testBg(false, 8, null));
await sleep(500);
console.log('cfg2', await p.evaluate(() => { const s = window.__gevEdge.stats(); return { tex: s.tex }; }));
await b.close();
