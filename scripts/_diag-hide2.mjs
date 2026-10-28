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
  window.__clicks = [];
  addEventListener('pointerdown', (e) => window.__clicks.push({ t: e.isTrusted, tag: e.target.tagName, cls: (e.target.className || '').toString().slice(0, 30) }), true);
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);

const tryClick = async (tag) => {
  const pt = await page.evaluate(() => {
    const h = document.querySelector('#data-panel .panel-header');
    const b = h.getBoundingClientRect();
    const x = Math.round(b.left + b.width / 2);
    const y = Math.round(b.top + b.height / 2);
    const hit = document.elementFromPoint(x, y);
    return [x, y, (hit?.className || '').toString().slice(0, 30)];
  });
  await page.mouse.move(pt[0], pt[1]);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
  await sleep(900);
  const st = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    return { floating: el.classList.contains('gev-lc-floating'), collapsed: el.classList.contains('collapsed'), vis: getComputedStyle(el).visibility };
  });
  console.log(tag, JSON.stringify(pt), JSON.stringify(st));
};

await tryClick('A-plain');
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(800);

// 拍两张全屏截图（复刻 m2 的 measureCard）
await page.screenshot({ encoding: 'base64' });
await page.evaluate(() => document.getElementById('data-panel').style.setProperty('visibility', 'hidden', 'important'));
await sleep(180);
await page.screenshot({ encoding: 'base64' });
await page.evaluate(() => document.getElementById('data-panel').style.removeProperty('visibility'));
await sleep(200);
await tryClick('B-after-screenshots');

await page.evaluate(() => {
  const st = document.createElement('style');
  st.textContent = `canvas { visibility: hidden !important; } body { background: repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0 / 8px 8px !important; }
  #hud-loading, .welcome-overlay, #welcome-overlay { display: none !important; }`;
  document.head.appendChild(st);
});
await sleep(500);
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(700);
await tryClick('C-with-checker');
console.log('clicks', JSON.stringify(await page.evaluate(() => window.__clicks.slice(-5))));
await page.screenshot({ path: '.gev-logs/final/diag-checker2.png' });
await browser.close();
