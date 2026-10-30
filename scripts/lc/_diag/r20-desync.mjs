/* r20 — (1) is any compositor damage slow, or only canvas? (2) does forcing desynchronized 2D contexts rescue the real app?
   Writes .gev-logs/ego/phase5/r20-desync.json + 10-desync.png */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase5";
const task = await claimTaskSpace(1);
let p1; try { p1 = task.page("p1"); await p1.url(); } catch { p1 = await task.newPage(); }
let p2; try { p2 = task.page("p2"); await p2.url(); } catch { p2 = await task.newPage(); }

const STAT_FN = `window.__stat = function (ts) {
  const d = ts.slice(1).map((t, i) => t - ts[i]); const s = [...d].sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0); const vs = 1000 / 165; const b = {};
  for (const x of d) { const k = String(Math.round(x / vs)); b[k] = (b[k] || 0) + 1; }
  return { n: d.length, fps: +((d.length / sum) * 1000).toFixed(1), p50: +s[Math.floor(s.length * .5)].toFixed(2),
    p95: +s[Math.floor(s.length * .95)].toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2), vsync: b };
};`;

const R = {};
const put = (k, v) => { R[k] = v; console.log(k, JSON.stringify(v)); };

const probe = async (mode, ms) => {
  await p2.goto(`http://127.0.0.1:4173/_fps-probe3.html?mode=${mode}`);
  await p2.waitForLoadState("load").catch(() => {});
  await p2.evaluate(`(function(){ ${STAT_FN} })()`);
  await p2.waitForTimeout(1000);
  const extra = await p2.evaluate(() => ({ glDesync: window.__glAttr }));
  return { ...(await p2.evaluate(async (d) => window.__stat(await window.__sample(d)), ms)), extra };
};
put("div_damage", await probe("div", 4000));
put("staticcanvas", await probe("staticcanvas", 4000));
put("webglDesync", await probe("webglDesync", 4000));

// ---- app: force desynchronized on every canvas context created after this point
await p1.goto("http://127.0.0.1:4173/");
await p1.waitForLoadState("load").catch(() => {});
const target = await p1.info().catch(() => null);
R.target = target && (target.targetId || JSON.stringify(target).slice(0, 80));
try {
  await p1.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const g = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, attrs) {
        if (type === "2d") { attrs = Object.assign({}, attrs || {}, { desynchronized: true }); }
        return g.call(this, type, attrs);
      };
    })();`,
  });
  R.injected = true;
} catch (e) { R.injected = "ERR " + String(e).slice(0, 160); console.log(R.injected); }

await p1.reload();
await p1.waitForLoadState("load").catch(() => {});
await p1.evaluate(`(function(){ ${STAT_FN} })()`);
for (let i = 0; i < 90; i++) {
  const ok = await p1.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await p1.waitForTimeout(400);
}
await p1.waitForTimeout(5000);
put("app_desync_ctx", await p1.evaluate(async (d) => window.__stat(await new Promise((res) => {
  const arr = []; let stop = false;
  const tick = (t) => { arr.push(t); if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); setTimeout(() => { stop = true; res(arr); }, d);
})), 6000));
put("ctxStates", await p1.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => ({
  id: c.id || String(c.className).slice(0, 24),
  kind: (() => { try { const x = c.getContext("2d"); return x ? "2d" : "other"; } catch { return "?"; } })(),
  desync: (() => { try { const x = c.getContext("2d"); return x && x.getContextAttributes ? x.getContextAttributes().desynchronized : null; } catch { return "?"; } })(),
}))));
await p1.screenshot({ path: OUT + "/10-desync.png" });

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(OUT + "/r20-desync.json", JSON.stringify(R, null, 2));
console.log("WROTE", OUT + "/r20-desync.json");
