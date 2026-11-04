#!/usr/bin/env node
/**
 * qa-lg-anim2.mjs —— P0-4/P1-1 验收（dsf=2 真 2x）：morph + 兄弟收起 + 按下 flex + 帧时直方图 + 录屏帧
 * 用法: node scripts/qa-lg-anim2.mjs [url] [tag]
 * 产出: evidence/lg-glass-shots/p0/<tag>/frames/*.jpg + expanded.png + report.json
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const tag = process.argv[3] || 'anim-final';
const outDir = `evidence/lg-glass-shots/p0/${tag}`;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(`${outDir}/frames`, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 10000));

/* 帧时采集器（rAF 侧，独立于玻璃内部统计） */
await page.evaluate(() => {
  window.__ft = [];
  let last = performance.now();
  const tick = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length > 4000) window.__ft.shift(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

/* ── 按下 flex/energize（P1-1 / §5.1 末条） ─────────────────────────── */
const press = await (async () => {
  const info0 = await page.evaluate(() => window.__gevLc.info('data-panel'));
  const cx = info0.x + Math.round(info0.w * 0.55), cy = info0.y + Math.round(info0.h / 2);
  const strip = { x: info0.x - 3, y: info0.y + 6, width: 10, height: Math.max(8, info0.h - 12) };
  const shot0 = await page.screenshot({ clip: strip });
  const rim0 = await page.evaluate(async (clip) => null, null);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 70));
  const info1 = await page.evaluate(() => window.__gevLc.info('data-panel'));
  const shot1 = await page.screenshot({ clip: strip });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 320));
  const info2 = await page.evaluate(() => window.__gevLc.info('data-panel'));
  fs.writeFileSync(`${outDir}/press-before.png`, shot0);
  fs.writeFileSync(`${outDir}/press-during.png`, shot1);
  return {
    before: [info0.x, info0.y, info0.w, info0.h], during: [info1.x, info1.y, info1.w, info1.h], after: [info2.x, info2.y, info2.w, info2.h],
    scaleDuring: info0.w ? +(info1.w / info0.w).toFixed(4) : null,
    scaleAfter: info0.w ? +(info2.w / info0.w).toFixed(4) : null,
  };
})();
const afterPress = await page.evaluate(() => ({ info: window.__gevLc.info('data-panel'), float: window.__gevLc.info('data-panel').floating }));
if (afterPress.float) { await page.evaluate(() => window.__gevLc.close('data-panel')); await new Promise((r) => setTimeout(r, 900)); }

/* ── 逐帧采样：单次展开（几何 + 透镜调制 + 帧时） ──────────────────── */
const t0 = await page.evaluate(() => performance.now());
const single = await page.evaluate(async () => {
  const samples = [];
  const t0 = performance.now();
  window.__gevLc.open('data-panel');
  const id = setInterval(() => {
    const a = window.__gevLc.info('data-panel');
    const b = window.__gevLc.info('scene-panel');
    const g = window.__gevGlassAnim;
    const st = window.__gevGlStats();
    samples.push({
      t: Math.round(performance.now() - t0), x: a.x, y: a.y, w: a.w, h: a.h,
      sibCollapsed: b.collapsed, sibW: b.w, sibH: b.h,
      lens: g ? +(((performance.now() - g.t0) / g.dur)).toFixed(2) : -1,
      scale: st.scale, glassFrames: st.frames, surf: st.count,
    });
  }, 16);
  await new Promise((r) => setTimeout(r, 900));
  clearInterval(id);
  return samples;
});
await page.screenshot({ path: `${outDir}/expanded.png` });
const sibDisplay = await page.evaluate(() => {
  const s = document.getElementById('scene-panel');
  const cs = getComputedStyle(s);
  return { display: cs.display, collapsed: s.classList.contains('collapsed'), visibility: cs.visibility, opacity: cs.opacity, h: Math.round(s.getBoundingClientRect().height) };
});
const animFt = await page.evaluate(() => {
  const f = window.__ft.slice(-70).sort((a, b) => a - b);
  const q = (p) => +f[Math.min(f.length - 1, Math.floor(p * f.length))].toFixed(1);
  return { n: f.length, p50: q(0.5), p95: q(0.95), max: +f[f.length - 1].toFixed(1), fpsP50: Math.round(1000 / q(0.5)) };
});

/* ── 快速开合 10 次（拖影/跳位） ───────────────────────────────────── */
await page.evaluate(() => window.__gevLc.close('data-panel'));
await new Promise((r) => setTimeout(r, 900));
const rapid = await page.evaluate(async () => {
  const jumps = []; let prev = null;
  for (let i = 0; i < 10; i++) {
    window.__gevLc.open('data-panel');
    await new Promise((r) => setTimeout(r, 600));
    window.__gevLc.close('data-panel');
    await new Promise((r) => setTimeout(r, 600));
    const cur = window.__gevLc.info('data-panel');
    if (prev && (Math.abs(cur.x - prev.x) > 2 || Math.abs(cur.y - prev.y) > 2 || Math.abs(cur.w - prev.w) > 2 || Math.abs(cur.h - prev.h) > 2)) jumps.push({ i, prev, cur });
    prev = cur;
  }
  return { jumps, finalInfo: prev };
});

