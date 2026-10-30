/* Phase6D step3：宿主上限判定
   1) about:blank 同窗口 → 纯宿主节奏（无页面工作）
   2) 缩小窗口 → 看是否随像素面积变化
   3) 复原页面 */
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
      res({ frames: gaps.length, fps: Math.round((gaps.length / dt) * 10) / 10, p50: Math.round(s[Math.floor(s.length / 2)] * 10) / 10, max: Math.round(s[s.length - 1] * 10) / 10, mode: s.length ? Math.round(s[Math.floor(s.length * 0.5)] / 6.0606 * 10) / 10 : 0 }); } };
  requestAnimationFrame(tick);
}))()`;
const go = (url) => page.goto(url).catch(() => {});
const win = await page.cdp("Browser.getWindowForTarget").catch(() => null);
const wid = win && win.windowId;
const setBounds = async (b) => { if (wid) await page.cdp("Browser.setWindowBounds", { windowId: wid, bounds: b }).catch(() => {}); };

const out = { style: [] };
await page.cdp("Page.bringToFront").catch(() => {});
await setBounds({ windowState: "normal", left: 40, top: 20, width: 1560, height: 900 });
await page.waitForTimeout(1200);

/* 1) 全屏尺寸 + about:blank */
await go("about:blank");
await page.waitForTimeout(900);
await page.cdp("Page.bringToFront").catch(() => {});
out.blankFull = await page.evaluate(SAMPLE(4000));
out.blankFull.view = await page.evaluate(() => [innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio]);

/* 2) 小窗口 + about:blank */
await setBounds({ left: 40, top: 20, width: 700, height: 420 });
await page.waitForTimeout(1200);
await page.cdp("Page.bringToFront").catch(() => {});
out.blankSmall = await page.evaluate(SAMPLE(4000));
out.blankSmall.view = await page.evaluate(() => [innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio]);

/* 3) 小窗口 + 真页面 */
await go("http://127.0.0.1:4173/?welcome=0&t=" + Date.now());
await page.waitForLoadState("load").catch(() => {});
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(3000);
await page.cdp("Page.bringToFront").catch(() => {});
out.pageSmall = await page.evaluate(SAMPLE(4000));
out.pageSmall.state = await page.evaluate(() => { const v = window.__gevViewer, c = v.scene.canvas; return { scale: Math.round(v.resolutionScale * 1000) / 1000, canvas: [c.width, c.height], dpr: devicePixelRatio, inner: [innerWidth, innerHeight] }; });

/* 4) 复原大窗口 + 真页面 */
await setBounds({ left: 40, top: 20, width: 1560, height: 900 });
await page.waitForTimeout(1500);
await page.cdp("Page.bringToFront").catch(() => {});
out.pageFull = await page.evaluate(SAMPLE(4000));
out.pageFull.state = await page.evaluate(() => { const v = window.__gevViewer, c = v.scene.canvas; return { scale: Math.round(v.resolutionScale * 1000) / 1000, canvas: [c.width, c.height], dpr: devicePixelRatio, inner: [innerWidth, innerHeight] }; });

await fs.writeFile(`${OUT}/host-limit.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ blankFull: out.blankFull, blankSmall: out.blankSmall, pageSmall: out.pageSmall, pageFull: out.pageFull }, null, 1));
