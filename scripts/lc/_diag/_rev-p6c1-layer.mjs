#!/usr/bin/env node
/* READ-ONLY review probe 5: who paints the ~0.5 attenuation above the lens at the top edge? */
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
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(4000);
await page.mouse.move(4, 400);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(600);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header,.pp-header-row') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
const out = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const b = el.getBoundingClientRect();
  const x = Math.round(b.x + b.width * 0.5);
  const rows = [];
  for (let dy = 0; dy <= 6; dy++) {
    const stack = document.elementsFromPoint(x, Math.round(b.y + dy)).slice(0, 6).map((e) => {
      const s = getComputedStyle(e);
      const bef = getComputedStyle(e, '::before');
      const aft = getComputedStyle(e, '::after');
      return {
        id: e.id || e.className || e.tagName,
        z: s.zIndex, bg: s.backgroundColor, bgi: s.backgroundImage.slice(0, 70), op: s.opacity,
        shadow: String(s.boxShadow).slice(0, 90),
        before: { content: bef.content, bg: bef.backgroundColor, bgi: bef.backgroundImage.slice(0, 60), h: bef.height, inset: bef.inset },
        after: { content: aft.content, bg: aft.backgroundColor },
      };
    });
    let stackTop = null;
    try {
      stackTop = document.elementsFromPoint(x, Math.round(b.y + dy)).map((e) => (e.id || e.className || e.tagName)).join(' > ');
    } catch (e) {}
    rows.push({ dy, stackTop, stack });
  }
  const cs = getComputedStyle(el);
  return { rect: { x: b.x, y: b.y, w: b.width, h: b.height }, phase: el.dataset.lcPhase, cls: el.className,
    vars: { shell: getComputedStyle(el).getPropertyValue('--lc-shell-fill'), gloss: getComputedStyle(el).getPropertyValue('--lc-gloss'), soft: getComputedStyle(el).getPropertyValue('--lc-soft-fill') },
    bg: cs.backgroundColor, rows };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
