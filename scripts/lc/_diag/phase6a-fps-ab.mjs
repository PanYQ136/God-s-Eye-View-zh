/* Phase6A FPS A/B：同页交错对照「本次 hover 高光（含 transition）」vs「关掉它」
   目的：证明新增 hover 高光不吃帧；同时记录同浏览器里其它 agent 页面（GPU 争用） */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6a";
await fs.mkdir(OUT, { recursive: true });
const task = await taskSpace("gev-phase6a-gate");
const page = task.page("p1");
try { await page.goto("http://127.0.0.1:4173/?welcome=0&t=" + Date.now()); } catch {}
await page.waitForLoadState("load");
for (let i = 0; i < 120; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(4000);

const sample = (ms) => page.evaluate(async (ms) => {
  const t0 = performance.now(); let n = 0; let worst = 0; let prev = t0;
  await new Promise((res) => {
    const tick = (t) => { n++; const d = t - prev; prev = t; if (d > worst) worst = d; if (t - t0 < ms) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  const dt = (performance.now() - t0) / 1000;
  return { fps: Math.round((n / dt) * 10) / 10, worstFrameMs: Math.round(worst * 10) / 10, frames: n };
}, ms);

/* 关掉本次新增 hover 高光（等价于改前状态），用于同页对照 */
const OFF = `[data-p6off] .gev-lc:hover { box-shadow: var(--lc-shell-shadow) !important; }
[data-p6off] .gev-lc:hover::before { background: linear-gradient(90deg, transparent, var(--lc-gloss) 18%, var(--lc-gloss) 82%, transparent) !important; }
[data-p6off] .gev-lc { transition: none !important; }`;
const onOff = () => page.evaluate((css) => {
  let s = document.getElementById("p6off-style");
  if (!s) { s = document.createElement("style"); s.id = "p6off-style"; s.textContent = css; document.head.appendChild(s); }
  document.documentElement.setAttribute("data-p6off", "1");
}, OFF);
const onAsIs = () => page.evaluate(() => {
  document.documentElement.removeAttribute("data-p6off");
});

const hb = await page.evaluate(() => { const b = document.getElementById("location-bar").getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
await page.mouse.move(Math.round(hb[0] + hb[2] / 2), Math.round(hb[1] + hb[3] / 2), { label: "hover a card" });
await page.waitForTimeout(500);

const runs = [];
for (let i = 0; i < 3; i++) {
  await page.cdp("Page.bringToFront").catch(() => {});
  await onAsIs(); await page.waitForTimeout(300);
  const a = await sample(4000); runs.push({ mode: "hover-highlight-on", ...a });
  await page.cdp("Page.bringToFront").catch(() => {});
  await onOff(); await page.waitForTimeout(300);
  const b = await sample(4000); runs.push({ mode: "hover-highlight-off", ...b });
}
await onAsIs();
const mean = (m) => { const xs = runs.filter((r) => r.mode === m).map((r) => r.fps); return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10; };
const tabs = await page.evaluate(() => document.title);
const other = await page.evaluate(() => [...document.querySelectorAll("link[rel=preload]")].length);
const res = { runs, meanOn: mean("hover-highlight-on"), meanOff: mean("hover-highlight-off"), appTitle: tabs, delta: Math.round((mean("hover-highlight-on") - mean("hover-highlight-off")) * 10) / 10, edge: await page.evaluate(() => (window.__gevEdge || {}).stats ? window.__gevEdge.stats().fps : null) };
await fs.writeFile(`${OUT}/fps-ab.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
