/* Phase6A 时序诊断：pp 展开后不同时刻截图（找“看不见”的时间窗） */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6a";
await fs.mkdir(OUT, { recursive: true });
const task = await taskSpace("gev-phase6a-timing");
const page = task.page("p1");
try { await page.goto("http://127.0.0.1:4173/?welcome=0&t=" + Date.now()); } catch {}
await page.waitForLoadState("load");
for (let i = 0; i < 120; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(4000);

const snap = () => page.evaluate(() => {
  const el = document.getElementById("pp-toggles");
  const b = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const body = el.querySelector(".pp-panel-body");
  const firstBtn = el.querySelector(".pp-toggle-btn");
  const fb = firstBtn ? firstBtn.getBoundingClientRect() : null;
  const self = firstBtn ? getComputedStyle(firstBtn) : null;
  return {
    phase: el.dataset.lcPhase, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    op: s.opacity, transform: s.transform, clip: s.clipPath, vis: s.visibility,
    scroll: [el.scrollWidth, el.clientWidth, el.scrollHeight, el.clientHeight],
    bodyDisp: body ? getComputedStyle(body).display : null,
    firstBtn: fb ? { rect: [Math.round(fb.x), Math.round(fb.y), Math.round(fb.width), Math.round(fb.height)], op: self.opacity, color: self.color, vis: self.visibility } : null,
    anims: document.getAnimations().map((a) => ({ t: a.constructor.name, playing: a.playState, target: (a.effect && a.effect.target && (a.effect.target.id || a.effect.target.className)) || null })).slice(0, 8),
  };
});

const pts = await page.evaluate(() => {
  const el = document.getElementById("pp-toggles"); const b = el.getBoundingClientRect();
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + 18);
  const hit = document.elementFromPoint(x, y);
  return { x, y, hit: hit ? hit.tagName + "." + String(hit.className).slice(0, 30) : null };
});
console.log("clickTarget", JSON.stringify(pts));

const rows = [];
await page.mouse.click(pts.x, pts.y, { label: "open pp" });
const marks = [80, 160, 300, 500, 800, 1200, 2000];
let last = 0;
for (let i = 0; i < marks.length; i++) {
  await page.waitForTimeout(marks[i] - last); last = marks[i];
  const s = await snap();
  rows.push({ t: marks[i], ...s });
  await page.screenshot({ path: `${OUT}/timing-${marks[i]}ms.png`, clip: { x: 980, y: 70, width: 340, height: 480 } }).catch(() => {});
}
await fs.writeFile(`${OUT}/timing.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 1).slice(0, 8000));
