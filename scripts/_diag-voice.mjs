import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => localStorage.setItem('gev:first-run-mission:v1', 'suppressed'));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);

const info = () =>
  page.evaluate(() => {
    const v = document.getElementById('gev-voice-control');
    const d = document.getElementById('command-dock');
    const cs = getComputedStyle(v);
    const dc = getComputedStyle(d);
    return {
      dock: { r: d.getBoundingClientRect().toJSON(), h: dc.height, minH: dc.minHeight, ai: dc.alignItems, disp: dc.display },
      voice: {
        r: v.getBoundingClientRect().toJSON(),
        h: cs.height,
        margin: cs.margin,
        alignSelf: cs.alignSelf,
        translate: cs.translate,
        transform: cs.transform,
        top: cs.top,
        position: cs.position,
        offsetTop: v.offsetTop,
        offsetH: v.offsetHeight,
        padding: cs.padding,
        boxSizing: cs.boxSizing,
        gridRows: cs.gridTemplateRows,
        styleAttr: v.getAttribute('style'),
      },
      inlineDock: d.getAttribute('style'),
    };
  });

console.log('FIRST', JSON.stringify(await info(), null, 1));
await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.open(i)));
await sleep(1500);
await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
await sleep(1500);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);
console.log('AFTER RELOAD', JSON.stringify(await info(), null, 1));
await browser.close();
