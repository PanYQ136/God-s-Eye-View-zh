import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('.gev-logs/lc/trans', { recursive: true });
const browser = await puppeteer.launch({ headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'], protocolTimeout: 300000, defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(8000);
const cdp = await page.createCDPSession();
let p = await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(p.x, p.y, { steps: 3 }); await page.mouse.down(); await sleep(28); await page.mouse.up();
await sleep(1400);
p = await page.evaluate(() => { const b = document.querySelector('#scene-panel .panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(p.x, p.y, { steps: 3 }); await page.mouse.down(); await sleep(28); await page.mouse.up();
const t0 = Date.now();
for (const at of [60, 150, 260, 420]) {
  const wait = at - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const info = await page.evaluate(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    return { d: r('data-panel'), s: r('scene-panel'), ph: window.__lc.api.phases() };
  });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 80, width: 420, height: 660, scale: 1 }, captureBeyondViewport: false });
  writeFileSync(`.gev-logs/lc/trans/t${at}.png`, Buffer.from(data, 'base64'));
  console.log(at, JSON.stringify(info));
}
await browser.close();
