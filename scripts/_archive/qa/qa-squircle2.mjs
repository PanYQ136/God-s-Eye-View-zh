#!/usr/bin/env node
/**
 * qa-squircle2.mjs —— iOS 连续圆角（corner-shape: squircle）最终验收
 *
 * A/B：A(前) 注入 `*{corner-shape:round !important}` = 改动前几何（也是不支持该属性
 * 的浏览器的渲染结果；边缘环 SDF 会自动退回 n=2）；B(后) 页面真实 CSS。
 *
 * 阶段
 *  1 审计 9 卡 + dock 托盘 + 内层 computed（半径不变 / 角形 squircle）
 *  2 全屏 1536×730 A/B（dsf2 抓 → lanczos 缩到 1536×730）
 *  3 角部 4x A/B（从 dsf2 全图裁 44css → 2x nearest = 4x css），合对比图
 *  4 真实卡角几何实测：白卡/暗底、关环 → 扫轮廓 → 最小二乘拟合超椭圆 n
 *     （n≈2 普通圆弧；n≈4 连续转角）
 *  5 不回归：A/B 布局矩形全等；开合/滚动/按钮/角部命中区
 *  6 展开卡截图 + 4x 角
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'evidence/_collab/t_3e129970';
const DSF = 2, VW = 1536, VH = 730;
fs.mkdirSync(OUT, { recursive: true });
const report = { url: URL, started: new Date().toISOString(), phases: {}, errors: [] };
const save = () => fs.writeFileSync(`${OUT}/squircle-report2.json`, JSON.stringify(report, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const NOSQ = 'qa-nosquircle';

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(12000);
await page.keyboard.press('Escape');
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) { report.errors.push('camera: ' + (e.message || e)); }
});
await sleep(13000);

const injectNoSq = () => page.evaluate((id) => {
  let s = document.getElementById(id);
  if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
  s.textContent = '*, *::before, *::after { corner-shape: round !important; }';
}, NOSQ);
const removeNoSq = () => page.evaluate((id) => { const s = document.getElementById(id); if (s) s.remove(); }, NOSQ);

function auditFn(ids) {
  const rows = ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, present: false };
    const cs = getComputedStyle(el);
    const inner = el.querySelector('.panel-inner, .data-panel-inner, .scene-panel-inner, .cctv-panel-inner, .global-context-panel-inner, .location-inner, .pp-panel-body');
    const ics = inner ? getComputedStyle(inner) : null;
    const r = el.getBoundingClientRect();
    return {
      id, radius: cs.borderTopLeftRadius, cornerShape: (cs.cornerShape || cs.getPropertyValue('corner-shape') || '').trim(),
      innerRadius: ics ? ics.borderTopLeftRadius : null,
      innerShape: ics ? (ics.cornerShape || ics.getPropertyValue('corner-shape') || '').trim() : null,
      rect: [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100),
    };
  });
  const trays = Array.from(document.querySelectorAll('.dock-popover-content')).map((el) => {
    const c = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return { radius: c.borderTopLeftRadius, cornerShape: (c.cornerShape || c.getPropertyValue('corner-shape') || '').trim(), visible: c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0.05, rect: b.width > 0 ? [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10) : null, inCommandDock: !!el.closest('#command-dock') };
  });
  const tray = trays.find((t) => t.visible) || trays[0] || null;
  const fab = document.getElementById('gev-gfx-fab');
  return {
    rows,
    tray,
    trays,
    fab: fab ? { radius: getComputedStyle(fab).borderTopLeftRadius, cornerShape: (getComputedStyle(fab).cornerShape || '') } : null,
    lens: (() => { try { const s = window.__gevEdge.stats(); return { frames: s.frames, err: s.err, surf: s.surfaces.map((x) => [x.id, x.cornerN]) }; } catch (e) { return String(e && e.message); } })(),
    support: { squircle: CSS.supports('corner-shape', 'squircle'), ua: navigator.userAgent },
    cesium: (() => { const v = window.__gevViewer; return v ? { rs: +(v.resolutionScale || 0).toFixed(2), canvas: [v.canvas.width, v.canvas.height], error: v.scene.renderError ? String(v.scene.renderError.message || '(object)') : null } : null; })(),
  };
}

/* 1) 审计 */
report.phases.auditAfter = await page.evaluate(auditFn, IDS);
save();

