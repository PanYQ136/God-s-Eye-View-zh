#!/usr/bin/env node
/** _probe-close2.mjs —— 7 张卡逐个：真实点击 header → 测 .gev-lc-close → 点它 → 验关闭 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(11000);

const hp = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  for (const sel of ['.panel-header', '.pp-header-row', '.dock-tray-toggle', '.location-toolbar']) {
    const n = el.querySelector(sel);
    if (!n) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 40) continue;
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5) };
  }
  return null;
}, id);

for (const id of CARDS) {
  const before = await page.evaluate((id) => window.__gevLc.info(id), id);
  const p = await hp(id);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await sleep(750);
  const st = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const b = el.querySelector('.gev-lc-close');
    const r = b ? b.getBoundingClientRect() : null;
    const cs = b ? getComputedStyle(b) : null;
    return {
      info: window.__gevLc.info(id),
      close: b ? { w: Math.round(r.width), h: Math.round(r.height), disp: cs.display, x: Math.round(r.left), y: Math.round(r.top) } : null,
      childOfCard: b ? b.parentElement === el : null,
      cls: el.className,
    };
  }, id);
  console.log(id, 'before=', JSON.stringify(before), '=> floating=', st.info.floating, 'close=', JSON.stringify(st.close), 'directChild=', st.childOfCard);
  if (st.close && st.close.w >= 24) {
    await page.mouse.move(st.close.x + st.close.w / 2, st.close.y + st.close.h / 2, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    await sleep(800);
    const after = await page.evaluate((id) => window.__gevLc.info(id), id);
    console.log('   clicked close => floating=', after.floating);
  } else {
    await page.keyboard.press('Escape');
    await sleep(700);
  }
}
await browser.close();
