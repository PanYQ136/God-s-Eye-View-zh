import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox'], defaultViewport: { width: 800, height: 600 } });
const p = await b.newPage();
await p.goto('about:blank');
const cdp = await p.createCDPSession();
const tryIt = async (label, clip) => {
  try { const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false }); console.log(label, 'OK', r.data.length); }
  catch (e) { console.log(label, 'ERR', String(e.message).slice(0, 130)); }
};
await tryIt('scale1.0001', { x: 38.0101, y: 187.3481, width: 204.0201, height: 70.8201, scale: 1.0001 });
await tryIt('scale4.0001', { x: 38.0101, y: 187.3481, width: 204.0201, height: 70.8201, scale: 4.0001 });
await tryIt('scale4', { x: 38.0101, y: 187.3481, width: 204.0201, height: 70.8201, scale: 4 });
await tryIt('scale1', { x: 38.0101, y: 187.3481, width: 204.0201, height: 70.8201, scale: 1 });
await b.close();
