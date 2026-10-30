/* Phase6D step4：Ego 宿主上限（about:blank）与原页面同尺寸对照；顺带恢复窗口 */
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
      res({ frames: gaps.length, fps: Math.round((gaps.length / dt) * 10) / 10, p50: q(0.5), p90: q(0.9), max: Math.round(s[s.length - 1] * 10) / 10, vsyncs: Math.round((s[Math.floor(s.length / 2)] / 6.0606) * 10) / 10, inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight], dpr: devicePixelRatio, focus: document.hasFocus() }); } };
  requestAnimationFrame(tick);
}))()`;
const win = await page.cdp("Browser.getWindowForTarget").catch(() => null);
const wid = win && win.windowId;
const B = (b) => page.cdp("Browser.setWindowBounds", { windowId: wid, bounds: b }).catch(() => {});

await B({ windowState: "normal" });
await page.waitForTimeout(400);
await B({ left: 60, top: 40, width: 1400, height: 800 });
await page.waitForTimeout(1200);
await page.cdp("Page.bringToFront").catch(() => {});
let geo = await page.evaluate(() => [innerWidth, innerHeight, outerWidth, outerHeight]);
if (geo[0] < 800) { await B({ windowState: "maximized" }); await page.waitForTimeout(1400); geo = await page.evaluate(() => [innerWidth, innerHeight, outerWidth, outerHeight]); }

const out = { geo };
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(800);
await page.cdp("Page.bringToFront").catch(() => {});
out.blank = await page.evaluate(SAMPLE(4000));

await page.goto("http://127.0.0.1:4173/?welcome=0&t=" + Date.now()).catch(() => {});
await page.waitForLoadState("load").catch(() => {});
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(3000);
await page.cdp("Page.bringToFront").catch(() => {});
out.page = await page.evaluate(SAMPLE(5000));
out.page.state = await page.evaluate(() => { const v = window.__gevViewer, c = v.scene.canvas; return { scale: Math.round(v.resolutionScale * 1000) / 1000, canvas: [c.width, c.height], loop: v.useDefaultRenderLoop, perfMode: localStorage.getItem("gev.perfMode") }; });
await page.evaluate(() => { window.__gevViewer.useDefaultRenderLoop = false; });
await page.waitForTimeout(600);
out.pageNoLoop = await page.evaluate(SAMPLE(4000));
await page.evaluate(() => { window.__gevViewer.useDefaultRenderLoop = true; });

await fs.writeFile(`${OUT}/host-limit.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
