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
await sleep(6000);
const cdp = await p.createCDPSession();
const tryIt = async (label, clip) => {
  try { const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false }); console.log(label, 'OK', r.data.length); }
  catch (e) { console.log(label, 'ERR', String(e.message).slice(0, 140)); }
};
await tryIt('fixed small', { x: 10.5, y: 10.5, width: 100.5, height: 100.5, scale: 2 });
await tryIt('fixed scale1', { x: 10, y: 10, width: 100, height: 100, scale: 1 });
await tryIt('card', { x: 52, y: 94, width: 176, height: 48, scale: 4 });
await tryIt('card f', { x: 52.0001, y: 94.0001, width: 176.0001, height: 48.0001, scale: 4 });
await tryIt('card f2', { x: 52.0001, y: 94.0001, width: 176.0001, height: 48.0001, scale: 4.0001 });
await b.close();
