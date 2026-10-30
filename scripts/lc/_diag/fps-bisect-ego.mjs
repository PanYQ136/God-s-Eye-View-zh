// fps-bisect-ego.mjs — Phase5 FPS 归因：内容无关性二分
// 结论（2026-10-29 实测）：Ego Lite 任务空间里「任何持续动画的文档」都被钉在 ~27.5fps，
// 与 App / 玻璃 / Cesium / 分辨率 / dpr / 焦点全部无关；静态空白页 165fps。
// 用法： cd C:/Users/13680/ego && ego-browser nodejs < D:/Hermes/gods-eye-view/scripts/lc/_diag/fps-bisect-ego.mjs
const APP = "http://127.0.0.1:4173";
const SPACE = "gev-fps-bisect";       // 一次性空间，不污染 gate 空间
const task = await taskSpace(SPACE);
const page = await task.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE = `(async (ms) => {
  const ts = []; let stop = false;
  const tick = (t) => { ts.push(t); if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await new Promise((res) => setTimeout(res, ms));
  stop = true;
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0);
  const uniq = {}; for (const x of d) { const k = (Math.round(x * 10) / 10).toFixed(1); uniq[k] = (uniq[k] || 0) + 1; }
  return { n: d.length, fps: +((d.length / sum) * 1000).toFixed(1), p50: +d[Math.floor(d.length*.5)].toFixed(2),
           p95: +d[Math.floor(d.length*.95)].toFixed(2), min: +d[0].toFixed(2), max: +d[d.length-1].toFixed(2),
           histo: Object.entries(uniq).sort((a,b)=>b[1]-a[1]).slice(0,4) };
})`;

const head = `<canvas id="c" style="position:fixed;inset:0;width:100%;height:100%"></canvas>`;
const VARIANTS = {
  v0_empty: `<!doctype html><body style="margin:0;background:#111"></body>`,
  v1_canvas2d_full: `<!doctype html><body style="margin:0;overflow:hidden;background:#111">${head}<script>
    const c=document.getElementById('c');c.width=Math.round(innerWidth*devicePixelRatio);c.height=Math.round(innerHeight*devicePixelRatio);
    const x=c.getContext('2d');let i=0;(function t(){x.fillStyle='#123';x.fillRect(0,0,c.width,c.height);x.fillStyle='#4af';x.fillRect((i++*7)%c.width,100,200,200);requestAnimationFrame(t);})();</script></body>`,
  v2_webgl_clear_only: `<!doctype html><body style="margin:0;overflow:hidden;background:#111">${head}<script>
    const c=document.getElementById('c');c.width=Math.round(innerWidth*devicePixelRatio);c.height=Math.round(innerHeight*devicePixelRatio);
    const gl=c.getContext('webgl',{powerPreference:'high-performance'});let i=0;(function t(){i=(i+1)%255;gl.clearColor(i/255,.2,.4,1);gl.clear(gl.COLOR_BUFFER_BIT);requestAnimationFrame(t);})();</script></body>`,
  v3_10px_div: `<!doctype html><body style="margin:0;background:#111"><div id="d" style="position:fixed;left:10px;top:10px;width:10px;height:10px;background:#4af"></div>
    <script>let i=0;(function t(){document.getElementById('d').style.left=(10+i++%200)+'px';requestAnimationFrame(t);})();</script></body>`,
};

async function load(html) {
  await page.goto("about:blank");
  await sleep(200);
  await page.evaluate(`document.open();document.write(${JSON.stringify(html)});document.close();true`);
  await sleep(1200);
}
const out = {};
for (const [k, html] of Object.entries(VARIANTS)) { await load(html); out[k] = await page.evaluate(`${SAMPLE}(4000)`); }
// 真实页面基线
await page.goto(APP); await sleep(6000);
out.app = await page.evaluate(`${SAMPLE}(8000)`);
out.appState = await page.evaluate(`(() => ({ url: location.href, dpr: devicePixelRatio, inner: [innerWidth, innerHeight],
  cards: document.querySelectorAll(".gev-lc").length,
  bd: [...document.querySelectorAll("*")].filter(e => { const c = getComputedStyle(e); return c.backdropFilter && c.backdropFilter !== "none"; }).length,
  canv: [...document.querySelectorAll("canvas")].map(c => (c.id||"?")+":"+c.width+"x"+c.height) }))()`);
// 焦点 / dpr 覆盖对照
out.cdp = {};
try { await page.cdp("Page.bringToFront"); await sleep(400); } catch (e) { out.cdp.front = String(e).slice(0,80); }
await load(VARIANTS.v3_10px_div);
out.focused_10px_div = await page.evaluate(`${SAMPLE}(4000)`);
try {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1360, height: 782, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  out.dsf1_10px_div = await page.evaluate(`${SAMPLE}(3000)`);
  await page.cdp("Emulation.clearDeviceMetricsOverride");
} catch (e) { out.cdp.dsf = String(e).slice(0,80); }

console.log(JSON.stringify(out, null, 1));
