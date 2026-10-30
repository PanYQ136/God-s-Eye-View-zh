#!/usr/bin/env node
/* READ-ONLY review probe 6: how much of the top-edge contrast is eaten by the card's
   :hover ::before 12px white gloss (0.4+0.16) sitting ABOVE the lens canvas?
   Measure the same top-edge peak with the pointer parked on the card vs away. */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, H = 774;
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(4500);
await page.mouse.move(4, 400);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(600);
const p = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const t = el.querySelector('.panel-header,.pp-header-row') || el;
  const b = t.getBoundingClientRect();
  return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
});
await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testBg(true, 8, 128);
});
await sleep(1600);
const decode = async (b64) => {
  await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    window.__rev = { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, b64);
  return page.evaluate(() => window.__rev);
};
const measure = async (label) => {
  await sleep(900);
  const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const hov = await page.evaluate(() => document.getElementById('data-panel').matches(':hover'));
  const on = await decode(await shot());
  await page.evaluate(() => window.__gevEdge.off());
  await sleep(700);
  const off = await decode(await shot());
  await page.evaluate(() => window.__gevEdge.on());
  const K = on.w / W;
  const x0 = Math.round((r.x + r.w * 0.3) * K), x1 = Math.round((r.x + r.w * 0.7) * K);
  const prof = [];
  for (let dy = 0; dy < 10; dy++) {
    const y = Math.round((r.y + dy) * K);
    let ss = 0, n = 0, offLum = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * on.w + x) * 4;
      const dOn = 0.2126 * on.d[i] + 0.7152 * on.d[i + 1] + 0.0722 * on.d[i + 2];
      const dOff = 0.2126 * off.d[i] + 0.7152 * off.d[i + 1] + 0.0722 * off.d[i + 2];
      ss += Math.abs(dOn - dOff); offLum += dOff; n++;
    }
    prof.push({ dy, delta: +(ss / n).toFixed(2), base: +(offLum / n).toFixed(1) });
  }
  const peak = Math.max.apply(null, prof.map((x) => x.delta));
  console.log(label, 'hover=' + hov, 'peak=' + peak.toFixed(2), 'base(row0)=' + prof[0].base, JSON.stringify(prof));
};
await measure('pointer ON card   ');
await page.mouse.move(2, 2);
await sleep(500);
await measure('pointer AWAY      ');
await browser.close();
