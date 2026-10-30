/* Phase6A Gate — Ego Lite 真实浏览器（RTX 3060）
   验收：① pp 展开内容可见（开关行文字可读）+ 可滚 + 无裁切 ② hover 单层镜面高光可见
   产物：.gev-logs/ego/phase6a/gate.json + 截图 */
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
await page.waitForTimeout(4500);

const R = [];
const rec = (name, ok, detail) => { R.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  <- " + JSON.stringify(detail).slice(0, 500)}`); };
const ids = ["data-panel", "scene-panel", "pp-toggles", "cctv-panel", "global-context-panel", "location-bar", "control-panel", "gev-voice-control"];

/* 截图走 CDP Page.captureScreenshot：ego 的 page.screenshot 在窗口被最小化时会抛错，
   而 CDP 直接取合成帧，和窗口状态无关（窗口可见性不影响 Cesium 渲染，rAF 仍在跑）。 */
const shot = async (path, clip) => {
  const args = { format: "png", captureBeyondViewport: false };
  if (clip) args.clip = { ...clip, scale: 1 };
  const r = await page.cdp("Page.captureScreenshot", args);
  await fs.writeFile(path, Buffer.from(r.data, "base64"));
  return path;
};

/* ── 0 GPU ─────────────────────────────────────────────────────────────── */
const gpu = await page.evaluate(() => ({ probe: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null, chip: (document.getElementById("gev-gpu-chip") || {}).textContent || null }));
rec("G0 GPU renderer = RTX 3060（非软件）", !!gpu.probe && /RTX 3060/.test(gpu.probe.renderer || "") && gpu.probe.software === false, gpu);

/* ── 1 改前基线：卡壳非 hover 状态仍为单层材质（无 border/outline/backdrop/inset 实线）── */
const base = await page.evaluate((ids) => ids.map((id) => {
  const el = document.getElementById(id), s = getComputedStyle(el);
  const b = getComputedStyle(el, "::before");
  return { id, shadow: s.boxShadow, border: s.borderTopWidth + "|" + s.borderRightWidth + "|" + s.borderBottomWidth + "|" + s.borderLeftWidth, outline: s.outlineStyle + "|" + s.outlineWidth, bd: s.backdropFilter, bg: s.backgroundColor, beforeBg: b.backgroundImage.slice(0, 90) };
}), ids);
rec("M1 9 张卡壳：0 border / 0 outline / 0 backdrop-filter / 0 填充（单层材质未被破坏）",
  base.every((c) => c.border === "0px|0px|0px|0px" && /none\|0px/.test(c.outline) && (c.bd === "none" || !c.bd) && c.bg === "rgba(0, 0, 0, 0)"), base.filter((c) => !(c.border === "0px|0px|0px|0px" && c.bg === "rgba(0, 0, 0, 0)")));

/* ── 2 打开“显示”（真实鼠标点标题条） ────────────────────────────────── */
const pt = await page.evaluate(() => { const el = document.getElementById("pp-toggles"); const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 18) }; });
await page.mouse.click(pt.x, pt.y, { label: "open pp panel" });
await page.waitForTimeout(1400);