/* 2) 全屏 A/B */
async function fullShot(tag) {
  const buf = await page.screenshot({ type: 'png' });
  fs.writeFileSync(`${OUT}/${tag}-2x.png`, buf);
  await sharp(buf).resize({ width: VW, height: VH, kernel: 'lanczos3' }).png().toFile(`${OUT}/${tag}-1536x730.png`);
  return buf;
}
await fullShot('after');
await injectNoSq();
await sleep(1200);
report.phases.lensRound = await page.evaluate(() => { try { return window.__gevEdge.stats().surfaces.map((s) => [s.id, s.cornerN]); } catch (e) { return String(e); } });
await fullShot('before');
report.phases.auditBefore = await page.evaluate(auditFn, IDS);
save();

/* 3) 角部 4x A/B（从 dsf2 全图裁） */
const CORNERS = [
  { name: 'data-panel-tl', id: 'data-panel', c: 'tl' },
  { name: 'cctv-panel-tr', id: 'cctv-panel', c: 'tr' },
  { name: 'global-context-panel-bl', id: 'global-context-panel', c: 'bl' },
  { name: 'control-panel-tl', id: 'control-panel', c: 'tl' },
];
const rectsNow = async () => page.evaluate((ids) => {
  const o = {};
  ids.forEach((id) => { const el = document.getElementById(id); if (el) { const r = el.getBoundingClientRect(); o[id] = [r.left, r.top, r.width, r.height]; } });
  return o;
}, IDS);
async function crop4x(png, rect, corner, tag) {
  const [x, y, w, h] = rect;
  const S = 44, pad = 4;
  let left, top;
  if (corner === 'tl') { left = x - pad; top = y - pad; }
  else if (corner === 'tr') { left = x + w - S + pad; top = y - pad; }
  else if (corner === 'bl') { left = x - pad; top = y + h - S + pad; }
  else { left = x + w - S + pad; top = y + h - S + pad; }
  const left2 = Math.max(0, Math.round(left * DSF)), top2 = Math.max(0, Math.round(top * DSF));
  const file = `${OUT}/${tag}-corner-${corner}-${S}.png`;
  await sharp(png).extract({ left: left2, top: top2, width: S * DSF, height: S * DSF })
    .resize({ width: S * DSF * 2, height: S * DSF * 2, kernel: 'nearest' }).png().toFile(file);
  return file;
}
const rectA = await rectsNow();
const cornerAfter = {}, cornerBefore = {};
for (const c of CORNERS) cornerAfter[c.name] = await crop4x(`${OUT}/after-2x.png`, rectA[c.id], c.c, 'after');
await injectNoSq();
await sleep(1100);
const rectB = await rectsNow();
for (const c of CORNERS) cornerBefore[c.name] = await crop4x(`${OUT}/before-2x.png`, rectB[c.id], c.c, 'before');
await removeNoSq();
await sleep(900);
report.phases.corners = { after: cornerAfter, before: cornerBefore, rectsA: rectA, rectsB: rectB };
save();

/* 4) 真实卡角几何实测 */
const MEASURE_CSS = `#cesiumContainer, .cesium-widget, .cesium-widget canvas, #gev-edge-lens { visibility: hidden !important; }
  html, body { background: #000 !important; }
  .gev-lc { background: #fff !important; box-shadow: none !important; }
  .gev-lc * { color: transparent !important; text-shadow: none !important; }
  .gev-lc .gev-lg-warp { display: none !important; }`;
