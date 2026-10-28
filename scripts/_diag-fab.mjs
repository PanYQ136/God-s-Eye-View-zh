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
  localStorage.removeItem('gev-liquid-cards:v2:last');
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);
const out = await page.evaluate(() => {
  const chain = (el) => {
    const a = [];
    let n = el;
    while (n && n !== document.body && a.length < 8) {
      const cs = getComputedStyle(n);
      a.push({ tag: n.tagName, id: n.id, cls: (n.className || '').toString().slice(0, 50), bg: cs.backgroundColor, bgi: cs.backgroundImage.slice(0, 40), bd: cs.backdropFilter, shadow: cs.boxShadow.slice(0, 60) });
      n = n.parentElement;
    }
    return a;
  };
  const fab = document.getElementById('gev-gfx-fab');
  const walk = [fab, ...fab.querySelectorAll('*')].map((n) => {
    const cs = getComputedStyle(n);
    const b = n.getBoundingClientRect();
    return { tag: n.tagName, cls: (n.className || '').toString().slice(0, 40), r: [Math.round(b.width), Math.round(b.height)], bg: cs.backgroundColor, bgi: cs.backgroundImage.slice(0, 50), bd: cs.backdropFilter, shadow: cs.boxShadow.slice(0, 80) };
  });
  return { fabChain: chain(fab), fabWalk: walk };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
