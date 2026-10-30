import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox'], defaultViewport: { width: 800, height: 600 } });
const p = await b.newPage();
await p.goto('about:blank');
const cdp = await p.createCDPSession();
const tryIt = async (label, clip) => {
  try {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
    console.log(label, 'OK', r.data.length);
  } catch (e) { console.log(label, 'ERR', String(e.message).slice(0, 120)); }
};
await tryIt('A int', { x: 10, y: 10, width: 100, height: 100, scale: 1 });
await tryIt('B float', { x: 10.5, y: 10.5, width: 100.5, height: 100.5, scale: 1 });
await tryIt('C float+scale1', { x: 10.5, y: 10.5, width: 100.5, height: 100.5, scale: 1 });
await tryIt('D no scale', { x: 10.5, y: 10.5, width: 100.5, height: 100.5 });
await tryIt('E scale 2', { x: 10.5, y: 10.5, width: 100.5, height: 100.5, scale: 2 });
await tryIt('F big', { x: 38.0101, y: 187.3481, width: 204.0201, height: 70.8201, scale: 1 });
await tryIt('G big no scale', { x: 38.0101, y: 187.3481, width: 204.0201, height: 70.8201 });
await tryIt('H round', { x: 38, y: 187, width: 204, height: 70, scale: 1 });
await b.close();
