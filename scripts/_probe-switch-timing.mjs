#!/usr/bin/env node
/** _probe-switch-timing.mjs — MutationObserver 精确量「关旧→开新」的时间差 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 60000 });
for (let i = 0; i < 100; i++) {
  const loading = await page.evaluate(() => {
    const l = document.getElementById('loading-screen');
    return l ? getComputedStyle(l).display !== 'none' && +getComputedStyle(l).opacity > 0.05 : false;
  });
  if (!loading) break;
  await sleep(400);
}
await sleep(7000);

const openOf = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  return el.classList.contains('gev-lc-floating') && !el.classList.contains('collapsed');
}, id);
const hdr = (id) => page.evaluate((id) => {
  const sel = id === 'pp-toggles' ? '#pp-toggles .pp-header-row' : '#' + id + ' .panel-header';
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  const x = r.x + Math.min(26, r.width * 0.25), y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x, y, hitCard: hit && hit.closest('.gev-lc') ? hit.closest('.gev-lc').id : '' };
}, id);
const clickReal = async (id) => {
  const p = await hdr(id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(25);
  await page.mouse.up();
  return p.hitCard;
};

// 装 MutationObserver：记录 class 变化时刻 + 状态翻转
const install = (ids) => page.evaluate((ids) => {
  window.__obs = [];
  window.__t0 = performance.now();
  for (const id of ids) {
    const el = document.getElementById(id);
    const m = new MutationObserver(() => {
      window.__obs.push({
        t: +(performance.now() - window.__t0).toFixed(1),
        id,
        open: el.classList.contains('gev-lc-floating') && !el.classList.contains('collapsed'),
        collapsed: el.classList.contains('collapsed'),
      });
    });
    m.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  return true;
}, ids);

const read = () => page.evaluate(() => {
  // 只保留 open 状态翻转
  const flips = [];
  let prev = null;
  for (const o of window.__obs) {
    const k = o.id + ':' + o.open;
    if (k === prev) continue;
    flips.push(o);
    prev = k;
  }
  return { flips, raw: window.__obs.length };
});

const cases = [['data-panel', 'scene-panel'], ['pp-toggles', 'cctv-panel']];
const out = {};
for (const [from, to] of cases) {
  if (!(await openOf(from))) { await clickReal(from); await sleep(1600); }
  await sleep(600);
  await install([from, to]);
  const hit = await clickReal(to);
  await sleep(2500);
  const { flips, raw } = await read();
  const fromFlip = flips.find((f) => f.id === from && f.open === false);
  const toFlip = flips.find((f) => f.id === to && f.open === true);
  out[from + '->' + to] = {
    hit,
    fromClosedAt: fromFlip ? fromFlip.t : null,
    toOpenedAt: toFlip ? toFlip.t : null,
    gapMs: fromFlip && toFlip ? +(toFlip.t - fromFlip.t).toFixed(1) : null,
    flips,
    rawAttrs: raw,
  };
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