const ppOpen = await page.evaluate(() => {
  const pp = document.getElementById("pp-toggles");
  const b = pp.getBoundingClientRect();
  const labels = [...pp.querySelectorAll(".pp-toggle-btn .pp-label")];
  const lum = (rgb) => { const m = (rgb || "").match(/[\d.]+/g); if (!m) return null; const [r, g, bb] = m.map(Number); return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * bb)); };
  const rows = [...pp.querySelectorAll(".pp-toggle-group")].map((r) => { const rb = r.getBoundingClientRect(); return { h: Math.round(rb.height), sh: r.scrollHeight, ch: r.clientHeight }; });
  const clip = [...pp.querySelectorAll("*")].filter((x) => { const r = x.getBoundingClientRect(), s = getComputedStyle(x); return r.width > 5 && x.scrollWidth > x.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX); }).length;
  const invisible = [...pp.querySelectorAll("*")].filter((x) => {
    const r = x.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false;
    const t = (x.textContent || "").trim(); if (!t) return false;
    const s = getComputedStyle(x);
    if (s.visibility === "hidden" || Number(s.opacity) < 0.05 || s.display === "none") return true;
    /* 文字自己不可见：深色文字 + 无投影 + 无底色 */
    const L = lum(s.color);
    return L !== null && L < 90 && s.textShadow === "none" && s.backgroundColor === "rgba(0, 0, 0, 0)";
  }).map((x) => ({ cls: String(x.className).slice(0, 30), txt: (x.textContent || "").trim().slice(0, 12), color: getComputedStyle(x).color }));
  /* 可见像素：横向必须在卡内（卡是可滚动容器，纵向允许落在折叠线以下/以上） */
  const inCard = labels.every((l) => { const r = l.getBoundingClientRect(); return r.x >= b.x - 1 && r.right <= b.right + 1; });
  const horizontalClip = labels.filter((l) => { const r = l.getBoundingClientRect(); return r.x < b.x - 1 || r.right > b.right + 1; }).map((l) => (l.textContent || "").trim().slice(0, 10));
  return {
    rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], phase: pp.dataset.lcPhase,
    labelCount: labels.length,
    labels: labels.map((l) => { const s = getComputedStyle(l); return { txt: (l.textContent || "").trim().slice(0, 10), color: s.color, lum: lum(s.color), shadow: s.textShadow.slice(0, 46) }; }),
    rows, clip, invisible, inCard, horizontalClip,
    scroll: [pp.scrollWidth, pp.clientWidth, pp.scrollHeight, pp.clientHeight],
  };
});
await shot(`${OUT}/gate-pp-open.png`).catch((e) => console.log("shot failed", String(e).slice(0, 80)));
await shot(`${OUT}/gate-pp-crop.png`, { x: ppOpen.rect[0] - 12, y: ppOpen.rect[1] - 12, width: ppOpen.rect[2] + 24, height: ppOpen.rect[3] + 24 }).catch(() => {});

rec("P1 “显示”展开：phase=open 且 300×430", ppOpen.phase === "open" && ppOpen.rect[2] === 300, ppOpen.rect);
rec("P1 开关行文字全部为浅色令牌（亮度≥200）且带投影", ppOpen.labelCount >= 8 && ppOpen.labels.every((l) => l.lum >= 200 && l.shadow !== "none"),
  { count: ppOpen.labelCount, labels: ppOpen.labels });
rec("P1 面板内无「深色字+无底+无投影」的不可见文字", ppOpen.invisible.length === 0, ppOpen.invisible);
rec("P1 无横向裁切（scrollWidth==clientWidth 且溢出元素 0）", ppOpen.scroll[0] === ppOpen.scroll[1] && ppOpen.clip === 0, { scroll: ppOpen.scroll, clip: ppOpen.clip });
rec("P1 文字横向全部落在卡内（无越界/无横向被裁）", ppOpen.inCard, ppOpen.horizontalClip);

/* ── 3 可滚：真实滚轮 ─────────────────────────────────────────────────── */
await page.mouse.move(ppOpen.rect[0] + ppOpen.rect[2] / 2, ppOpen.rect[1] + 200, { label: "hover panel body" });
await page.mouse.wheel(0, 380, { label: "wheel scroll pp" });
await page.waitForTimeout(600);
const scrolled = await page.evaluate(() => { const pp = document.getElementById("pp-toggles"); return { top: pp.scrollTop, sh: pp.scrollHeight, ch: pp.clientHeight }; });
await shot(`${OUT}/gate-pp-scrolled.png`, { x: ppOpen.rect[0] - 12, y: ppOpen.rect[1] - 12, width: ppOpen.rect[2] + 24, height: ppOpen.rect[3] + 24 }).catch(() => {});
rec("P1 展开面板可滚动（滚轮使 scrollTop>0）", scrolled.top > 100, scrolled);
await page.evaluate(() => { document.getElementById("pp-toggles").scrollTop = 0; });
await page.waitForTimeout(300);

/* ── 4 hover 镜面高光：真实鼠标移入 ──────────────────────────────────── */
const probeHover = (id) => page.evaluate((id) => {
  const el = document.getElementById(id), s = getComputedStyle(el), b = getComputedStyle(el, "::before");
  return { shadow: s.boxShadow, bg: s.backgroundColor, filter: s.filter, transform: s.transform, beforeBg: b.backgroundImage, beforeOp: b.opacity, hover: el.matches(":hover"), children: el.children.length };
}, id);

