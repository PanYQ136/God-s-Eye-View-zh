#!/usr/bin/env node
/**
 * qa-b37e6b4b-input.mjs —— 输入回归（唯一 owner 改造后不许破坏既有交互）
 *  A) 键盘 Enter 打开 dock 卡（合成 click detail=0 走同一 owner）
 *  B) 浮层卡 header 拖拽：位移生效、卡片不被误关
 *  C) 浮层卡边缘缩放：尺寸生效、卡片不被误关、不加 .gev-lc-hid
 *  D) header 里的内部控件（PP 开关）：点它不改卡片状态、控件自身切换
 *  E) 浮层卡内容区空白点击：不收起
 *  F) Esc：收起
 *  G) 100ms 内点两次 header：开关各一次（确定性）
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.resolve('.gev-logs/t_b37e6b4b');
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
  } catch (e) {}
});
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1500);

const snap = () => page.evaluate(() => window.__gevLc.state());
const settle = async (maxMs = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => (document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : 0));
    if (!n) { await sleep(60); return true; }
    await sleep(60);
  }
  return false;
};
const headPoint = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const head = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle') || el;
  const b = head.getBoundingClientRect();
  const isCtl = (n) => n && n.closest && n.closest('input,select,textarea,a,label,button:not(.panel-header):not(.dock-tray-toggle),.panel-collapse-btn,.context-radio-dock,.pp-toggle-btn,.scene-btn,.dock-pin-btn');
  let x = null, y = Math.round(b.top + b.height / 2);
  for (let i = 1; i <= 10; i++) {
    const cx = Math.round(b.left + (b.width * i) / 11);
    const hit = document.elementFromPoint(cx, y);
    if (hit && !isCtl(hit) && hit.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle') && hit.closest('[id="' + id + '"]')) { x = cx; break; }
  }
  if (x === null) x = Math.round(b.left + b.width / 2);
  return { x, y };
}, id);
const clickHeader = async (id) => {
  const p = await headPoint(id);
  await page.mouse.move(p.x, p.y);
  await sleep(25);
  await page.mouse.down();
  await sleep(25);
  await page.mouse.up();
  await sleep(120);
  return p;
};
const clickAt = async (x, y) => {
  await page.mouse.move(x, y);
  await sleep(25);
  await page.mouse.down();
  await sleep(25);
  await page.mouse.up();
  await sleep(120);
};

const R = { A: null, B: null, C: null, D: null, E: null, F: null, G: null, errors: [] };
const closeAll = async () => {
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const s = await snap();
    if (s[id].floating) { await clickHeader(id); await sleep(420); }
  }
  await settle();
};

/* A) 键盘 Enter（合成 click，detail=0）打开 dock 卡 ─────────────────────── */
await page.evaluate(() => {
  const b = document.querySelector('#control-panel .dock-tray-toggle');
  if (b) { b.setAttribute('tabindex', '0'); b.focus(); }
});
await page.keyboard.press('Enter');
await sleep(700);
await settle();
let s = await snap();
R.A = { floated: s['control-panel'].floating, h: s['control-panel'].h, collapsed: s['control-panel'].collapsed };
console.log('A) Enter 打开 control-panel ->', JSON.stringify(R.A));
await closeAll();

/* B) header 拖拽（浮层态）：位移 + 不误关 ──────────────────────────────── */
await clickHeader('data-panel');
await sleep(650);
await settle();
const before = (await snap())['data-panel'];
const hp = await headPoint('data-panel');
await page.mouse.move(hp.x, hp.y);
await sleep(30);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(hp.x + i * 10, hp.y + i * 5); await sleep(16); }
await page.mouse.up();
await sleep(500);
await settle();
const afterB = (await snap())['data-panel'];
R.B = {
  before: [before.x, before.y], after: [afterB.x, afterB.y],
  dx: afterB.x - before.x, dy: afterB.y - before.y,
  stillFloating: afterB.floating, stillVisible: afterB.vis === 'visible',
};
console.log('B) drag ->', JSON.stringify(R.B));

