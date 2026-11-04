#!/usr/bin/env node
/**
 * qa-lg-final.mjs —— 复核整改后的最终证据包（dsf=2 真 2x）
 *  A 审计：9 卡单层玻璃 / 无第二层 backdrop / 无黑字 / 无可见滚动条 / 每卡一个 quad
 *  B 截图：默认暗场景全景、亮场景（盐湖）、展开特写
 *  C 动效：展开 in-page 帧时（p50/p95/max，不含截图干扰）+ lens 调制采样 + 兄弟卡收起
 *  D 快速开合 10 次（跳位）
 *  E 按下：玻璃外壳内缩 px + 回弹
 *  F 拖动 A/B：玻璃开 vs 关（归属瓶颈）
 *  G 录屏：CDP screencast 帧序列（供 ffmpeg 合成）
 * 输出：evidence/lg-glass-shots/p0/final/*.png + scratch/final.json
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/final';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const FRAMES = `${DIR}/frames`;
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true }); fs.mkdirSync(SCR, { recursive: true });
const out = { url, errors: [] };

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 12000));

/* rAF 帧时采集器 */
await page.evaluate(() => {
  window.__ft = [];
  let last = performance.now();
  const tick = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length > 6000) window.__ft.shift(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

/* ── A 审计 ─────────────────────────────────────────────────────── */
out.audit = await page.evaluate(() => {
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
      id, present: true, lc: el.classList.contains('gev-lc'), bg: cs.backgroundColor, border: cs.borderTopWidth,
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter, quads: surf.filter((s) => s === id).length,
      innerBackdrop: ics ? (ics.backdropFilter || ics.webkitBackdropFilter) : null, innerBg: ics ? ics.backgroundColor : null,
      shadow: cs.boxShadow,
    };
  });
  let second = 0, black = 0;
  document.querySelectorAll('.gev-lc *').forEach((n) => {
    const c = getComputedStyle(n);
    if ((c.backdropFilter && c.backdropFilter !== 'none') || (c.webkitBackdropFilter && c.webkitBackdropFilter !== 'none')) second++;
    if (n.children.length === 0 && n.textContent && n.textContent.trim()) {
      const m = c.color.match(/\d+/g);
      if (m && +m[0] < 40 && +m[1] < 40 && +m[2] < 40) black++;
    }
  });
  /* 可见滚动条：clientWidth < offsetWidth（原生条占位）或 ::-webkit-scrollbar 宽度 */
  let bar = 0; const barInfo = [];
  document.querySelectorAll('.gev-lc, .gev-lc *').forEach((n) => {
    if (n.offsetWidth - n.clientWidth > 1 || n.offsetHeight - n.clientHeight > 1) { bar++; if (barInfo.length < 4) barInfo.push([n.className, n.offsetWidth - n.clientWidth, n.offsetHeight - n.clientHeight]); }
  });
  return { ids: ids.length, present: per.filter((p) => p.present).length, quads: surf.length, surfaces: surf, per, secondLayer: second, blackText: black, scrollbarBars: bar, barInfo, html: document.documentElement.dataset.gevGlassLum };
});
await page.screenshot({ path: `${DIR}/dark-full.png` });