const injectMeasure = () => page.evaluate((css) => {
  let s = document.getElementById('qa-measure');
  if (!s) { s = document.createElement('style'); s.id = 'qa-measure'; document.head.appendChild(s); }
  s.textContent = css;
  try { window.__gevEdge.off(); } catch (e) {}
}, MEASURE_CSS);
const removeMeasure = () => page.evaluate(() => {
  const s = document.getElementById('qa-measure'); if (s) s.remove();
  try { window.__gevEdge.on(); } catch (e) {}
});
const R_CARD = 16;
async function measureState(tag) {
  const rects = await rectsNow();
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(`${OUT}/measure-${tag}-2x.png`, png);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const lum = (x, y) => { const i = (y * width + x) * channels; return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; };
  const out = [];
  for (const id of ['data-panel', 'cctv-panel', 'global-context-panel']) {
    const r = rects[id];
    if (!r) { out.push({ id, err: 'no rect' }); continue; }
    const x0 = Math.round(r[0] * DSF), y0 = Math.round(r[1] * DSF);
    const rows = [];
    for (let v = 0; v <= R_CARD * DSF; v++) {
      let first = null;
      for (let u = 0; u <= R_CARD * DSF + DSF; u++) {
        const px = x0 - DSF * 3 + u;
        if (px < 0 || px >= width) continue;
        if (lum(px, y0 + v) > 128) { first = (px - x0) / DSF; break; }   // 相对卡左边缘的内缩（CSS px）
      }
      rows.push(first);
    }
    out.push({ id, rows });
  }
  return out;
}
const pred = (n, v) => (v <= 0 || v >= R_CARD ? 0 : R_CARD - R_CARD * Math.pow(Math.max(0, 1 - Math.pow((R_CARD - v) / R_CARD, n)), 1 / n));
function fitN(rows) {
  const pts = rows.map((u, v) => [v / DSF, u]).filter(([, u]) => u !== null && u >= -0.6);
  const rmse = (n) => {
    let s = 0, c = 0;
    for (const [v, u] of pts) { if (v < 0.5 || v > R_CARD - 1) continue; const d = u - pred(n, v); s += d * d; c++; }
    return c ? Math.sqrt(s / c) : NaN;
  };
  let best = { n: 0, e: 1e9 };
  for (let n = 1.6; n <= 9.001; n += 0.02) { const e = rmse(n); if (e < best.e) best = { n: +n.toFixed(2), e: +e.toFixed(3) }; }
  return { ...best, eCircle: +rmse(2).toFixed(3), eSq4: +rmse(4).toFixed(3), points: pts.length };
}
await injectMeasure();
await sleep(1100);
const mSq = await measureState('squircle');
await injectNoSq();
await sleep(900);
const mRd = await measureState('round');
await removeNoSq();
await removeMeasure();
await sleep(900);
report.phases.geometry = {
  r: R_CARD,
  squircle: mSq.map((m) => ({ id: m.id, fit: m.rows ? fitN(m.rows) : null })),
  round: mRd.map((m) => ({ id: m.id, fit: m.rows ? fitN(m.rows) : null })),
};
save();

/* 5) 不回归 */
const rectsOf = () => page.evaluate((ids) => {
  const o = {};
  ids.forEach((id) => { const el = document.getElementById(id); if (el) { const r = el.getBoundingClientRect(); o[id] = [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100); } });
  const t = document.querySelector('#command-dock .dock-popover-content');
  if (t) { const r = t.getBoundingClientRect(); o.__tray = [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100); }
  return o;
}, IDS);
const rAfter = await rectsOf();
const hitTest = () => page.evaluate((ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    // 45° 上 d=3.6px：squircle(r=16) 内部，同半径圆弧外部
    const hit = document.elementFromPoint(r.left + 3.6, r.top + 3.6);
    out[id] = { inCard: !!(hit && el.contains(hit)), hit: hit ? (hit.id || (typeof hit.className === 'string' ? hit.className : hit.tagName)) : null };
  }
  return out;
}, IDS);
const hitAfter = await hitTest();
await injectNoSq();
await sleep(1000);
const rBefore = await rectsOf();
const hitBefore = await hitTest();
await removeNoSq();
await sleep(900);
report.phases.layout = { rectsAfter: rAfter, rectsBefore: rBefore, identical: JSON.stringify(rAfter) === JSON.stringify(rBefore) };
report.phases.hitCorner = { after: hitAfter, before: hitBefore };
save();