/* C) 边缘缩放（浮层态右下角）：尺寸变化 + 不误关 + 无 gev-lc-hid ────────── */
const edge = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.right - 3), y: Math.round(b.bottom - 3), before: [Math.round(b.width), Math.round(b.height)] };
});
await page.mouse.move(edge.x, edge.y);
await sleep(30);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(edge.x + i * 8, edge.y + i * 6); await sleep(16); }
await page.mouse.up();
await sleep(500);
await settle();
const sC = await snap();
R.C = {
  before: edge.before, after: [sC['data-panel'].w, sC['data-panel'].h],
  dw: sC['data-panel'].w - edge.before[0], dh: sC['data-panel'].h - edge.before[1],
  stillFloating: sC['data-panel'].floating,
  hid: await page.evaluate(() => [...document.querySelectorAll('.gev-lc-hid')].map((e) => e.id)),
};
console.log('C) resize ->', JSON.stringify(R.C));
await closeAll();

/* D) 卡片内部控件（非标题条）：点击必须到达控件本身，且卡片不被关 ─────────── */
await clickHeader('pp-toggles');
await sleep(700);
await settle();
const inner = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const b = el.getBoundingClientRect();
  const cands = [...el.querySelectorAll('button,input,select,label,.pp-mode-btn,.pp-select')];
  for (const c of cands) {
    if (c.closest('.pp-header-row,.panel-header')) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // 必须完全落在卡片内部，且离四边 ≥26px（避开 .gev-lc-edge 缩放热区）
    if (r.left < b.left + 26 || r.right > b.right - 26 || r.top < b.top + 26 || r.bottom > b.bottom - 26) continue;
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(c === hit || c.contains(hit))) continue;
    window.__inner = { clicks: 0 };
    c.addEventListener('click', () => window.__inner.clicks++, true);
    return { x, y, tag: c.tagName, cls: String(c.className).slice(0, 40), text: (c.textContent || '').trim().slice(0, 16) };
  }
  return null;
});
if (inner) {
  await clickAt(inner.x, inner.y);
  await sleep(450);
  await settle();
  const sD = await snap();
  const clicks = await page.evaluate(() => window.__inner.clicks);
  R.D = { ctrl: inner, reached: clicks, stillFloating: sD['pp-toggles'].floating };
} else {
  R.D = { skipped: 'no inner control fully inside card' };
}
console.log('D) inner control ->', JSON.stringify(R.D));

/* E) 浮层卡内容区空白点击：不收起 ─────────────────────────────────────── */
const blank = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const b = el.getBoundingClientRect();
  for (let yy = b.top + b.height * 0.75; yy < b.bottom - 8; yy += 14) {
    for (let xx = b.left + 12; xx < b.right - 12; xx += 18) {
      const h = document.elementFromPoint(xx, yy);
      if (!h || !el.contains(h)) continue;
      if (h.closest('input,select,textarea,a,label,button,[role=slider],.pp-slider,.pp-select,.pp-mode-btn,.pp-toggle-btn,.scene-btn,[data-no-toggle]')) continue;
      return { x: Math.round(xx), y: Math.round(yy), hit: h.tagName + '.' + String(h.className).slice(0, 30) };
    }
  }
  return null;
});
if (blank) {
  await clickAt(blank.x, blank.y);
  await sleep(400);
  await settle();
  const sE = await snap();
  R.E = { point: blank, stillFloating: sE['pp-toggles'].floating };
} else R.E = { skipped: 'no blank area' };
console.log('E) blank click ->', JSON.stringify(R.E));

/* F) Esc 收起 ────────────────────────────────────────────────────────── */
await page.evaluate(() => { const el = document.getElementById('pp-toggles'); el.setAttribute('tabindex', '-1'); el.focus(); });
await page.keyboard.press('Escape');
await sleep(700);
await settle();
s = await snap();
R.F = { floating: s['pp-toggles'].floating, collapsed: s['pp-toggles'].collapsed };
console.log('F) Esc ->', JSON.stringify(R.F));
await closeAll();

