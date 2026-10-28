#!/usr/bin/env node
/**
 * _probe-regress.mjs — 复现/回归：①左栏 data↔scene 切换（header 落空/点不开）
 *                              ②快速连点后 dock 卡飞出屏幕
 * 用法: node scripts/_probe-regress.mjs [--w=1344] [--h=730] [--tag=r1]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const W = parseInt(arg('w', '1344'), 10), H = parseInt(arg('h', '730'), 10);
const TAG = arg('tag', 'r1');
const OUT = path.resolve('.gev-logs/regress', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,900'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(7000);

const HEAD = {
  'data-panel': '#data-panel .panel-header',
  'scene-panel': '#scene-panel .panel-header',
  'pp-toggles': '#pp-toggles .pp-header-row',
  'cctv-panel': '#cctv-panel .panel-header',
  'global-context-panel': '#global-context-panel .panel-header',
  'location-bar': '#location-bar .dock-tray-toggle',
  'control-panel': '#control-panel .dock-tray-toggle',
};
const st = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const cards = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { cards[id] = null; continue; }
    const b = el.getBoundingClientRect(), c = getComputedStyle(el);
    cards[id] = { r: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      col: el.classList.contains('collapsed'), fl: el.classList.contains('gev-lc-floating'), vis: c.visibility,
      inView: b.x >= -1 && b.y >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 };
  }
  const open = [];
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('gev-lc-floating') && !el.classList.contains('collapsed')) open.push(id);
  }
  const ov = [];
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
    const a = cards[open[i]].r, b2 = cards[open[j]].r;
    const ix = Math.min(a[0] + a[2], b2[0] + b2[2]) - Math.max(a[0], b2[0]);
    const iy = Math.min(a[1] + a[3], b2[1] + b2[3]) - Math.max(a[1], b2[1]);
    if (ix > 2 && iy > 2) ov.push([open[i], open[j], ix, iy]);
  }
  return { cards, open, ov, vw: innerWidth, vh: innerHeight };
});
const probe = (id) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const x = b.x + Math.min(26, Math.max(8, b.width * 0.22)), y = b.y + b.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100,
    hit: hit && hit.closest ? (hit.closest('.gev-lc') || {}).id || hit.tagName : '', hdr: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] };
}, HEAD[id]);
const click = async (id) => { const p = await probe(id); if (p) await page.mouse.click(p.x, p.y); return p; };

const rep = { view: [W, H], left: [], rapid: [] };
await sleep(6000); // 等 dock 定位稳定后再取「初始原位」基准（dock 有 2px 级迟滞）
rep.init = await st();

// —— ① 左栏：data 开 → scene 点（互斥）→ data 点（切回）——
let p = await click('data-panel'); await sleep(2200);
rep.left.push({ step: 'open data', p, s: await st() });
p = await click('scene-panel'); await sleep(2200);
rep.left.push({ step: 'switch to scene', p, s: await st() });
p = await click('data-panel'); await sleep(2400);
rep.left.push({ step: 'switch back to data', p, s: await st() });
p = await click('scene-panel'); await sleep(2400);
rep.left.push({ step: 'switch to scene again', p, s: await st() });

// 清空
let cur = await st();
for (const id of cur.open.slice()) { await click(id); await sleep(1800); cur = await st(); }

// —— ② 快速连点全部 7 个 ——
for (const id of Object.keys(HEAD)) { const pp = await probe(id); if (pp) await page.mouse.click(pp.x, pp.y); await sleep(140); }
for (const t of [600, 1500, 3000, 5000]) {
  await sleep(t === 600 ? 600 : 900);
  const s = await st();
  rep.rapid.push({ at: t, open: s.open, ov: s.ov, cards: s.cards });
}
// 再点一次全部（第二轮）看是否可恢复
for (const id of Object.keys(HEAD)) { const pp = await probe(id); if (pp) await page.mouse.click(pp.x, pp.y); await sleep(140); }
await sleep(3500);
const s2 = await st();
rep.rapid2 = { open: s2.open, ov: s2.ov, cards: s2.cards };

// 全收起 → 归位
for (const id of Object.keys(HEAD)) { const c = await st(); if (!c.cards[id].col) { await click(id); await sleep(1600); } }
await sleep(1200);
const s3 = await st();
const diff = [];
for (const id of Object.keys(rep.init.cards)) {
  const a = rep.init.cards[id], b2 = s3.cards[id];
  if (!a || !b2) continue;
  const d = Math.max(...a.r.map((v, i) => Math.abs(v - b2.r[i])));
  if (d > 1.5) diff.push({ id, base: a.r, fin: b2.r, d });
}
rep.collapse = { open: s3.open, diff, ov: s3.ov, cards: s3.cards };

// 摘要
const F = [];
for (const step of rep.left) {
  const s = step.s;
  if (s.open.length > 2) F.push(`left step "${step.step}" 展开 ${s.open.length} 张: ${s.open}`);
  for (const id of ['data-panel', 'scene-panel']) {
    const c = s.cards[id];
    if (c && !c.col === false && c.col === false && c.r[0] > 60) F.push(`left step "${step.step}" ${id} 展开但 x=${c.r[0]} 越界`);
  }
}
// 期望：第 2 步 scene 开 / data 收；第 3 步 data 开 / scene 收；第 4 步 scene 开 / data 收
const exp = [
  { step: 'open data', want: ['data-panel'] },
  { step: 'switch to scene', want: ['scene-panel'] },
  { step: 'switch back to data', want: ['data-panel'] },
  { step: 'switch to scene again', want: ['scene-panel'] },
];
for (const e of exp) {
  const got = rep.left.find((x) => x.step === e.step).s.open;
  if (JSON.stringify(got) !== JSON.stringify(e.want)) F.push(`左栏期望 [${e.want}] 实际 [${got}] @ ${e.step}`);
}
const offscreen = [];
for (const r of rep.rapid.concat([{ at: 'rapid2', ...rep.rapid2 }])) {
  for (const [id, c] of Object.entries(r.cards)) {
    if (c && c.vis !== 'hidden' && c.r[2] > 2 && !c.inView) offscreen.push({ at: r.at, id, r: c.r, col: c.col });
  }
}
if (offscreen.length) F.push(`飞出屏幕: ${JSON.stringify(offscreen)}`);
if (rep.collapse.ov.length) F.push(`收起后仍有重叠: ${JSON.stringify(rep.collapse.ov)}`);
if (rep.collapse.diff.length) F.push(`收起未归位: ${JSON.stringify(rep.collapse.diff)}`);

fs.writeFileSync(path.join(OUT, 'regress.json'), JSON.stringify(rep, null, 1));
console.log('--- left ---');
for (const x of rep.left) console.log(x.step, '| probe', JSON.stringify(x.p), '| open', JSON.stringify(x.s.open), '| data', JSON.stringify(x.s.cards['data-panel'].r), x.s.cards['data-panel'].col, '| scene', JSON.stringify(x.s.cards['scene-panel'].r), x.s.cards['scene-panel'].col);
console.log('--- rapid ---');
for (const r of rep.rapid) console.log('t=' + r.at, 'open', JSON.stringify(r.open), 'ov', JSON.stringify(r.ov), '| LB', JSON.stringify(r.cards['location-bar'].r), 'CP', JSON.stringify(r.cards['control-panel'].r));
console.log('--- rapid2 ---', JSON.stringify(rep.rapid2.open), '| LB', JSON.stringify(rep.rapid2.cards['location-bar'].r), 'CP', JSON.stringify(rep.rapid2.cards['control-panel'].r));
console.log('--- collapse ---', JSON.stringify(rep.collapse.open), 'diff', JSON.stringify(rep.collapse.diff));
console.log('=== FAIL', F.length, '===');
F.forEach((f) => console.log(' -', f));
process.exitCode = F.length ? 1 : 0;
await browser.close();
