/* r18 — where does the 27.5Hz cadence come from? active-tab vs background, and content bisect on a minimal page.
   Writes .gev-logs/ego/phase5/r18-probe.json */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase5/";
const task = await claimTaskSpace(1);
let p1;
try { p1 = task.page("p1"); await p1.url(); } catch { p1 = await task.newPage(); }
if (!String(await p1.url()).includes("4173/index") && !String(await p1.url()).endsWith("4173/")) {
  await p1.goto("http://127.0.0.1:4173/"); await p1.waitForLoadState("load").catch(() => {});
}
await p1.waitForTimeout(4000);

const STAT_FN = `window.__stat = function (ts) {
  const d = ts.slice(1).map((t, i) => t - ts[i]); const s = [...d].sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0); const vs = 1000 / 165; const b = {};
  for (const x of d) { const k = String(Math.round(x / vs)); b[k] = (b[k] || 0) + 1; }
  return { n: d.length, fps: +((d.length / sum) * 1000).toFixed(1), p50: +s[Math.floor(s.length * .5)].toFixed(2),
    p95: +s[Math.floor(s.length * .95)].toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2), vsync: b };
};`;

const measureP1 = async (ms) => {
  await p1.evaluate(`(function(){ ${STAT_FN} })()`);
  return p1.evaluate(async (d) => {
    const ts = await new Promise((res) => {
      const arr = []; let stop = false;
      const tick = (t) => { arr.push(t); if (!stop) requestAnimationFrame(tick); };
      requestAnimationFrame(tick); setTimeout(() => { stop = true; res(arr); }, d);
    });
    return window.__stat(ts);
  }, ms);
};

const R = {};
const put = (k, v) => { R[k] = v; console.log(k, JSON.stringify(v)); };

put("p1_focus", await p1.evaluate(() => ({ hasFocus: document.hasFocus(), vis: document.visibilityState, hidden: document.hidden, url: location.href })));
put("A_app_active", await measureP1(5000));

const p2 = await task.newPage();
const probe = async (mode, ms) => {
  await p2.goto(`http://127.0.0.1:4173/_fps-probe.html?mode=${mode}`);
  await p2.waitForLoadState("load").catch(() => {});
  await p2.evaluate(`(function(){ ${STAT_FN} })()`);
  await p2.waitForTimeout(1500);
  return p2.evaluate(async (d) => {
    const ts = await window.__sample(d);
    return window.__stat(ts);
  }, ms);
};
put("B_probe_plain", await probe("plain", 5000));
put("C_probe_canvas", await probe("canvas", 5000));
put("D_probe_glass", await probe("glass", 5000));

await p1.waitForTimeout(300);
try { await p1.click("body", { position: { x: 4, y: 4 } }); } catch (e) { R.clickErr = String(e).slice(0, 160); }
await p1.waitForTimeout(1200);
put("E_app_again", await measureP1(5000));
put("p1_focus_after", await p1.evaluate(() => ({ hasFocus: document.hasFocus(), vis: document.visibilityState })));

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(OUT + "r18-probe.json", JSON.stringify(R, null, 2));
console.log("WROTE", OUT + "r18-probe.json");