/* ── C 动效（先测帧时，再截图） ──────────────────────────────────── */
out.anim = await page.evaluate(async () => {
  const samples = [];
  const t0 = performance.now();
  const ft0 = window.__ft.length;
  window.__gevLc.open('data-panel');
  const id = setInterval(() => {
    const a = window.__gevLc.info('data-panel');
    const b = window.__gevLc.info('scene-panel');
    const g = window.__gevGlassAnim;
    samples.push({ t: Math.round(performance.now() - t0), w: a.w, h: a.h, sibCollapsed: b.collapsed, sibH: b.h, lens: g ? +(((performance.now() - g.t0) / g.dur)).toFixed(2) : -1 });
  }, 16);
  await new Promise((r) => setTimeout(r, 1300));
  clearInterval(id);
  const ft = window.__ft.slice(ft0).sort((a, b) => a - b);
  const q = (p) => +(ft[Math.min(ft.length - 1, Math.floor(p * ft.length))] || 0).toFixed(1);
  return { samples, frames: ft.length, p50: q(0.5), p95: q(0.95), max: +ft[ft.length - 1].toFixed(1), fpsP50: Math.round(1000 / q(0.5)) };
});
out.sib = await page.evaluate(() => {
  const s = document.getElementById('scene-panel'); const cs = getComputedStyle(s);
  return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, collapsed: s.classList.contains('collapsed'), h: Math.round(s.getBoundingClientRect().height) };
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${DIR}/expanded.png` });
await page.screenshot({ path: `${DIR}/expanded-zoom.png`, clip: { x: 40, y: 150, width: 360, height: 420 } });

/* ── D 快速开合 10 次 ──────────────────────────────────────────── */
await page.evaluate(() => window.__gevLc.close('data-panel'));
await new Promise((r) => setTimeout(r, 900));
out.rapid = await page.evaluate(async () => {
  const jumps = []; let prev = null;
  for (let i = 0; i < 10; i++) {
    window.__gevLc.open('data-panel'); await new Promise((r) => setTimeout(r, 600));
    window.__gevLc.close('data-panel'); await new Promise((r) => setTimeout(r, 600));
    const cur = window.__gevLc.info('data-panel');
    if (prev && (Math.abs(cur.x - prev.x) > 2 || Math.abs(cur.y - prev.y) > 2 || Math.abs(cur.w - prev.w) > 2 || Math.abs(cur.h - prev.h) > 2)) jumps.push({ i, prev, cur });
    prev = cur;
  }
  return { jumps: jumps.length, finalInfo: prev };
});

/* ── E 按下 flex ───────────────────────────────────────────────── */
out.press = await (async () => {
  const info0 = await page.evaluate(() => window.__gevLc.info('data-panel'));
  const clip = { x: info0.x - 5, y: info0.y + 4, width: 20, height: Math.max(10, info0.h - 8) };
  const bufs = [];
  bufs.push(await page.screenshot({ clip }));
  await page.mouse.move(info0.x + 80, info0.y + 18);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 85));
  bufs.push(await page.screenshot({ clip }));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const float = await page.evaluate(() => window.__gevLc.info('data-panel').floating);
  if (float) { await page.evaluate(() => window.__gevLc.close('data-panel')); await new Promise((r) => setTimeout(r, 700)); }
  return { clip, shots: bufs.map((b, i) => { const p = `${DIR}/press-${i}.png`; fs.writeFileSync(p, b); return p; }), openedByClick: float };
})();

/* ── F 拖动 A/B（玻璃开 vs 关） ────────────────────────────────── */
const fps = (ms) => page.evaluate((ms) => new Promise((done) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}), ms);
const panAB = async () => page.evaluate(async () => {
  const v = window.__gevViewer; const ft0 = window.__ft.length;
  for (let i = 0; i < 45; i++) { v.camera.moveRight(0.003); await new Promise((r) => requestAnimationFrame(r)); }
  const ft = window.__ft.slice(ft0).sort((a, b) => a - b);
  const q = (p) => +(ft[Math.min(ft.length - 1, Math.floor(p * ft.length))] || 0).toFixed(1);
  return { frames: ft.length, p50: q(0.5), p95: q(0.95), fps: Math.round(1000 / (q(0.5) || 16.7)) };
});
out.panGlassOn = await panAB();
await new Promise((r) => setTimeout(r, 1500));
out.panIdleFps = await fps(2000);
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
await new Promise((r) => setTimeout(r, 800));
out.panGlassOff = await panAB();
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; });
await new Promise((r) => setTimeout(r, 1200));
out.statsAfterPan = await page.evaluate(() => { const s = window.__gevGlStats(); return { scale: s.scale, target: s.scaleTarget, dev: s.devicePx, fps: s.fps, events: s.scaleEvents }; });

/* ── G 亮场景（盐湖）+ 暗场景截图 ──────────────────────────────── */
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 13000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1200));
out.bright = await page.evaluate(() => { const s = window.__gevGlStats(); return { html: document.documentElement.dataset.gevGlassLum, lums: s.surfaces.map((x) => [x.id, x.lum]), scale: s.scale, dev: s.devicePx }; });
await page.screenshot({ path: `${DIR}/bright-full.png` });
const lc = await page.evaluate(() => window.__gevLc.info('data-panel'));
await page.screenshot({ path: `${DIR}/bright-header-zoom.png`, clip: { x: lc.x - 6, y: lc.y - 6, width: lc.w + 12, height: Math.min(60, lc.h + 12) } });
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = true; } catch (e) {} });
/* 回暗场景 */
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200), orientation: { heading: 0.6, pitch: -0.55, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 12000));
await page.screenshot({ path: `${DIR}/dark-ref.png` });

/* ── H 录屏（展开 + 收起） ─────────────────────────────────────── */
const client = await page.createCDPSession();
let n = 0; const times = [];
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  n++; times.push(Date.now());
  fs.writeFileSync(`${FRAMES}/f${String(n).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'));
  try { await client.send('Page.screencastFrameAck', { sessionId }); } catch (e) {}
});
await client.send('Page.startScreencast', { format: 'jpeg', quality: 62, everyNthFrame: 1, maxWidth: 1280, maxHeight: 610 });
await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 300));
  window.__gevLc.open('data-panel');
  await new Promise((r) => setTimeout(r, 1500));
  window.__gevLc.close('data-panel');
  await new Promise((r) => setTimeout(r, 1300));
});
await client.send('Page.stopScreencast');
await new Promise((r) => setTimeout(r, 500));
const gaps = times.slice(1).map((t, i) => t - times[i]);
out.capture = { frames: n, avgFps: gaps.length ? +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1) : 0, p10: gaps.length ? +(1000 / gaps.slice().sort((a, b) => b - a)[Math.floor(gaps.length * 0.1)]).toFixed(1) : 0 };

out.finalStats = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, target: s.scaleTarget, dev: s.devicePx, dpr: s.dpr, count: s.count, gpuMs: s.gpuMs, timerQuery: s.timerQuery, config: s.config }; });
fs.writeFileSync(`${SCR}/qa-lg-final.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({
  audit: { present: out.audit.present, quads: out.audit.quads, secondLayer: out.audit.secondLayer, blackText: out.audit.blackText, scrollbarBars: out.audit.scrollbarBars, barInfo: out.audit.barInfo, html: out.audit.html },
  anim: { frames: out.anim.frames, p50: out.anim.p50, p95: out.anim.p95, max: out.anim.max, fpsP50: out.anim.fpsP50, first: out.anim.samples.slice(0, 3), last: out.anim.samples.slice(-2) },
  sib: out.sib, rapid: out.rapid, press: out.press.shots, panGlassOn: out.panGlassOn, panGlassOff: out.panGlassOff, panIdleFps: out.panIdleFps,
  statsAfterPan: out.statsAfterPan, bright: out.bright, capture: out.capture, finalStats: out.finalStats, errors: out.errors.slice(0, 5),
}, null, 1));
await browser.close();
