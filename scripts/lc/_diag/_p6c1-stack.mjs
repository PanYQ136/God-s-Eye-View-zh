/* Phase6C1 探针4：折射 canvas 为何不上屏 —— 合成栈 + z-index 试穿 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const W = 1348, H = 774;
mkdirSync('.gev-logs/lc/phase6c1', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {} });
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(4500);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(900);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar-label') || el;
    const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1300);
}
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.eyes) || (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; if (v) v.useDefaultRenderLoop = false; });
await sleep(900);
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(400);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });

const chain = await page.evaluate(() => {
  const lens = document.getElementById('gev-edge-lens');
  const ces = [...document.querySelectorAll('canvas')].find((c) => c.id !== 'gev-edge-lens' && c.width > 400);
  const info = (el) => {
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className || '').slice(0, 40),
      pos: s.position, z: s.zIndex, op: s.opacity, tr: s.transform !== 'none' ? s.transform.slice(0, 30) : 'none',
      filt: s.filter !== 'none' ? s.filter.slice(0, 30) : 'none', iso: s.isolation, contain: s.contain,
      willChange: s.willChange, mix: s.mixBlendMode, clip: s.clipPath,
    };
  };
  const up = (el, n) => { const out = []; let e = el; while (e && e !== document.documentElement && out.length < n) { out.push(info(e)); e = e.parentElement; } return out; };
  const bodyKids = [...document.body.children].map((el) => { const i = info(el); const b = el.getBoundingClientRect(); i.size = Math.round(b.width) + 'x' + Math.round(b.height); return i; })
    .filter((i) => i.pos !== 'static' || i.z !== 'auto' || i.size !== '0x0');
  return { lensChain: up(lens, 4), mapChain: up(ces, 4), bodyKids, lensStyle: lens ? lens.getAttribute('style') : null };
});
console.log('=== LENS chain ===');
chain.lensChain.forEach((x) => console.log(JSON.stringify(x)));
console.log('=== MAP chain ===');
chain.mapChain.forEach((x) => console.log(JSON.stringify(x)));
console.log('=== BODY kids (positioned/sized) ===');
chain.bodyKids.forEach((x) => console.log(JSON.stringify(x)));
console.log('lens style:', chain.lensStyle);
await browser.close();