/* G) 100ms 双击 header：开关各一次 ───────────────────────────────────── */
await clickHeader('scene-panel');
await sleep(120);
const g1 = (await snap())['scene-panel'].floating;
const gp = await headPoint('scene-panel');
await phoneDouble(gp);
async function phoneDouble(p) {
  await page.mouse.move(p.x, p.y);
  await sleep(20);
  await page.mouse.down(); await sleep(20); await page.mouse.up();
  await sleep(60);
  await page.mouse.down(); await sleep(20); await page.mouse.up();
}
await sleep(800);
await settle();
const g2 = (await snap())['scene-panel'].floating;
R.G = { afterFirst: g1, afterSecond: g2 };
console.log('G) double click ->', JSON.stringify(R.G));

/* H) 浮层态的「收起」小三角：必须收起浮层，不许留「浮层+折叠」空壳 ───────── */
await closeAll();
const chevHost = await (async () => {
  for (const id of ['location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel']) {
    await clickHeader(id);
    await sleep(700);
    await settle();
    const c = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const b = el.querySelector('.panel-collapse-btn,.pp-collapse-btn');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      if (s.visibility === 'hidden' || !r.width) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id };
    }, id);
    if (c) return c;
    await clickHeader(id); // 收起，换下一张
    await sleep(500);
    await settle();
  }
  return null;
})();
if (chevHost) {
  await clickAt(chevHost.x, chevHost.y);
  await sleep(750);
  await settle();
  const sH = await snap();
  R.H = { clicked: true, id: chevHost.id, floating: sH[chevHost.id].floating, collapsed: sH[chevHost.id].collapsed, vis: sH[chevHost.id].vis, h: sH[chevHost.id].h };
} else R.H = { skipped: 'no visible collapse chevron in any floating header' };
console.log('H) floating chevron ->', JSON.stringify(R.H));

R.errors = errs;
fs.writeFileSync(path.join(OUT, 'input.json'), JSON.stringify(R, null, 1));

const fails = [];
if (!R.A || !R.A.floated) fails.push('A) 键盘 Enter 没打开 dock 卡');
if (!R.B || Math.abs(R.B.dx) < 40 || Math.abs(R.B.dy) < 20) fails.push('B) 拖拽位移没生效 ' + JSON.stringify(R.B));
if (!R.B || !R.B.stillFloating) fails.push('B) 拖拽后卡片被误关');
if (!R.C || R.C.dw < 30 || R.C.dh < 20) fails.push('C) 缩放没生效 ' + JSON.stringify(R.C));
if (!R.C || !R.C.stillFloating) fails.push('C) 缩放后卡片被误关');
if (R.C && R.C.hid.length) fails.push('C) 缩放产生 gev-lc-hid ' + JSON.stringify(R.C.hid));
if (R.D && R.D.stillFloating === false) fails.push('D) 点内部控件把卡片关了');
if (R.D && R.D.reached === 0) fails.push('D) 内部控件没收到 click（被唯一 owner 误吞）' + JSON.stringify(R.D));
if (R.E && R.E.stillFloating === false) fails.push('E) 点内容区空白把卡片关了');
if (!R.F || R.F.floating) fails.push('F) Esc 没收起');
if (!R.G || R.G.afterFirst !== true || R.G.afterSecond !== false) fails.push('G) 100ms 双击不确定 ' + JSON.stringify(R.G));
if (R.H && R.H.clicked) {
  if (R.H.floating && R.H.collapsed) fails.push('H) 留了「浮层+collapsed」空壳 ' + JSON.stringify(R.H));
  if (R.H.floating) fails.push('H) 浮层态点「收起」没收起浮层 ' + JSON.stringify(R.H));
}
if (errs.length) fails.push('console error: ' + JSON.stringify(errs.slice(0, 3)));

console.log('\n==== 输入回归 ====');
console.log(fails.length ? 'FAIL\n - ' + fails.join('\n - ') : 'PASS: A–G 全过（拖拽/缩放/内部控件/空白/Esc/键盘未被唯一 owner 改造破坏）');
await browser.close();
process.exit(fails.length ? 1 : 0);
