/* 28fps 归因：同页 DPR 1.25 vs DPR 1.0 对照（Phase6A 变更点无关，只定位环境变量） */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6a";
const task = await taskSpace("gev-phase6a-gate");
const page = task.page("p1");
const sample = (ms) => page.evaluate(async (ms) => {
  const t0 = performance.now(); let n = 0; let worst = 0; let prev = t0;
  await new Promise((res) => {
    const tick = (t) => { n++; const d = t - prev; prev = t; if (d > worst) worst = d; if (t - t0 < ms) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  const dt = (performance.now() - t0) / 1000;
  return { fps: Math.round((n / dt) * 10) / 10, worstFrameMs: Math.round(worst * 10) / 10 };
}, ms);
const waitReady = async () => {
  for (let i = 0; i < 120; i++) {
    const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
    if (ok) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(4500);
};

const out = {};
await page.cdp("Page.bringToFront").catch(() => {});
try { await page.goto("http://127.0.0.1:4173/?welcome=0&t=" + Date.now()); } catch {}
await page.waitForLoadState("load"); await waitReady();
out.dprNative = { dpr: await page.evaluate(() => devicePixelRatio), ...(await sample(5000)), canvas: await page.evaluate(() => { const s = window.__gevEdge.stats(); return s.canvas; }) };

await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1356, height: 742, deviceScaleFactor: 1, mobile: false });
try { await page.goto("http://127.0.0.1:4173/?welcome=0&t=" + Date.now()); } catch {}
await page.waitForLoadState("load"); await waitReady();
out.dpr1 = { dpr: await page.evaluate(() => devicePixelRatio), ...(await sample(5000)), canvas: await page.evaluate(() => { const s = window.__gevEdge.stats(); return s.canvas; }) };

await page.cdp("Emulation.clearDeviceMetricsOverride").catch(() => {});
await fs.writeFile(`${OUT}/fps-dpr-ab.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
