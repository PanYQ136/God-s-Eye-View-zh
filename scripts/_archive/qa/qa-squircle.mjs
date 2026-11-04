#!/usr/bin/env node
/**
 * qa-squircle.mjs —— iOS 连续圆角（corner-shape: squircle）验收
 *
 *  一个浏览器会话里做 A/B 对照：
 *    A(前) = 注入 `corner-shape: round !important`（= 改动前的几何，也是不支持
 *            corner-shape 的浏览器的实际渲染；边缘环 SDF 会自动退回 n=2）
 *    B(后) = 本页真实 CSS（corner-shape: squircle）
 *
 *  阶段：
 *   1) 审计：9 卡 + dock 托盘 + 内层的 computed border-radius / corner-shape
 *   2) 截图：1536×730 全屏 A/B、展开卡 A/B、testBg 边缘条纹下的角部 4x A/B
 *   3) 实测角部几何：白底 + 黑卡 + 关边缘环，扫真实卡角轮廓 → 最小二乘拟合超椭圆 n
 *      （n≈2 = 普通圆弧，n≈4 = squircle 连续转角）
 *   4) 不回归：A/B 前后 9 卡 + 托盘的 getBoundingClientRect 完全一致；
 *      开合 / 滚动 / 按钮 / 角部命中区（elementFromPoint）逐项检查
 *
 * 输出：evidence/_collab/t_3e129970/*.png + squircle-report.json
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'evidence/_collab/t_3e129970';
const DSF = 2;
fs.mkdirSync(OUT, { recursive: true });
const report = { url: URL, started: new Date().toISOString(), phases: {}, errors: [] };
const saveReport = () => fs.writeFileSync(`${OUT}/squircle-report.json`, JSON.stringify(report, null, 1));

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const NOSQ = 'qa-nosquircle';   // 注入后 = 改动前的圆角几何

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--window-size=1536,730', '--force-color-profile=srgb', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: DSF });
page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) { report.errors.push('camera: ' + e.message); }
});
await new Promise((r) => setTimeout(r, 14000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const injectNoSq = () => page.evaluate((id) => {
  let s = document.getElementById(id);
  if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
  s.textContent = '*, *::before, *::after { corner-shape: round !important; }';
}, NOSQ);
const removeNoSq = () => page.evaluate((id) => { const s = document.getElementById(id); if (s) s.remove(); }, NOSQ);

/* ── 1) 审计 ─────────────────────────────────────────────────────────────── */
function auditFn(ids) {
  const rows = ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, present: false };
    const cs = getComputedStyle(el);
    const inner = el.querySelector('.panel-inner, .data-panel-inner, .scene-panel-inner, .cctv-panel-inner, .global-context-panel-inner, .location-inner, .pp-panel-body');
    const ics = inner ? getComputedStyle(inner) : null;
    const r = el.getBoundingClientRect();
    return {
      id, present: true,
      radius: cs.borderTopLeftRadius, cornerShape: (cs.cornerShape || cs.getPropertyValue('corner-shape') || '').trim(),
      innerRadius: ics ? ics.borderTopLeftRadius : null,
      innerShape: ics ? (ics.cornerShape || ics.getPropertyValue('corner-shape') || '').trim() : null,
      rect: [Math.round(r.left * 100) / 100, Math.round(r.top * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100],
    };
  });
  const tray = document.querySelector('#command-dock .dock-popover-content');
  const tcs = tray ? getComputedStyle(tray) : null;
  const tr = tray ? tray.getBoundingClientRect() : null;
  return {
    rows,
    tray: tray ? { radius: tcs.borderTopLeftRadius, cornerShape: (tcs.cornerShape || tcs.getPropertyValue('corner-shape') || '').trim(), rect: [tr.left, tr.top, tr.width, tr.height], visible: tcs.visibility !== 'hidden' && +tcs.opacity > 0.1 } : null,
    fab: (() => { const f = document.getElementById('gev-gfx-fab'); if (!f) return null; const c = getComputedStyle(f); return { radius: c.borderTopLeftRadius, cornerShape: (c.cornerShape || c.getPropertyValue('corner-shape') || '').trim() }; })(),
    lens: (() => { try { const s = window.__gevEdge.stats(); return { frames: s.frames, cornerN: (s.surfaces || []).map((x) => [x.id, x.cornerN]) }; } catch (e) { return { err: String(e && e.message) }; } })(),
    supports: { squircle: CSS.supports('corner-shape', 'squircle'), ua: navigator.userAgent },
  };
}
report.phases.auditAfter = await page.evaluate(auditFn, IDS);
saveReport();

