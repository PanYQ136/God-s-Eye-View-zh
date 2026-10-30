/* Phase6D step6：Ego 是否对「持续产帧页面」设了帧率上限
   A 静态页（无动画） B 20x20 方块 transform 动画 C 全屏 CSS 动画
   同一标签、同一窗口尺寸下对照 rAF 节奏。 */
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
      res({ frames: gaps.length, fps: Math.round((gaps.length / dt) * 10) / 10, p50: q(0.5), p90: q(0.9), max: Math.round(s[s.length - 1] * 10) / 10, vsyncs: Math.round((s[Math.floor(s.length / 2)] / 6.0606) * 10) / 10, inner: [innerWidth, innerHeight], focus: document.hasFocus() }); } };
  requestAnimationFrame(tick);
}))()`;
const STATIC = "data:text/html,<body style='margin:0;background:%23000'><div style='width:20px;height:20px;background:red'></div>";
const MINI = "data:text/html,<body style='margin:0;background:%23000'><div id=b style='position:fixed;width:20px;height:20px;background:red'></div><script>let x=0;requestAnimationFrame(function f(){x=(x+3)%1200;b.style.transform='translateX('+x+'px)';requestAnimationFrame(f)})</" + "script>";
const FULL = "data:text/html,<body style='margin:0;background:%23000'><style>@keyframes k{from{transform:translateX(0)}to{transform:translateX(1200px)}}div{position:fixed;width:100vw;height:100vh;background:linear-gradient(90deg,%23c00,%2300c);animation:k 1s linear infinite}</style><div></div>";
const out = {};
for (const [k, url] of Object.entries({ static: STATIC, mini: MINI, full: FULL })) {
  await page.goto(url).catch(() => {});
  await page.waitForTimeout(900);
  await page.cdp("Page.bringToFront").catch(() => {});
  out[k] = await page.evaluate(SAMPLE(3500));
}
await fs.writeFile(`${OUT}/host-cap.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
