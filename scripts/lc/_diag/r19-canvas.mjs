/* r19 — canvas present cost knobs: noop / small / 2d / 2d-alpha:false / 2d-desynchronized / webgl
   Writes .gev-logs/ego/phase5/r19-canvas.json */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase5/";
const task = await claimTaskSpace(1);
let p1;
try { p1 = task.page("p1"); await p1.url(); } catch { p1 = await task.newPage(); }
const pages = await task.pages();
let p2;
try { p2 = task.page("p2"); await p2.url(); } catch { p2 = await task.newPage(); }

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
  await p2.goto(`http://127.0.0.1:4173/_fps-probe2.html?mode=${mode}`);
  await p2.waitForLoadState("load").catch(() => {});
  await p2.evaluate(`(function(){ ${STAT_FN} })()`);
  await p2.waitForTimeout(1200);
  const extra = await p2.evaluate(() => ({ desync: window.__desyncOk, gl: window.__glInfo, cv: [document.getElementById("cv").width, document.getElementById("cv").height] }));
  const st = await p2.evaluate(async (d) => window.__stat(await window.__sample(d)), ms);
  return { ...st, extra };
};
for (const [m, ms] of [["noop", 4000], ["small", 4000], ["canvas", 4000], ["alpha2d", 4000], ["desync", 4000], ["webgl", 4000]]) {
  put(m, await probe(m, ms));
}
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(OUT + "r19-canvas.json", JSON.stringify(R, null, 2));
console.log("WROTE", OUT + "r19-canvas.json");