/* ── 2) 全屏 A/B（1536×730 视口，dsf2 截图后缩放成 1536×730） ─────────────── */
async function fullShot(tag) {
  const buf = await page.screenshot({ path: `${OUT}/${tag}-2x.png` });
  await sharp(buf).resize({ width: 1536, height: 730, kernel: 'lanczos3' }).png().toFile(`${OUT}/${tag}-1536x730.png`);
}
await fullShot('after');

await injectNoSq();
await sleep(1200);
report.phases.lensRoundMode = await page.evaluate(() => { try { return window.__gevEdge.stats().surfaces.map((s) => [s.id, s.cornerN]); } catch (e) { return String(e); } });
await fullShot('before');
report.phases.auditBefore = await page.evaluate(auditFn, IDS);
saveReport();

/* ── 3) 角部 4x A/B：testBg（边缘环用合成条纹底，几何可见）+ 真实卡角 ────── */
const CORNERS = [
  { name: 'data-panel-tl', id: 'data-panel', corner: 'tl' },
  { name: 'cctv-panel-tr', id: 'cctv-panel', corner: 'tr' },
  { name: 'pp-toggles-tr', id: 'pp-toggles', corner: 'tr' },
  { name: 'location-bar-bl', id: 'location-bar', corner: 'bl' },
];
async function cornerShots(tag) {
  const out = [];
  for (const c of CORNERS) {
    const r = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return null; const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }, c.id);
    if (!r) { out.push({ name: c.name, rect: null }); continue; }
    const [x, y, w, h] = r;
    const S = 44;  // 抓 44 CSS px 见方的角
    let clip;
    if (c.corner === 'tl') clip = { x: x - 4, y: y - 4, width: S, height: S };
    else if (c.corner === 'tr') clip = { x: x + w - S + 4, y: y - 4, width: S, height: S };
    else if (c.corner === 'bl') clip = { x: x - 4, y: y + h - S + 4, width: S, height: S };
    else clip = { x: x + w - S + 4, y: y + h - S + 4, width: S, height: S };
    clip.x = Math.max(0, Math.round(clip.x)); clip.y = Math.max(0, Math.round(clip.y));
    const p = `${OUT}/${tag}-corner-${c.name}.png`;
    await page.screenshot({ path: p, clip });
    out.push({ name: c.name, rect: r, clip, file: p });
  }
  return out;
}
await page.evaluate(() => { try { window.__gevEdge.testBg(true); } catch (e) {} });
await sleep(900);
const cornersAfter = await cornerShots('after');
await injectNoSq();
await sleep(900);
const cornersBefore = await cornerShots('before');
await removeNoSq();
await page.evaluate(() => { try { window.__gevEdge.testBg(false); } catch (e) {} });
await sleep(600);
report.phases.corners = { after: cornersAfter, before: cornersBefore };
saveReport();

/* ── 4) 真实卡角几何实测（白底 + 黑卡 + 关边缘环 → 硬边可亚像素测量）───────── */
const measure = async (tag) => {
  const res = [];
  const targets = [
    { name: 'data-panel', id: 'data-panel' },
    { name: 'cctv-panel', id: 'cctv-panel' },
    { name: 'global-context-panel', id: 'global-context-panel' },
  ];
  for (const t of targets) {
    const rect = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return null; const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }, t.id);
    if (!rect) { res.push({ name: t.name, err: 'missing' }); continue; }
    const [x, y] = rect;
    const clip = { x: Math.round(x) - 6, y: Math.round(y) - 6, width: 56, height: 56 };
    const file = `${OUT}/measure-${tag}-${t.name}.png`;
    await page.screenshot({ path: file, clip });
    res.push({ name: t.name, rect, clip, file });
  }
  return res;
};
// 白底 + 黑卡 + 关环
await page.evaluate(() => {
  const s = document.createElement('style');
  s.id = 'qa-measure-bg';
  s.textContent = `#cesiumContainer, canvas#cesium, .cesium-widget, .cesium-widget canvas, #gev-edge-lens { visibility: hidden !important; }
    html, body { background: #fff !important; }
    .gev-lc { background: #000 !important; box-shadow: none !important; }
    .gev-lc * { color: transparent !important; text-shadow: none !important; }
    .gev-lc .gev-lg-warp { display: none !important; }`;
  document.head.appendChild(s);
  try { window.__gevEdge.off(); } catch (e) {}
});
await sleep(900);
const mSq = await measure('squircle');
await injectNoSq();
await sleep(800);
const mRd = await measure('round');
await removeNoSq();
await page.evaluate(() => { const s = document.getElementById('qa-measure-bg'); if (s) s.remove(); try { window.__gevEdge.on(); } catch (e) {} });
await sleep(700);

