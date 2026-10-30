/* Phase6D step5：窗口可见时的 about:blank 宿主机上限（不导航，仅测当前页 + blank 两段） */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6d";
await fs.mkdir(OUT, { recursive: true });
const task = await taskSpace("gev-phase6a-gate");
const page = task.page("p1");
const SAMPLE = (ms) => `(() => new Promise((res) => {
  const t0 = performance.now(); const gaps = []; let prev = t0;
  const tick = (t) => { const d = t - prev; prev = t; gaps.push(d);
    if (t - t0 < ${ms}) requestAnimationFrame(tick);
    else { const dt = (performance.now() - t0) / 1000; const s = gaps.slice(2).sort((a, b) => a - b);
      const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
      res({ frames: gaps.length, fps: Math.round((gaps.length / dt) * 10) / 10, p50: q(0.5), p90: q(0.9), max: Math.round(s[s.length - 1] * 10) / 10, vsyncs: Math.round((s[Math.floor(s.length / 2)] / 6.0606) * 10) / 10, inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight], dpr: devicePixelRatio, focus: document.hasFocus(), url: location.href.slice(0, 40) }); } };
  requestAnimationFrame(tick);
}))()`;
await page.cdp("Page.bringToFront").catch(() => {});
const out = {};
out.pageNow = await page.evaluate(SAMPLE(3000));
out.stateNow = await page.evaluate(() => { const v = window.__gevViewer; const c = v && v.scene && v.scene.canvas; return c ? { scale: Math.round(v.resolutionScale * 1000) / 1000, canvas: [c.width, c.height], loop: v.useDefaultRenderLoop, perfMode: localStorage.getItem("gev.perfMode") } : null; });
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(700);
await page.cdp("Page.bringToFront").catch(() => {});
out.blank = await page.evaluate(SAMPLE(4000));
await fs.writeFile(`${OUT}/blank-limit.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
