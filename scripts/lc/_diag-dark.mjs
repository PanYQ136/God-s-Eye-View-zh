import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'], protocolTimeout: 300000, defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(8000);
const pt = await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(pt.x, pt.y, { steps: 3 }); await page.mouse.down(); await sleep(30); await page.mouse.up(); await sleep(1400);
const out = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  /* 卡内靠左上、但避开文字：x = r.x + 24, y = r.y + r.h * 0.55 */
  const probe = (x, y) => {
    const stack = document.elementsFromPoint(x, y).slice(0, 8).map((n) => {
      const cs = getComputedStyle(n);
      return { tag: n.tagName, id: n.id || '', cls: (n.className || '') + '', bg: cs.backgroundColor, bgi: cs.backgroundImage === 'none' ? 'none' : 'HAS', bf: cs.backdropFilter || cs.webkitBackdropFilter, op: cs.opacity, z: cs.zIndex, pe: cs.pointerEvents };
    });
    return { x, y, stack };
  };
  return {
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    inside: probe(Math.round(r.x + 24), Math.round(r.y + r.height * 0.55)),
    inside2: probe(Math.round(r.x + r.width * 0.5), Math.round(r.y + r.height * 0.75)),
    /* 所有可能画底的固定层 */
    overlays: [...document.body.children].filter((n) => {
      const cs = getComputedStyle(n);
      return cs.position === 'fixed' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || (cs.position === 'fixed' && cs.backgroundImage !== 'none');
    }).map((n) => ({ id: n.id, cls: (n.className || '') + '', bg: getComputedStyle(n).backgroundColor, z: getComputedStyle(n).zIndex })),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
