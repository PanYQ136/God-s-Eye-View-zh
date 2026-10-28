#!/usr/bin/env node
/** _probe-collapse2.mjs — 定位「收起后右栏上移 96px」 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const URL = 'http://127.0.0.1:4173/?welcome=0';

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
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });

const snap = () => page.evaluate((IDS) => {
  const rects = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) { rects[id] = null; continue; }
    const r = el.getBoundingClientRect();
    rects[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
  }
  const rail = document.getElementById('right-context-rail');
  const cs = rail ? getComputedStyle(rail) : null;
  const rr = rail ? rail.getBoundingClientRect() : null;
  const per = {};
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const c = getComputedStyle(el);
    per[id] = {
      translate: c.translate, transform: c.transform, top: c.top, position: c.position,
      collapsed: el.classList.contains('collapsed'), cls: el.className,
    };
  }
  return {
    rects,
    rail: rail ? {
      rect: [+rr.x.toFixed(1), +rr.y.toFixed(1), +rr.width.toFixed(1), +rr.height.toFixed(1)],
      top: cs.top, transform: cs.transform, translate: cs.translate,
      display: cs.display, flexDir: cs.flexDirection, justify: cs.justifyContent, align: cs.alignItems,
      gap: cs.gap, padding: cs.padding, height: cs.height, overflow: cs.overflow,
      styleAttr: rail.getAttribute('style') || '',
    } : null,
    per,
  };
}, IDS);

const stable = async (tries = 12, gap = 400) => {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = JSON.stringify((await snap()).rects);
    if (cur === prev) return;
    prev = cur;
    await sleep(gap);
  }
};
const clickHeader = async (id) => {
  const sel = id === 'pp-toggles' ? '#pp-toggles .pp-header-row' : `#${id} .panel-header`;
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // 取 header 内部偏左的空白处，避开标题文字命中
    return { x: r.x + Math.min(24, r.width / 2), y: r.y + r.height / 2 };
  }, sel);
  if (!box) throw new Error('no header ' + sel);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
};

// 等 loading 消失 + 稳定
for (let i = 0; i < 60; i++) {
  const gone = await page.evaluate(() => {
    const l = document.getElementById('loading-screen');
    return !l || getComputedStyle(l).display === 'none' || +getComputedStyle(l).opacity < 0.05;
  });
  if (gone) break;
  await sleep(500);
}
await sleep(6000);
await stable();

const s0 = await snap();
console.log('INIT', JSON.stringify(s0, null, 1));

await clickHeader('pp-toggles');
await sleep(1600);
await stable();
const s1 = await snap();
console.log('OPEN', JSON.stringify(s1.per), JSON.stringify(s1.rail), JSON.stringify(s1.rects));

await clickHeader('pp-toggles');
await sleep(1600);
await stable();
const s2 = await snap();
console.log('CLOSED', JSON.stringify(s2.per), JSON.stringify(s2.rail), JSON.stringify(s2.rects));
console.log('DIFF', JSON.stringify(IDS.map((id) => [id, s0.rects[id], s2.rects[id]]).filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))));

await browser.close();
