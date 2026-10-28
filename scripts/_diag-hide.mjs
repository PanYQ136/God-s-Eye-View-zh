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
  window.__gevcDebug = true;
  window.__clicks = [];
  addEventListener('pointerdown', (e) => window.__clicks.push({ t: e.isTrusted, tag: e.target.tagName, cls: (e.target.className || '').toString().slice(0, 40) }), true);
});
const errs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errs.push(t.slice(0, 200));
  if (t.startsWith('[gev-lc]')) errs.push('DBG ' + t.slice(0, 200));
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);

const clickHeader = async (sel) => {
  const pt = await page.evaluate((s) => {
    const h = document.querySelector(s);
    if (!h) return null;
    const b = h.getBoundingClientRect();
    const x = Math.round(b.left + b.width / 2);
    const y = Math.round(b.top + b.height / 2);
    const hit = document.elementFromPoint(x, y);
    return [x, y, (hit?.className || '').toString().slice(0, 40), hit?.tagName];
  }, sel);
  await page.mouse.click(pt[0], pt[1]);
  await sleep(900);
  const st = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    return { floating: el.classList.contains('gev-lc-floating'), collapsed: el.classList.contains('collapsed') };
  });
  return { pt, st };
};

console.log('BEFORE-HIDE', JSON.stringify(await clickHeader('#data-panel .panel-header')));
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(700);
console.log('clicks so far', JSON.stringify(await page.evaluate(() => window.__clicks)));

await page.evaluate(() => {
  const st = document.createElement('style');
  st.id = '__qa_checker';
  st.textContent = `canvas { visibility: hidden !important; } body { background: repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0 / 8px 8px !important; }`;
  document.head.appendChild(st);
});
await sleep(600);
console.log('AFTER-HIDE', JSON.stringify(await clickHeader('#data-panel .panel-header')));
await page.screenshot({ path: '.gev-logs/final/diag-checker.png' });
console.log('ERR/DBG', JSON.stringify(errs.slice(-12), null, 1));
console.log('clicks', JSON.stringify(await page.evaluate(() => window.__clicks.slice(-4))));
await browser.close();