report.phases.interactions = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { cards: [] };
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel']) {
    const el = document.getElementById(id);
    if (!el) { out.cards.push({ id, err: 'missing' }); continue; }
    const b0 = el.getBoundingClientRect();
    window.__gevLc.open(id);
    await wait(1200);
    const or = el.getBoundingClientRect();
    const info = window.__gevLc.info(id);
    let overflowX = 0;
    el.querySelectorAll('*').forEach((n) => { const b = n.getBoundingClientRect(); if (b.width > 0 && b.height > 0 && (b.left < or.left - 1 || b.right > or.right + 1)) overflowX++; });
    const st0 = el.scrollTop;
    const canScroll = el.scrollHeight > el.clientHeight + 2;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }));
    await wait(450);
    const st1 = el.scrollTop;
    window.__gevLc.close(id);
    await wait(1100);
    const cr = el.getBoundingClientRect();
    out.cards.push({
      id, h: { collapsed: +b0.height.toFixed(1), open: +or.height.toFixed(1), restored: +cr.height.toFixed(1) },
      floating: info.floating === true,
      restored: Math.abs(cr.height - b0.height) < 1.5 && Math.abs(cr.top - b0.top) < 1.5,
      overflowX, canScroll, scrollMoved: st1 !== st0,
    });
  }
  window.__gevLc.open('pp-toggles');
  await wait(1300);
  const cands = Array.from(document.querySelectorAll('#pp-toggles button, #pp-toggles .pp-toggle-btn, #pp-toggles input[type=checkbox]'))
    .filter((n) => { const b = n.getBoundingClientRect(); return b.width > 16 && b.height > 10 && b.top > 0 && b.bottom < innerHeight; });
  const btn = { found: cands.length };
  if (cands.length) {
    const t = cands[0];
    const b = t.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    btn.centerHit = !!(hit && (t === hit || t.contains(hit) || hit.contains(t)));
    btn.rect = [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10);
    btn.label = (t.textContent || t.getAttribute('aria-label') || t.id || '').trim().slice(0, 24);
    const sig0 = t.className + '|' + (t.getAttribute('aria-pressed') || '') + '|' + (t.checked === undefined ? '' : t.checked);
    try { t.click(); } catch (e) { btn.err = String(e && e.message); }
    await wait(500);
    btn.changed = sig0 !== (t.className + '|' + (t.getAttribute('aria-pressed') || '') + '|' + (t.checked === undefined ? '' : t.checked));
  }
  // dock 托盘角：展开 location-bar 后量托盘
  window.__gevLc.close('pp-toggles');
  await wait(700);
  window.__gevLc.open('location-bar');
  await wait(1200);
  const tray = document.querySelector('#location-bar .dock-popover-content') || document.querySelector('#command-dock .dock-popover-content');
  if (tray) {
    const cs = getComputedStyle(tray);
    const b = tray.getBoundingClientRect();
    btn.tray = { radius: cs.borderTopLeftRadius, shape: (cs.cornerShape || '').trim(), rect: [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10), visible: cs.visibility !== 'hidden' && +cs.opacity > 0.15 };
  }
  await wait(300);
  window.__squircleTray = btn.tray || null;
  window.__gevLc.close('location-bar');
  await wait(900);
  return { ...out, button: btn };
});
save();

/* 6) 展开卡截图 */
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(1500);
const expRect = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
const expPng = await page.screenshot({ type: 'png' });
fs.writeFileSync(`${OUT}/after-expanded-2x.png`, expPng);
await sharp(expPng).resize({ width: VW, height: VH, kernel: 'lanczos3' }).png().toFile(`${OUT}/after-expanded-1536x730.png`);
const expCorner = await crop4x(expPng, expRect, 'tl', 'expanded');
const expInfo = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const inner = el.querySelector('.data-panel-inner');
  const r = el.getBoundingClientRect();
  // 横向越界（圆角/裁切最容易伤到的地方）+ 纵向只能靠滚动，所以单独验「滚到底能看到最后一个子元素」
  let overX = 0, worstX = 0;
  el.querySelectorAll('*').forEach((n) => {
    const b = n.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) {
      const d = Math.max(0, r.left - b.left, b.right - r.right);
      if (d > 2) { overX++; worstX = Math.max(worstX, +d.toFixed(1)); }
    }
  });
  const before = el.scrollTop;
  el.scrollTop = el.scrollHeight;
  const last = el.lastElementChild;
  const lastRect = last ? last.getBoundingClientRect() : null;
  const bottomVisible = lastRect ? lastRect.bottom <= r.bottom + 1.5 : null;
  el.scrollTop = before;
  return {
    radius: cs.borderTopLeftRadius, shape: cs.cornerShape,
    innerRadius: inner ? getComputedStyle(inner).borderTopLeftRadius : null, innerShape: inner ? inner.cornerShape : null,
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    overX, worstOverflowXpx: worstX,
    scrollable: el.scrollHeight > el.clientHeight + 2,
    scrolledToEnd: el.scrollTop !== before || el.scrollHeight <= el.clientHeight + 2,
    bottomReachable: bottomVisible,
  };
});
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(1000);
report.phases.expanded = { rect: expRect, corner: expCorner, computed: expInfo };
report.finished = new Date().toISOString();
save();
console.log(JSON.stringify({
  audit: report.phases.auditAfter.rows.map((r) => [r.id, r.radius, r.cornerShape, r.innerRadius, r.innerShape]),
  tray: report.phases.auditAfter.tray, fab: report.phases.auditAfter.fab, lens: report.phases.auditAfter.lens,
  cesium: report.phases.auditAfter.cesium,
  lensRound: report.phases.lensRound,
  geometry: report.phases.geometry,
  identical: report.phases.layout.identical,
  hit: report.phases.hitCorner,
  interactions: report.phases.interactions,
  expanded: report.phases.expanded,
  errors: report.errors.slice(0, 6),
}, null, 1));
await browser.close();
