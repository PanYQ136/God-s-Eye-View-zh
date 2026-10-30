/* Phase6D step2：Ego 内 scale/覆盖层 A/B（不改玻璃参数）
   A=as-is(1.544) B=resolutionScale 1.25(=dpr) C=1.0 D=as-is+停 Cesium renderLoop E=as-is+__gevEdge.off()
   每段 4s，交错两轮，取均值。 */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6d";
await fs.mkdir(OUT, { recursive: true });
const task = await taskSpace("gev-phase6a-gate");
const page = task.page("p1");

const SAMPLE = (ms) => `(() => new Promise((res) => {
  const t0 = performance.now(); const gaps = []; let prev = t0;
  const tick = (t) => { const d = t - prev; prev = t; gaps.push(d);
    if (t - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      const dt = (performance.now() - t0) / 1000;
      const s = gaps.slice(2).sort((a, b) => a - b);
      const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
      res({ frames: gaps.length, fps: Math.round((gaps.length / dt) * 10) / 10, p50: q(0.5), p90: q(0.9), max: Math.round(s[s.length - 1] * 10) / 10 });
    } };
  requestAnimationFrame(tick);
}))()`;

const win = await page.cdp("Browser.getWindowForTarget").catch(() => null);
if (win && win.windowId) await page.cdp("Browser.setWindowBounds", { windowId: win.windowId, bounds: { windowState: "normal" } }).catch(() => {});
await page.cdp("Page.bringToFront").catch(() => {});
await page.mouse.click(400, 300, { label: "focus page" }).catch(() => {});
await page.waitForTimeout(800);

const setScale = (s) => page.evaluate((s) => { const v = window.__gevViewer; v.resolutionScale = s; v.resize(); v.scene.requestRender && v.scene.requestRender(); const c = v.scene.canvas; return { scale: v.resolutionScale, canvas: [c.width, c.height] }; }, s);
const setLoop = (on) => page.evaluate((on) => { const v = window.__gevViewer; v.useDefaultRenderLoop = on; return v.useDefaultRenderLoop; }, on);
const edgeOn = (on) => page.evaluate((on) => { if (window.__gevEdge) window.__gevEdge[on ? "on" : "off"](); return window.__gevEdge ? window.__gevEdge.stats().only : null; }, on);
const info = () => page.evaluate(() => { const v = window.__gevViewer, c = v.scene.canvas; return { scale: Math.round(v.resolutionScale * 1000) / 1000, canvas: [c.width, c.height], dpr: devicePixelRatio, hasFocus: document.hasFocus(), outer: [outerWidth, outerHeight], loop: v.useDefaultRenderLoop }; });

const orig = await info();
const rows = [];
const measure = async (mode) => {
  await page.cdp("Page.bringToFront").catch(() => {});
  const r = await page.evaluate(SAMPLE(4000)).catch((e) => ({ err: String(e).slice(0, 100) }));
  rows.push({ mode, ...r });
};
for (let round = 0; round < 2; round++) {
  await setScale(orig.scale); await page.waitForTimeout(300); await measure("A-asis-" + orig.scale);
  await setScale(1.25); await page.waitForTimeout(300); await measure("B-scale-1.25");
  await setScale(1.0); await page.waitForTimeout(300); await measure("C-scale-1.0");
  await setScale(orig.scale);
  await edgeOn(false); await page.waitForTimeout(300); await measure("E-edgeoff");
  await edgeOn(true); await page.waitForTimeout(300);
  await setLoop(false); await page.waitForTimeout(500); await measure("D-cesiumloop-off");
  await setLoop(true); await page.waitForTimeout(800);
}
await setScale(orig.scale);
await setLoop(true);
const mean = (m) => { const xs = rows.filter((r) => r.mode.startsWith(m)).map((r) => r.fps).filter((x) => typeof x === "number"); return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null; };
const res = { orig, rows, means: { asis: mean("A-asis"), s125: mean("B-scale"), s10: mean("C-scale"), edgeoff: mean("E-edgeoff"), noloop: mean("D-cesiumloop") } };
await fs.writeFile(`${OUT}/scale-ab.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res.means), "\n", JSON.stringify(rows.map((r) => [r.mode, r.fps, r.p50, r.p90, r.max])), "\n orig:", JSON.stringify(orig));
