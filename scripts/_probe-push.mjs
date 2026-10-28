#!/usr/bin/env node
/** _probe-push.mjs —— 记录左栈 scene-panel 在 data-panel 展开后的位移时间线 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

// 关掉初始浮层，回到全迷你
for (let i = 0; i < 3; i++) { if (!(await page.evaluate(() => window.__gevLc._ids().length))) break; await page.keyboard.press('Escape'); await sleep(600); }
await sleep(800);

const hp = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const h = el.querySelector('.panel-header');
  const r = h.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5) };
});
// 采样时间线：每 40ms 记录 scene 的 rect + translate + push
const tl = await page.evaluate(async (pt) => {
  const out = [];
  window.__tl = out;
  const t0 = performance.now();
  const el = document.getElementById('scene-panel');
  const sampler = setInterval(() => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const s = window.__gevLc.state()['scene-panel'];
    out.push({
      t: Math.round(performance.now() - t0),
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
      translate: cs.translate,
      push: s && s.push,
      nat: s && s.nat ? [Math.round(s.nat.left), Math.round(s.nat.top)] : null,
      top: (() => { const e2 = document.elementFromPoint(84, Math.round(b.top + 8)); return e2 ? (e2.closest('.gev-lc') || {}).id || e2.tagName : null; })(),
    });
  }, 40);
  return { ok: true };
}, hp).catch((e) => ({ err: String(e) }));

// 真实点击 data-panel（timeline 已开始）
await page.mouse.move(hp.x, hp.y);
await page.mouse.down();
await page.mouse.up();
await sleep(1200);
const data = await page.evaluate(() => {
  const s = window.__gevLc.state()['scene-panel'];
  const d = window.__gevLc.state()['data-panel'];
  return { scene: s, data: d };
});
console.log('after 1.2s: data=', JSON.stringify(data.data && { x: data.data.x, y: data.data.y, w: data.data.w, h: data.data.h, floating: data.data.floating }));
console.log('           scene=', JSON.stringify(data.scene && { x: data.scene.x, y: data.scene.y, push: data.scene.push, nat: data.scene.nat }));
const timeline = await page.evaluate(() => window.__tl || []);
console.log('timeline (scene-panel):');
for (const s of timeline) console.log('  ', s.t + 'ms', 'rect=' + JSON.stringify(s.rect), 'tr=' + s.translate, 'push=' + JSON.stringify(s.push), 'nat=' + JSON.stringify(s.nat), 'top@ =' + s.top);
await browser.close();
