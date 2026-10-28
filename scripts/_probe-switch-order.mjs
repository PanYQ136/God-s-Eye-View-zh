#!/usr/bin/env node
/** _probe-switch-order.mjs — 逐帧证明「先关旧、再开新」+ DOM 无 ✕ 关闭钮 */
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

const settle = async (max = 90) => {
  for (let i = 0; i < max; i++) {
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    if (!n) return;
    await sleep(35);
  }
};
const hdr = (id) => page.evaluate((id) => {
  const sel = id === 'pp-toggles' ? '#pp-toggles .pp-header-row' : '#' + id + ' .panel-header';
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  const x = r.x + Math.min(26, r.width * 0.25), y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x, y, rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], hitCard: hit && hit.closest('.gev-lc') ? hit.closest('.gev-lc').id : '' };
}, id);
const state = (ids) => page.evaluate((list) => Object.fromEntries(list.map((id) => {
  const el = document.getElementById(id);
  const c = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return [id, { open: el.classList.contains('gev-lc-floating') && !el.classList.contains('collapsed'), collapsed: el.classList.contains('collapsed'), hidden: c.visibility === 'hidden' || +c.opacity < 0.05, rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)] }];
})), ids);

const click = async (id) => {
  await settle();
  const p = await hdr(id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(25);
  await page.mouse.up();
  return p;
};

const log = [];
const pair = (from, to) => {
  // 采样器在点击前装好，记录 from/to 的 open 状态逐帧序列
  return page.evaluate((from, to) => {
    const g = (id) => {
      const el = document.getElementById(id);
      return el && el.classList.contains('gev-lc-floating') && !el.classList.contains('collapsed') ? 1 : 0;
    };
    const frames = [];
    let stop = false;
    const t0 = performance.now();
    const loop = () => {
      frames.push([Math.round(performance.now() - t0), g(from), g(to)]);
      if (!stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__ord = { frames, stop: () => { stop = true; return frames; } };
  }, from, to);
};

const cases = [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'],
  ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']];
const out = {};
for (const [from, to] of cases) {
  let st = await state([from, to]);
  if (!st[from].open) await click(from);
  await settle();
  await sleep(400);
  await pair(from, to);
  const p = await click(to);
  await settle();
  await sleep(500);
  const frames = await page.evaluate(() => window.__ord.stop());
  const end = await state([from, to]);
  // 折叠成变化序列
  const seq = [];
  let prev = null;
  for (const f of frames) {
    const k = f[1] + '' + f[2];
    if (k !== prev) { seq.push({ t: f[0], from: f[1], to: f[2] }); prev = k; }
  }
  let both = 0, neither = 0;
  for (const f of frames) { if (f[1] && f[2]) both++; if (!f[1] && !f[2]) neither++; }
  out[from + '->' + to] = {
    hit: p.hitCard, frames: frames.length, seq, overlapFrames: both, emptyFrames: neither,
    end: { fromOpen: end[from].open, fromHidden: end[from].hidden, toOpen: end[to].open, toHidden: end[to].hidden },
  };
}

// DOM 里是否残留任何 ✕ 关闭钮
const xinfo = await page.evaluate(() => {
  const closeEls = document.querySelectorAll('.gev-lc-close');
  const glyphs = [];
  for (const d of document.querySelectorAll('body *')) {
    if (d.children.length) continue;
    const t = (d.textContent || '').trim();
    if (!/[✕×✖✗]/.test(t)) continue;
    const r = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    glyphs.push({ el: d.tagName + '.' + String(d.className || '').slice(0, 30), txt: t.slice(0, 4), w: +r.width.toFixed(0), vis: cs.visibility, op: cs.opacity });
  }
  return { closeEls: closeEls.length, glyphs };
});
console.log(JSON.stringify({ cases: out, xinfo }, null, 1));
await browser.close();
