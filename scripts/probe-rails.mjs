import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); localStorage.setItem('gev.perfMode', '0'); localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' })); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
const snap = (tag) => page.evaluate((tag) => {
  const g = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const L = document.getElementById('left-panel-stack'), R = document.getElementById('right-context-rail');
  return { tag, t: Math.round(performance.now()), data: g('data-panel'), pp: g('pp-toggles'), stack: (L.style.transform || '') + ' | top=' + getComputedStyle(L).top, railTop: getComputedStyle(R).top, railT: (R.style.transform || '') };
}, tag);
const log = [];
for (const [ms, tag] of [[9000, 't=9s'], [3000, 't=12s'], [8000, 't=20s'], [10000, 't=30s'], [20000, 't=50s']]) {
  await sleep(ms); log.push(await snap(tag));
  if (tag === 't=12s') await page.keyboard.press('Escape');
}
console.log(JSON.stringify(log, null, 1));
await browser.close();
