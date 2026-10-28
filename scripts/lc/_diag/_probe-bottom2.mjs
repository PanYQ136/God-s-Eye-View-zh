import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'], protocolTimeout: 300000, defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(8000);
const p = await page.evaluate(() => { const b = document.querySelector('#location-bar .dock-tray-toggle').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(p.x, p.y, { steps: 3 }); await page.mouse.down(); await sleep(30); await page.mouse.up(); await sleep(1400);
const out = await page.evaluate(() => {
  const el = document.getElementById('location-bar');
  const cs = getComputedStyle(el);
  const r = { inline: el.getAttribute('style'), top: cs.top, bottom: cs.bottom, right: cs.right, left: cs.left, pos: cs.position, parent: el.parentElement.id || el.parentElement.className, offsetParent: (el.offsetParent && (el.offsetParent.id || el.offsetParent.className)) || null, compH: cs.height, sh: el.scrollHeight };
  el.style.height = 'auto'; r.autoH = getComputedStyle(el).height; r.autoSH = el.scrollHeight;
  el.style.bottom = 'auto'; el.style.right = 'auto'; r.noBottomH = getComputedStyle(el).height; r.noBottomSH = el.scrollHeight;
  el.style.height = ''; el.style.bottom = ''; el.style.right = '';
  return r;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
