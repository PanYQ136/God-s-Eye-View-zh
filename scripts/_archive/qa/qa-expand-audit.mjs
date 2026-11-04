#!/usr/bin/env node
/**
 * qa-expand-audit.mjs —— 展开互斥复核（t_f8d97c1c）
 *   7 张可展开卡：单独展开 7 次 + 12 个 combo（每个左栏 × 每个右栏 × 每个 dock）
 *   → 每个状态量「可见卡两两重叠面积」= 0；展开态按钮不被其它卡盖住；
 *   → 收全部后 7 卡 rect 与基线逐项一致；3 个曾重叠 combo 截图。
 * 打开方式：单个 page.evaluate 里连调 __gevLc.open()（最苛刻：同一 tick，无帧间隔，
 *   正是原 bug 的触发条件 —— 兄弟卡仍在 morph 首帧）。
 * 用法: node scripts/qa-expand-audit.mjs [outDir]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'evidence/_collab/t_f8d97c1c';
const VW = 1536, VH = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const EXTRA = ['gev-gfx-fab'];
const COMBOS = [];
for (const L of ['data-panel', 'scene-panel'])
  for (const R of ['pp-toggles', 'cctv-panel', 'global-context-panel'])
    for (const D of ['location-bar', 'control-panel']) COMBOS.push([L, R, D]);

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300)); });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2500);

const measure = () => page.evaluate((CARDS, EXTRA) => {
  const ids = CARDS.concat(EXTRA);
  const rects = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    if (!e) continue;
    const b = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    rects[id] = {
      x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
      vis: s.visibility, disp: s.display, op: String(Math.round(Number(s.opacity) * 100) / 100),
      collapsed: e.classList.contains('collapsed'), cls: e.className,
    };
  }
  const vis = Object.keys(rects).filter((k) => rects[k].vis !== 'hidden' && Number(rects[k].op) > 0.05 && rects[k].w > 4 && rects[k].h > 4);
  const overlaps = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const A = rects[vis[i]], B = rects[vis[j]];
    const w = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const h = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    if (w > 0 && h > 0) overlaps.push({ a: vis[i], b: vis[j], area: Math.round(w * h), wx: Math.round(w), hy: Math.round(h) });
  }
  return { rects, visible: vis, overlaps, api: !!(window.__gevLc && window.__gevLc.open) };
}, CARDS, EXTRA);

// 展开态细节：按钮命中/被别的卡盖住/横向越界/可滚动
const detail = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const b = el.getBoundingClientRect();
  const others = [];
  document.querySelectorAll('.gev-lc').forEach((c) => { if (c !== el) others.push(c); });
  const btns = [...el.querySelectorAll('button,input,select,[role=slider]')].filter((n) => {
    const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2;
  });
  let covered = 0, cut = 0, hitOk = 0;
  const bad = [];
  for (const n of btns) {
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const inside = cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
    if (!inside) { cut++; continue; }
    const top = document.elementFromPoint(cx, cy);
    const inSelf = top && (el.contains(top));
    if (inSelf) hitOk++;
    else { covered++; if (bad.length < 5) bad.push({ t: (n.textContent || '').trim().slice(0, 12), top: top ? (top.id || top.className || top.tagName) : 'null' }); }
  }
  // 横向越界（内容宽于卡片）
  let overX = 0, worstX = 0;
  el.querySelectorAll('*').forEach((c) => {
    const r = c.getBoundingClientRect();
    if (r.width < 2) return;
    const o = r.right - b.right;
    if (o > 1) { overX++; if (o > worstX) worstX = o; }
  });
  // 同一行按钮互相压字检测：卡片内两两 button/input 矩形相交（不含包含关系）
  const nodes = [...el.querySelectorAll('button,input,select,[role=slider]')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
  let btnX = 0; const btnPair = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const A = nodes[i].getBoundingClientRect(), B = nodes[j].getBoundingClientRect();
    if (A.left <= B.left && A.right >= B.right && A.top <= B.top && A.bottom >= B.bottom) continue;
    if (B.left <= A.left && B.right >= A.right && B.top <= A.top && B.bottom >= A.bottom) continue;
    const w = Math.min(A.right, B.right) - Math.max(A.left, B.left);
    const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (w > 2 && h > 2) { btnX++; if (btnPair.length < 4) btnPair.push([(nodes[i].textContent || '').trim().slice(0, 8), (nodes[j].textContent || '').trim().slice(0, 8), Math.round(w * h)]); }
  }
  // 滚到底：最后一个元素是否可见可点
  let bottomOk = null;
  if (el.scrollHeight > el.clientHeight + 2) {
    const prev = el.scrollTop; el.scrollTop = el.scrollHeight; 
    const last = [...el.querySelectorAll('button,input')].filter((n) => n.getBoundingClientRect().width > 2).pop();
    if (last) { const r = last.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; bottomOk = cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; }
    el.scrollTop = prev;
  }
  return {
    id, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
    buttons: btns.length, hitOk, covered, cut, bad,
    scrollable: el.scrollHeight > el.clientHeight + 2, scrollH: el.scrollHeight, clientH: el.clientHeight,
    overX, worstX: Math.round(worstX), btnX, btnPair, bottomOk,
    narrowCls: el.classList.contains('gev-lc-narrow'), cls: el.className,
  };
}, id);

const closeAll = async () => {
  await page.evaluate(() => { (window.__gevLc ? window.__gevLc._ids() : []).forEach((id) => window.__gevLc.close(id)); });
  await sleep(700);
};

const report = { viewport: [VW, VH], at: new Date().toISOString(), single: [], combos: [] };

// ── 基线 ────────────────────────────────────────────────────────────────────
await closeAll();
const base = await measure();
report.baseline = base;

// ── 7 × 单独展开 ────────────────────────────────────────────────────────────
for (const id of CARDS) {
  await closeAll();
  await page.evaluate((id) => window.__gevLc.open(id), id);
  await sleep(1000);
  const m = await measure();
  const d = await detail(id);
  report.single.push({ id, self: d, visible: m.visible, overlaps: m.overlaps, rects: m.rects });
  await closeAll();
}

// ── 12 combos（正序：左→右→dock）+ 倒序复验（dock→右→左，只测 control 那 6 个）────
const shotFor = new Set(['data-panel|pp-toggles|control-panel', 'data-panel|cctv-panel|control-panel', 'data-panel|global-context-panel|control-panel']);
const PLAN = COMBOS.map((c) => ({ combo: c, order: 'fwd' }))
  .concat(COMBOS.filter((c) => c[2] === 'control-panel').map((c) => ({ combo: [c[2], c[1], c[0]], order: 'rev' })));
for (const item of PLAN) {
  const combo = item.combo;
  await closeAll();
  const pre = await measure();
  if (pre.overlaps.length) report.combos.push({ combo, WARN: 'baseline dirty before open', overlaps: pre.overlaps });
  // 同一 tick 连开（最苛刻）
  await page.evaluate((ids) => ids.forEach((id) => window.__gevLc.open(id)), combo);
  await sleep(1100);
  const m = await measure();
  const det = {};
  for (const id of combo) det[id] = await detail(id);
  const key = combo.slice().sort((a, b) => 0).join('|');
  let shot = null;
  const shotKey = [combo[0], combo[1], combo[2]].filter((x) => x === 'data-panel' || x === 'pp-toggles' || x === 'cctv-panel' || x === 'global-context-panel' || x === 'control-panel').join('|');
  if (item.order === 'fwd' && shotFor.has(shotKey)) {
    shot = path.join(OUT, `combo-${combo[1]}+control.png`);
    await page.screenshot({ path: shot });
  }
  report.combos.push({ combo, order: item.order, visible: m.visible, overlaps: m.overlaps, rects: m.rects, detail: det, shot });
  await closeAll();
}

// ── 收全部 → 与基线比对 ─────────────────────────────────────────────────────
await closeAll();
await sleep(500);
const after = await measure();
report.after = after;
const diff = [];
for (const id of CARDS.concat(EXTRA)) {
  const a = base.rects[id], b = after.rects[id];
  if (!a || !b) { diff.push({ id, missing: true }); continue; }
  if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.collapsed !== b.collapsed) diff.push({ id, baseline: a, after: b });
}
report.restore = { identical: diff.length === 0, diff };

const totOv = report.combos.reduce((s, c) => s + (c.overlaps ? c.overlaps.length : 0), 0);
const singleOv = report.single.reduce((s, c) => s + (c.overlaps ? c.overlaps.length : 0), 0);
report.summary = {
  single_overlap_state_count: singleOv,
  combo_overlap_state_count: totOv,
  combos: report.combos.length,
  singles: report.single.length,
  restore_identical: report.restore.identical,
  console_errors: errs.length,
};
fs.writeFileSync(path.join(OUT, 'expand-audit-after.json'), JSON.stringify(report, null, 1));

// ── 控制台表格 ──────────────────────────────────────────────────────────────
console.log('VIEWPORT', VW + 'x' + VH);
console.log('=== SINGLE (7) ===');
for (const s of report.single) {
  console.log(`${s.id.padEnd(22)} rect=${s.self.x},${s.self.y} ${s.self.w}x${s.self.h} overlaps=${s.overlaps.length} buttons=${s.self.buttons} hit=${s.self.hitOk} covered=${s.self.covered} cut=${s.self.cut} scroll=${s.self.scrollable} overX=${s.self.overX}/${s.self.worstX}px`);
  if (s.overlaps.length) console.log('   OV', JSON.stringify(s.overlaps));
  console.log(`   btnX=${s.self.btnX} narrow=${s.self.narrowCls} bottomOk=${s.self.bottomOk} cls=${s.self.cls}`);
}
console.log('=== COMBOS (' + report.combos.length + ') ===');
for (const c of report.combos) {
  const g = c.combo.map((id) => { const r = c.rects[id]; return `${id}[${r.x},${r.y},${r.w}x${r.h}${r.vis === 'hidden' ? ' HIDDEN' : ''}]`; }).join(' ');
  console.log(`${(c.order || '')} ${c.combo.join('+').padEnd(50)} overlaps=${c.overlaps.length} ${JSON.stringify(c.overlaps)}`);
  console.log('   ', g);
  for (const id of c.combo) { const d = c.detail[id]; if (d) console.log(`    ${id.padEnd(20)} hit=${d.hitOk}/${d.buttons} covered=${d.covered} cut=${d.cut} btnX=${d.btnX} narrow=${d.narrowCls} bottomOk=${d.bottomOk}`); }
}
console.log('=== RESTORE ===', report.restore.identical, JSON.stringify(report.restore.diff));
console.log('=== CONSOLE ERRORS ===', errs.length, errs.slice(0, 5));
console.log('WROTE', path.join(OUT, 'expand-audit-after.json'));
await browser.close();
