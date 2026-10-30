import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const profile = mkdtempSync(join(tmpdir(), 'gev-probe-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const t0 = Date.now();
await page.goto(BASE + '&probe=' + Date.now(), { waitUntil: 'domcontentloaded' });
console.log('dcl wall', Date.now() - t0);
let last = null;
for (let i = 0; i < 24; i++) {
  const s = await page.evaluate(() => {
    const lc = window.__lc && window.__lc.api;
    const g = window.__gevBoot;
    return {
      t: Math.round(performance.now()),
      mounted: !!(lc && lc.mounted),
      mountedAt: (lc && lc.mountedAt) ?? null,
      inputReleased: !!(g && g.inputReleased),
      cesium: !!window.Cesium,
      viewer: !!window.__gevViewer,
      voice: !!document.getElementById('gev-voice-control'),
    };
  }).catch((e) => ({ err: String(e).slice(0, 120) }));
  last = s;
  console.log(i, JSON.stringify(s));
  if (s.inputReleased && s.cesium) break;
  await new Promise((r) => setTimeout(r, 250));
}
const tl = await page.evaluate(() => {
  try { return window.__bootTimeline.snapshot().marks.map((m) => [m.name, Math.round(m.t)]); } catch (e) { return 'none'; }
});
console.log('marks', JSON.stringify(tl));
const lc = await page.evaluate(() => {
  const a = window.__lc && window.__lc.api;
  if (!a) return null;
  return { phases: a.phases(), input: a.inputReleasedAt, appApiAt: a.appApiAt, diag: window.__lc.diagnostics || null, port: a.port() };
});
console.log('lc', JSON.stringify(lc));
console.log('errors', JSON.stringify(errors.slice(0, 10)));
await browser.close();
