import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://127.0.0.1:4173/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox','--window-size=1372,934','--hide-scrollbars','--ignore-gpu-blocklist','--force_high_performance_gpu','--disable-background-timer-throttling'],
  protocolTimeout: 900000, defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await sleep(9000);
const out = await page.evaluate(() => {
  const rows = [];
  for (const sheet of document.styleSheets) {
    let n = 0, layered = 0, names = new Set();
    try {
      const walk = (list, depth) => {
        for (const r of list) {
          if (r.constructor.name === 'CSSLayerBlockRule') { if (depth===0) names.add(r.name||'(anon)'); walk(r.cssRules, depth+1); continue; }
          if (r.cssRules) { walk(r.cssRules, depth); continue; }
          n++; if (depth) layered++;
        }
      };
      walk(sheet.cssRules, 0);
    } catch (e) { rows.push({ href: sheet.href || 'inline', error: String(e).slice(0,60) }); continue; }
    rows.push({ href: (sheet.href || 'inline').split('/').slice(-2).join('/'), rules: n, layersAtTop: [...names].slice(0,6) });
  }
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
