/* Phase6A 控件绘制探针：pp 面板里的滑块/按钮/文字到底画没画 */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6a";
await fs.mkdir(OUT, { recursive: true });
const task = await taskSpace("gev-phase6a-probe2");
const page = task.page("p1");
try { await page.goto("http://127.0.0.1:4173/?welcome=0&t=" + Date.now()); } catch {}
await page.waitForLoadState("load");
for (let i = 0; i < 120; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(3500);

/* 把镜头转到亮色城市区域，模拟审计时的亮底（面板可读性最差场景） */
const pt = await page.evaluate(() => {
  const el = document.getElementById("pp-toggles"); const b = el.getBoundingClientRect();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 18) };
});
await page.mouse.click(pt.x, pt.y, { label: "open pp" });
await page.waitForTimeout(1500);

const out = await page.evaluate(() => {
  const pp = document.getElementById("pp-toggles");
  const pick = (sel) => {
    const e = pp.querySelector(sel);
    if (!e) return null;
    const s = getComputedStyle(e);
    const th = (() => { try { return getComputedStyle(e, "::-webkit-slider-thumb"); } catch { return null; } })();
    const tk = (() => { try { return getComputedStyle(e, "::-webkit-slider-runnable-track"); } catch { return null; } })();
    const r = e.getBoundingClientRect();
    return {
      cls: String(e.className).slice(0, 40), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      bg: s.backgroundColor, bgImg: s.backgroundImage, shadow: s.boxShadow, color: s.color, op: s.opacity, vis: s.visibility,
      appearance: s.appearance, border: s.border,
      thumb: th ? { bg: th.backgroundColor, bgImg: th.backgroundImage, w: th.width, h: th.height, shadow: th.boxShadow } : "n/a",
      track: tk ? { bg: tk.backgroundColor, bgImg: tk.backgroundImage, h: tk.height } : "n/a",
    };
  };
  const slider = pp.querySelector("input.pp-slider");
  const sliders = [...pp.querySelectorAll("input.pp-slider")].map((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { id: e.id, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: s.backgroundColor, bgImg: s.backgroundImage.slice(0, 60), op: s.opacity }; });
  return {
    phase: pp.dataset.lcPhase,
    sliders,
    toggleBtns: [...pp.querySelectorAll(".pp-toggle-btn")].slice(0, 6).map((e) => { const s = getComputedStyle(e), l = e.querySelector(".pp-label"); return { id: e.id, active: e.classList.contains("active"), bg: s.backgroundColor, bgImg: s.backgroundImage.slice(0, 50), labelColor: l ? getComputedStyle(l).color : null, labelTextShadow: l ? getComputedStyle(l).textShadow.slice(0, 40) : null }; }),
    slidersDetail: ["input.pp-slider", ".pp-select", ".pp-mode-btn", ".pp-slider-value", ".pp-label"].map((s) => [s, pick(s)]),
    /* 面板正上方一条横向取样位置（供像素统计） */
    sampleRow: (() => { const e = pp.querySelectorAll("input.pp-slider")[2]; if (!e) return null; const r = e.getBoundingClientRect(); return { y: Math.round(r.y + r.height / 2), x0: Math.round(r.x), x1: Math.round(r.right) }; })(),
    scroll: [pp.scrollTop, pp.scrollHeight, pp.clientHeight],
  };
});

/* 滚动验证：真实滚轮 */
const before = await page.evaluate(() => document.getElementById("pp-toggles").scrollTop);
await page.mouse.move(1150, 300, { label: "hover panel body" });
await page.mouse.wheel(0, 420, { label: "scroll pp panel" });
await page.waitForTimeout(500);
const after = await page.evaluate(() => document.getElementById("pp-toggles").scrollTop);
out.scrollTest = { before, after };
await page.screenshot({ path: `${OUT}/probe2-scrolled.png` });
await page.evaluate(() => { document.getElementById("pp-toggles").scrollTop = 0; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/probe2-top.png`, clip: { x: 990, y: 80, width: 340, height: 470 } });

await fs.writeFile(`${OUT}/probe2.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 9000));
