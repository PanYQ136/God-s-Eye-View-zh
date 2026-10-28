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
await page.evaluateOnNewDocument(() => {
  localStorage.removeItem('gev-liquid-cards:v2');
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);
const out = await page.evaluate(() => {
  const fab = document.getElementById('gev-gfx-fab');
  const desc = (n, pseudo) => {
    const cs = getComputedStyle(n, pseudo);
    return {
      what: (n.id ? '#' + n.id : n.tagName) + (pseudo || '') + '.' + (n.className || '').toString().slice(0, 30),
      bg: cs.backgroundColor,
      bgi: (cs.backgroundImage || '').slice(0, 60),
      bd: cs.backdropFilter,
      filter: cs.filter,
      border: cs.border,
      shadow: (cs.boxShadow || '').slice(0, 120),
      content: cs.content,
    };
  };
  const rows = [desc(fab), desc(fab, '::before'), desc(fab, '::after')];
  fab.querySelectorAll('*').forEach((n) => {
    rows.push(desc(n));
    rows.push(desc(n, '::before'));
    rows.push(desc(n, '::after'));
  });
  return { html: fab.outerHTML.slice(0, 900), rows };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