/* 轮廓扫描 + 超椭圆拟合（n=2 圆 / n=4 squircle） */
const R_CARD = 16;
function scanProfile(file, clip) {
  return sharp(file).raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
    const { width, height, channels } = info;
    const lum = (x, y) => { const i = (y * width + x) * channels; return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; };
    // clip 左/上各多给 6 CSS px → 卡体边界在 (6*DSF) 处
    const pad = 6 * DSF, off = pad, rows = [];
    for (let v = 0; v <= R_CARD * DSF; v++) {
      let first = null;
      for (let u = 0; u < pad + R_CARD * DSF; u++) { if (lum(u, pad + v) < 128) { first = u; break; } }
      rows.push(first === null ? null : (first - off) / DSF);   // 相对卡左边缘的内缩 px
    }
    return { rows, width, height };
  });
}
const pred = (n, v) => (v <= 0 || v >= R_CARD ? 0 : R_CARD - R_CARD * Math.pow(Math.max(0, 1 - Math.pow((R_CARD - v) / R_CARD, n)), 1 / n));
function fitN(rows) {
  const rmse = (n) => {
    let s = 0, c = 0;
    for (let v = 1; v < rows.length - 2; v++) {
      if (rows[v] === null || rows[v] < 0) continue;
      const d = rows[v] - pred(n, v / DSF); s += d * d; c++;
    }
    return c ? Math.sqrt(s / c) : NaN;
  };
  let best = { n: 0, e: 1e9 };
  for (let n = 1.6; n <= 10.001; n += 0.02) { const e = rmse(n); if (e < best.e) best = { n: +n.toFixed(2), e: +e.toFixed(3) }; }
  return { ...best, eCircle: +rmse(2).toFixed(3), eSq4: +rmse(4).toFixed(3) };
}
const geo = { squircle: [], round: [] };
for (const m of mSq) { if (m.file) geo.squircle.push({ name: m.name, fit: fitN((await scanProfile(m.file, m.clip)).rows) }); }
for (const m of mRd) { if (m.file) geo.round.push({ name: m.name, fit: fitN((await scanProfile(m.file, m.clip)).rows) }); }
report.phases.geometry = { r: R_CARD, ...geo, files: { squircle: mSq.map((m) => m.file), round: mRd.map((m) => m.file) } };
saveReport();
console.log('geometry', JSON.stringify(report.phases.geometry, null, 1));

/* ── 5) 不回归：布局矩形 A/B 一致 + 开合/滚动/按钮/角部命中 ───────────────── */
const rectsOf = () => page.evaluate((ids) => {
  const o = {};
  ids.forEach((id) => { const el = document.getElementById(id); if (el) { const r = el.getBoundingClientRect(); o[id] = [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100); } });
  const t = document.querySelector('#command-dock .dock-popover-content');
  if (t) { const r = t.getBoundingClientRect(); o['__tray'] = [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100); }
  return o;
}, IDS);
const rectsAfter = await rectsOf();
await injectNoSq();
await sleep(1000);
const rectsBefore = await rectsOf();
// 角部命中：squircle 角在 45° 上比同半径圆「更满」，取 d=3.6px 只落在 squircle 内
const hitTest = () => page.evaluate((ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const pt = [r.left + 3.6, r.top + 3.6];
    const hitEl = document.elementFromPoint(pt[0], pt[1]);
    out[id] = { pt: pt.map((n) => Math.round(n * 10) / 10), inCard: !!(hitEl && el.contains(hitEl)), hit: hitEl ? (hitEl.id || hitEl.className || hitEl.tagName) : null };
  }
  return out;
}, IDS);
const hitAfter = await hitTest();
await removeNoSq();
await sleep(1000);
const hitBefore = await hitTest();
report.phases.layout = { rectsAfter, rectsBefore, identical: JSON.stringify(rectsAfter) === JSON.stringify(rectsBefore) };
report.phases.hitCorner = { after: hitAfter, before: hitBefore };
saveReport();

