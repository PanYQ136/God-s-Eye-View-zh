import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = mkdtempSync(join(tmpdir(), 'gev-404-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.clearBrowserCache').catch(() => {});
const notFound = [];
const failed = [];
cdp.on('Network.responseReceived', (e) => { if (e.response.status === 404) notFound.push(e.response.url); });
cdp.on('Network.loadingFailed', (e) => failed.push(e.errorText));
await page.goto('http://127.0.0.1:4174/?welcome=0&n=' + Date.now(), { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 16000));
const st = await page.evaluate(() => {
  const lc = window.__lc && window.__lc.api;
  const g = window.__gevBoot && window.__gevBoot.snapshot();
  return { mounted: lc && lc.mountedAt, input: g && g.inputReleasedAt, interactive: g && g.interactiveAt, photoreal: !!window.__gevPhotoreal?.ready, globe: window.__gevViewer?.scene?.globe?.show, phases: lc && lc.phases(), port: lc && lc.port(), diag: window.__lc?.diagnostics || null };
});
console.log('state', JSON.stringify(st));
console.log('404s', notFound.length, JSON.stringify(notFound.slice(0, 10)));
console.log('failed', failed.length, JSON.stringify([...new Set(failed)].slice(0, 6)));
await browser.close();