const hovId = "data-panel";
const hb = await page.evaluate((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }, hovId);
await page.mouse.move(5, 400, { label: "park mouse off cards" });
await page.waitForTimeout(500);
const before = await probeHover(hovId);
await shot(`${OUT}/hover-before.png`, { x: hb[0] - 30, y: hb[1] - 30, width: hb[2] + 60, height: hb[3] + 60 }).catch(() => {});
await page.mouse.move(Math.round(hb[0] + hb[2] / 2), Math.round(hb[1] + hb[3] / 2), { label: "hover card" });
await page.waitForTimeout(600);
const after = await probeHover(hovId);
await shot(`${OUT}/hover-after.png`, { x: hb[0] - 30, y: hb[1] - 30, width: hb[2] + 60, height: hb[3] + 60 }).catch(() => {});

rec("H1 hover 时 :hover 命中卡壳（真实鼠标）", after.hover === true && before.hover === false, { before: before.hover, after: after.hover });
rec("H1 hover 改变 box-shadow（单层：追加壳内辉光，不新增元素）",
  after.shadow !== before.shadow && after.children === before.children && /inset/.test(after.shadow) && !/inset 0px 0px 0px (0\.5|1|1\.5)px/.test(after.shadow),
  { before: before.shadow, after: after.shadow, children: [before.children, after.children] });
rec("H1 hover 提亮顶部高光条（::before 渐变变化，不闭合）",
  after.beforeBg !== before.beforeBg && !/inset/.test(after.beforeBg), { before: before.beforeBg, after: after.beforeBg });
rec("H1 hover 不引入 filter / backdrop-filter / 额外层", after.filter === "none" && after.bg === "rgba(0, 0, 0, 0)", after);

/* 移开后回落到基线材质 */
await page.mouse.move(5, 400, { label: "park mouse off cards" });
await page.waitForTimeout(600);
const reverted = await probeHover(hovId);
rec("H1 移开后 box-shadow 回到单层 token（无残留）", reverted.shadow === before.shadow, { reverted: reverted.shadow, baseline: before.shadow });

/* ── 5 FPS：同页交错对照（基线 vs hover 保持态），各 8s ───────────────── */
const sampleFps = async (ms) => page.evaluate(async (ms) => {
  const t0 = performance.now(); let n = 0; let worst = 0; let prev = t0;
  await new Promise((res) => {
    const tick = (t) => { n++; const d = t - prev; prev = t; if (d > worst) worst = d; if (t - t0 < ms) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  const dt = (performance.now() - t0) / 1000;
  return { fps: Math.round((n / dt) * 10) / 10, worstFrameMs: Math.round(worst * 10) / 10, frames: n };
}, ms);

await page.cdp("Page.bringToFront").catch(() => {});
await page.mouse.move(5, 400, { label: "park mouse off cards" });
await page.waitForTimeout(800);
const focus = await page.evaluate(() => ({ hasFocus: document.hasFocus(), vis: document.visibilityState, dpr: devicePixelRatio, w: innerWidth, h: innerHeight }));
const fpsBase = await sampleFps(5000);
await page.mouse.move(Math.round(hb[0] + hb[2] / 2), Math.round(hb[1] + hb[3] / 2), { label: "hover card" });
await page.waitForTimeout(400);
const fpsHover = await sampleFps(5000);
const fps = { base: fpsBase, hover: fpsHover, delta: Math.round((fpsHover.fps - fpsBase.fps) * 10) / 10 };
rec("F1 基线 8s 平均 FPS 50–60（最长帧 <100ms）", fpsBase.fps >= 50 && fpsBase.fps <= 61 && fpsBase.worstFrameMs < 100, fpsBase);
rec("F1 hover 保持态 FPS 相对基线掉 ≤2（hover 高光不吃帧）", fpsHover.fps - fpsBase.fps >= -2, { ...fps, focus });

/* ── 6 收尾截图（展开态 9 卡 + 全屏） ────────────────────────────────── */
await shot(`${OUT}/gate-final-full.png`).catch((e) => console.log("shot failed", String(e).slice(0, 80)));
const edge = await page.evaluate(() => (window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null));
const summary = { gpu: gpu.probe && gpu.probe.renderer, focusDenv: focus, edge: edge && { gain: edge.gain, dispPx: edge.dispPx, band: edge.band, count: edge.count, fps: edge.fps }, pass: R.filter((r) => r.ok).length, total: R.length };
await fs.writeFile(`${OUT}/gate.json`, JSON.stringify({ summary, results: R, ppOpen, hover: { before, after, reverted }, fps }, null, 2));
console.log("\n== " + summary.pass + "/" + summary.total + " PASS ==");
console.log(JSON.stringify(summary));
