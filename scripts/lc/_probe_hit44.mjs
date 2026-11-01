import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__lc && window.__lc.api && window.__gevEdge && window.__gevEdge.stats().count > 0, { timeout: 60000 });
await sleep(4000);
const h = await page.evaluate(() => { const r = document.querySelector('#pp-toggles .pp-header-row').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(h.x, h.y, { steps: 5 }); await page.mouse.down(); await sleep(60); await page.mouse.up();
await sleep(1500);
const out = await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  const rows = Array.from(card.querySelectorAll('.pp-toggle-group > .pp-slider-row')).slice(0, 4);
  const res = [];
  for (const k of rows) {
    const r = k.getBoundingClientRect();
    const cs = getComputedStyle(k, '::after');
    const hitAt = (dy) => {
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(dy));
      return !!(el && (el === k || k.contains(el) || (el.closest && el.closest('.pp-toggle-group > *') === k)));
    };
    let up = 0, down = 0;
    for (let d = 1; d <= 12; d++) { if (hitAt(r.top - d)) up = d; else break; }
    for (let d = 1; d <= 12; d++) { if (hitAt(r.bottom + d)) down = d; else break; }
    res.push({ cls: String(k.className).split(' ')[0], rowH: +r.height.toFixed(2), pseudoH: cs.height, pseudoTop: cs.top, pseudoBottom: cs.bottom, hitUp: up, hitDown: down, hitTotal: +(r.height + up + down).toFixed(2) });
  }
  return { phase: card.getAttribute('data-lc-phase'), res };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
