/* Phase6D step1：Ego 宿主内归因 —— 帧间隔节奏直方图 + 可见性 + 覆盖层状态
   判据：间隔若落在 165Hz 的整数倍（6.06ms×k）就是节奏/节流问题，不是算力问题。 */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6d";
await fs.mkdir(OUT, { recursive: true });
const task = await taskSpace("gev-phase6a-gate");
const page = task.page("p1");
for (let i = 0; i < 90; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(3000);
const SAMPLE = (ms) => `(() => new Promise((res) => {
  const t0 = performance.now(); const gaps = []; let prev = t0; let loaf = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push(Math.round(e.duration)); });
  try { obs.observe({ type: 'long-animation-frame', buffered: false }); } catch (e) {}
  const tick = (t) => { const d = t - prev; prev = t; if (gaps.length || t > t0) gaps.push(d); if (t - t0 < ${ms}) requestAnimationFrame(tick); else {
    try { obs.disconnect(); } catch (e) {}
    const dt = (performance.now() - t0) / 1000;
    const s = gaps.slice(2).sort((a, b) => a - b);
    const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
    res({ frames: gaps.length, spanMs: Math.round(performance.now() - t0), fps: Math.round((gaps.length / dt) * 10) / 10,
          p10: q(0.1), p50: q(0.5), p90: q(0.9), p95: q(0.95), max: Math.round(s[s.length - 1] * 10) / 10,
          loafMax: loaf.length ? Math.max(...loaf) : 0, loafN: loaf.length, gaps: gaps.slice(2, 90).map((g) => Math.round(g * 10) / 10) });
  } };
  requestAnimationFrame(tick);
}))()`;

const state = await page.evaluate(() => {
  const v = window.__gevViewer;
  const cs = v && v.scene && v.scene.canvas ? v.scene.canvas : null;
  const px = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), disp: getComputedStyle(e).display, vis: getComputedStyle(e).visibility, op: getComputedStyle(e).opacity }; };
  return {
    url: location.href, title: document.title,
    hidden: document.hidden, visibilityState: document.visibilityState, hasFocus: document.hasFocus(),
    dpr: window.devicePixelRatio, inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight],
    screen: [screen.width, screen.height, screen.availWidth, screen.availHeight],
    canvas: cs ? [cs.width, cs.height, cs.clientWidth, cs.clientHeight] : null,
    targetFrameRate: v ? v.targetFrameRate : null,
    resolutionScale: v ? v.scene.globe ? v.scene.globe.ellipsoid ? v.resolutionScale : null : null : null,
    useDefaultRenderLoop: v ? v.useDefaultRenderLoop : null,
    edge: (window.__gevEdge && window.__gevEdge.stats) ? window.__gevEdge.stats() : null,
    layers: { scope_mask: px('scope-mask'), world_overlay: px('world-overlay-canvas'), edge_canvas: px('gev-edge-lens'),
              cctv: px('cctv-video'), clouds: px('cockpit-cloud-effects'),
              sun: px('celestial-sun-canvas'), moon: px('celestial-moon-canvas') },
    canvases: [...document.querySelectorAll('canvas')].map((c) => ({ id: c.id || '(no-id)', cls: c.className || '', w: c.width, h: c.height })),
  };
});

await page.cdp("Page.bringToFront").catch(() => {});
const hb = await page.evaluate(() => { const b = document.body.getBoundingClientRect(); return [Math.round(b.width / 2), Math.round(b.height / 2)]; });
await page.mouse.click(hb[0], hb[1], { label: "focus page" });
await page.waitForTimeout(600);

const runs = [];
for (let i = 0; i < 3; i++) {
  await page.cdp("Page.bringToFront").catch(() => {});
  runs.push(await page.evaluate(SAMPLE(4000)).catch((e) => ({ err: String(e).slice(0, 120) })));
  await page.waitForTimeout(200);
}
const res = { state, runs };
await fs.writeFile(`${OUT}/host-cadence.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify({ fps: runs.map((r) => r.fps), p50: runs.map((r) => r.p50), p90: runs.map((r) => r.p90), max: runs.map((r) => r.max), loafMax: runs.map((r) => r.loafMax), gaps0: runs[0] && runs[0].gaps && runs[0].gaps.slice(0, 24), hidden: state.hidden, hasFocus: state.hasFocus, dpr: state.dpr, inner: state.inner, screen: state.screen, canvas: state.canvas, targetFrameRate: state.targetFrameRate, useDefaultRenderLoop: state.useDefaultRenderLoop, layers: state.layers, edgeFps: state.edge && state.edge.fps, edgeSkip: state.edge && state.edge.skip, edgeScale: state.edge && state.edge.scale, edgeCanvas: state.edge && state.edge.canvas }, null, 1));