/* 开合 / 滚动 / 按钮 */
report.phases.interactions = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { cards: [] };
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out.cards.push({ id, err: 'missing' }); continue; }
    const before = window.__gevLc.info(id);
    const beforeRect = el.getBoundingClientRect();
    window.__gevLc.open(id);
    await wait(1100);
    const opened = window.__gevLc.info(id);
    const or = el.getBoundingClientRect();
    // 展开后：内容不被圆角裁掉（子元素横向越界计数）+ 能否滚动
    let overflowX = 0, maxRight = 0;
    el.querySelectorAll('*').forEach((n) => {
      const b = n.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) {
        if (b.left < or.left - 1 || b.right > or.right + 1) overflowX++;
        if (b.right > maxRight) maxRight = b.right;
      }
    });
    const st0 = el.scrollTop;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 220, bubbles: true, cancelable: true }));
    if (typeof window.__gevLc.wheel === 'function') { try { window.__gevLc.wheel(id, 220); } catch (e) {} }
    await wait(500);
    const st1 = el.scrollTop;
    window.__gevLc.close(id);
    await wait(1000);
    const closed = window.__gevLc.info(id);
    const cr = el.getBoundingClientRect();
    out.cards.push({
      id,
      collapsedH: +beforeRect.height.toFixed(1), openH: +or.height.toFixed(1), backH: +cr.height.toFixed(1),
      floatingOn: opened.floating === true, restored: Math.abs(cr.height - beforeRect.height) < 1.5 && Math.abs(cr.top - beforeRect.top) < 1.5,
      overflowX, scroll: { st0, st1, moved: st1 !== st0 },
      info: { before: before.floating, opened: opened.floating, closed: closed.floating },
    });
  }
  // 按钮可点：pp-toggles 里第一个 toggle
  window.__gevLc.open('pp-toggles');
  await wait(1200);
  const tgl = document.querySelector('#pp-toggles .pp-toggle-btn, #pp-toggles button, #pp-toggles input');
  let btn = { found: !!tgl };
  if (tgl) {
    const b = tgl.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const hitEl = document.elementFromPoint(cx, cy);
    btn.centerHit = !!(hitEl && (tgl === hitEl || tgl.contains(hitEl) || hitEl.contains(tgl)));
    btn.rect = [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10);
    const cls0 = tgl.className, aria0 = tgl.getAttribute && tgl.getAttribute('aria-pressed');
    try { tgl.click(); } catch (e) { btn.clickErr = String(e && e.message); }
    await wait(400);
    btn.changed = tgl.className !== cls0 || (tgl.getAttribute && tgl.getAttribute('aria-pressed') !== aria0);
  }
  window.__gevLc.close('pp-toggles');
  await wait(900);
  out.button = btn;
  return out;
});
saveReport();

/* ── 6) 展开卡截图（squircle）+ 4x 角部 ───────────────────────────────────── */
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(1400);
const expRect = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
await page.screenshot({ path: `${OUT}/after-expanded-2x.png` });
await sharp(`${OUT}/after-expanded-2x.png`).resize({ width: 1536, height: 730, kernel: 'lanczos3' }).png().toFile(`${OUT}/after-expanded-1536x730.png`);
await page.screenshot({ path: `${OUT}/after-expanded-corner-tl.png`, clip: { x: Math.round(expRect[0]) - 4, y: Math.round(expRect[1]) - 4, width: 44, height: 44 } });
const expInfo = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const inner = el.querySelector('.data-panel-inner');
  return { radius: cs.borderTopLeftRadius, shape: cs.cornerShape, innerShape: inner ? inner.cornerShape : null, innerRadius: inner ? getComputedStyle(inner).borderTopLeftRadius : null, scrollH: el.scrollHeight, clientH: el.clientHeight };
});
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(900);
report.phases.expanded = { rect: expRect, computed: expInfo };
saveReport();

report.finished = new Date().toISOString();
saveReport();
console.log(JSON.stringify({
  audit: report.phases.auditAfter.rows.map((r) => [r.id, r.radius, r.cornerShape, r.innerShape]),
  tray: report.phases.auditAfter.tray, fab: report.phases.auditAfter.fab, lens: report.phases.auditAfter.lens,
  geometry: report.phases.geometry,
  layoutIdentical: report.phases.layout.identical,
  hit: report.phases.hitCorner,
  interactions: report.phases.interactions,
  expanded: report.phases.expanded,
  errors: report.errors.slice(0, 6),
}, null, 1));
await browser.close();