/* ── 录屏：CDP screencast（dsf2 → 3072x1460 帧，ffmpeg 再缩放） ─────── */
const client = await page.createCDPSession();
let frameNo = 0; const frameTimes = [];
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  frameNo++; frameTimes.push(Date.now());
  fs.writeFileSync(`${outDir}/frames/f${String(frameNo).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'));
  try { await client.send('Page.screencastFrameAck', { sessionId }); } catch (e) {}
});
await client.send('Page.startScreencast', { format: 'jpeg', quality: 86, everyNthFrame: 1, maxWidth: 1536, maxHeight: 730 });
const perf = await page.evaluate(async () => {
  const s0 = window.__gevGlStats(); const f0 = s0.frames, t0 = performance.now();
  const ft0 = window.__ft.length;
  window.__gevLc.open('data-panel');
  await new Promise((r) => setTimeout(r, 1400));
  window.__gevLc.close('data-panel');
  await new Promise((r) => setTimeout(r, 1200));
  const ft1 = window.__ft.slice(ft0).sort((a, b) => a - b);
  const q = (p) => +(ft1[Math.min(ft1.length - 1, Math.floor(p * ft1.length))] || 0).toFixed(1);
  const v = window.__gevViewer;
  const f1 = window.__gevGlStats().frames, t1 = performance.now();
  for (let i = 0; i < 60; i++) { v.camera.moveRight(0.004); v.camera.moveUp(0.0015); await new Promise((r) => requestAnimationFrame(r)); }
  const st = window.__gevGlStats();
  return {
    glassFrames: f1 - f0, ms: Math.round(t1 - t0), fps: +(((f1 - f0) * 1000) / (t1 - t0)).toFixed(1),
    animFrames: ft1.length, animP50: q(0.5), animP95: q(0.95), animMax: +ft1[ft1.length - 1].toFixed(1),
    animFpsP50: Math.round(1000 / (q(0.5) || 16.7)),
    panFrames: window.__ft.slice(-62).length, inAppFps: st.fps, scale: st.scale, dev: st.devicePx, gpuMs: st.gpuMs, timerQuery: st.timerQuery,
  };
});
await new Promise((r) => setTimeout(r, 400));
await client.send('Page.stopScreencast');
await new Promise((r) => setTimeout(r, 600));

const gaps = frameTimes.slice(1).map((t, i) => t - frameTimes[i]);
const perFrameFps = gaps.map((g) => +(1000 / g).toFixed(1));
const capture = {
  frames: frameNo,
  avgFps: gaps.length ? +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1) : 0,
  minInstantFps: Math.min(...perFrameFps.slice(1)),
  p10: perFrameFps.slice().sort((a, b) => a - b)[Math.floor(perFrameFps.length * 0.1)],
};

/* ── 9 卡单层玻璃审计 ─────────────────────────────────────────────── */
const audit = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const st = window.__gevGlStats();
  const surf = st.surfaces.map((s) => s.id);
  const per = ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, present: false };
    const cs = getComputedStyle(el);
    const inner = el.querySelector('[class$="-inner"], .panel-inner, .location-inner, .pp-panel-body');
    const ics = inner ? getComputedStyle(inner) : null;
    return {
      id, present: true, lc: el.classList.contains('gev-lc'),
      bg: cs.backgroundColor, border: cs.borderTopWidth, backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      rad: cs.borderTopLeftRadius, quads: surf.filter((s) => s === id).length,
      innerBackdrop: ics ? (ics.backdropFilter || ics.webkitBackdropFilter) : null,
      innerBg: ics ? ics.backgroundColor : null,
    };
  });
  // 卡内是否还有第二层 backdrop-filter / 可见滚动条 / 纯黑文字
  let secondLayer = 0, blackText = 0, scrollbar = 0;
  document.querySelectorAll('.gev-lc *').forEach((n) => {
    const c = getComputedStyle(n);
    if ((c.backdropFilter && c.backdropFilter !== 'none') || (c.webkitBackdropFilter && c.webkitBackdropFilter !== 'none')) secondLayer++;
    if (n.scrollWidth > n.clientWidth + 2 && c.overflowX !== 'visible') scrollbar++;
  });
  document.querySelectorAll('.gev-lc *').forEach((n) => {
    if (!n.textContent || !n.textContent.trim() || n.children.length) return;
    const col = getComputedStyle(n).color.match(/\d+/g);
    if (col && +col[0] < 40 && +col[1] < 40 && +col[2] < 40) blackText++;
  });
  return { ids: ids.length, present: per.filter((p) => p.present).length, quads: surf.length, surfaces: surf, per, secondLayer, blackText, scrollbar, html: document.documentElement.dataset.gevGlassLum };
});

const report = { url, press, afterPress, single, sibDisplay, animFt, rapid, perf, capture, audit, errors: errs };
fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({
  press, sibDisplay, animFt, rapidJumps: rapid.jumps.length, perf, capture, audit: { present: audit.present, quads: audit.quads, secondLayer: audit.secondLayer, blackText: audit.blackText, scrollbar: audit.scrollbar, html: audit.html, per: audit.per.map((p) => [p.id, p.quads, p.bg, p.border, p.backdrop, p.innerBackdrop]) },
  errors: errs.slice(0, 4), firstSamples: single.slice(0, 4), lastSamples: single.slice(-2),
}, null, 1));
await browser.close();
