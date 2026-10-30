/* Phase6A 诊断：pp 展开不可见 + hover 无变化 —— 真实浏览器实测取证 */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase6a";
await fs.mkdir(OUT, { recursive: true });

const task = await taskSpace("gev-phase6a-diag");
const page = task.page("p1");
try { await page.goto("http://127.0.0.1:4173/?welcome=0"); } catch {}
await page.waitForLoadState("load");
for (let i = 0; i < 120; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(4000);

const info = {};

info.gpu = await page.evaluate(() => ({
  probe: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null,
  chip: (document.getElementById("gev-gpu-chip") || {}).textContent || null,
  vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
}));

/* 1) 点开 pp（真实鼠标） */
const pt = await page.evaluate(() => {
  const el = document.getElementById("pp-toggles");
  const b = el.getBoundingClientRect();
  const cands = [];
  for (const fy of [0.5, 0.3, 0.7]) for (const fx of [0.5, 0.3, 0.7]) {
    const x = Math.round(b.x + b.width * fx), y = Math.round(b.y + b.height * fy);
    const hit = document.elementFromPoint(x, y);
    cands.push({ x, y, hit: hit ? { tag: hit.tagName, cls: String(hit.className).slice(0, 40), id: hit.id } : null });
  }
  return { rect: [b.x, b.y, b.width, b.height], cands };
});
info.ppBeforeClick = pt;
const target = pt.cands.find((c) => c.hit && !/canvas/i.test(c.hit.tag)) || pt.cands[0];
await page.mouse.click(target.x, target.y, { label: "open pp toggles" });
await page.waitForTimeout(2200);

info.ppOpen = await page.evaluate(() => {
  const el = document.getElementById("pp-toggles");
  const b = el.getBoundingClientRect();
  const chain = [];
  let n = el;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    chain.push({
      tag: n.tagName, id: n.id, cls: String(n.className).slice(0, 60),
      rect: (() => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      pos: s.position, z: s.zIndex, op: s.opacity, vis: s.visibility, disp: s.display,
      filter: s.filter, clip: s.clipPath, transform: s.transform, contain: s.contain,
      pe: s.pointerEvents, overflow: s.overflow, mixBlend: s.mixBlendMode, isolation: s.isolation,
    });
    n = n.parentElement;
  }
  /* 卡内文本节点：是否真的有内容、坐标是否在卡内 */
  const texts = [...el.querySelectorAll("*")].filter((x) => {
    const t = (x.textContent || "").trim();
    const r = x.getBoundingClientRect();
    return t && r.width > 4 && r.height > 4;
  }).slice(0, 14).map((x) => {
    const r = x.getBoundingClientRect(), s = getComputedStyle(x);
    return { tag: x.tagName, cls: String(x.className).slice(0, 34), txt: (x.textContent || "").trim().slice(0, 18),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      color: s.color, op: s.opacity, vis: s.visibility, fs: s.fontSize };
  });
  /* 卡片正中央命中了什么（谁盖住它） */
  const hits = [];
  for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.15], [0.5, 0.85], [0.1, 0.5], [0.9, 0.5]]) {
    const x = Math.round(b.x + b.width * fx), y = Math.round(b.y + b.height * fy);
    const stack = document.elementsFromPoint(x, y).slice(0, 5).map((e) => ({ tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 34), z: getComputedStyle(e).zIndex }));
    hits.push({ at: [x, y], stack });
  }
  const cs = getComputedStyle(el);
  const before = getComputedStyle(el, "::before"), after = getComputedStyle(el, "::after");
  return {
    rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    phase: el.dataset.lcPhase, classes: String(el.className),
    bg: cs.backgroundColor, bgImg: cs.backgroundImage, shadow: cs.boxShadow, op: cs.opacity, vis: cs.visibility,
    before: { content: before.content, bg: before.backgroundImage, h: before.height, op: before.opacity },
    after: { content: after.content, bg: after.backgroundImage, h: after.height, op: after.opacity },
    scroll: [el.scrollWidth, el.clientWidth, el.scrollHeight, el.clientHeight],
    chain, texts, hits,
  };
});
await page.screenshot({ path: `${OUT}/diag-pp-open.png` });
try {
  await page.screenshot({ path: `${OUT}/diag-pp-crop.png`, clip: { x: info.ppOpen.rect[0] - 20, y: info.ppOpen.rect[1] - 20, width: info.ppOpen.rect[2] + 40, height: info.ppOpen.rect[3] + 40 } });
} catch (e) { console.log("clip screenshot failed", String(e)); }

/* 2) hover 对比：真实鼠标移到卡上，前后 computed style */
const hoverId = "location-bar";
const hb = await page.evaluate((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }, hoverId);
await page.mouse.move(10, 400, { label: "park mouse" });
await page.waitForTimeout(400);
const probe = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const s = getComputedStyle(el), b = getComputedStyle(el, "::before"), a = getComputedStyle(el, "::after");
  return {
    shadow: s.boxShadow, bg: s.backgroundColor, bgImg: s.backgroundImage, filter: s.filter, transform: s.transform,
    before: { content: b.content, bg: b.backgroundImage, op: b.opacity, h: b.height, shadow: b.boxShadow, inset: b.inset },
    after: { content: a.content, bg: a.backgroundImage, op: a.opacity, h: a.height, shadow: a.boxShadow, inset: a.inset },
    matchesHover: el.matches(":hover"),
  };
}, id);
info.hoverBefore = await probe(hoverId);
await page.mouse.move(Math.round(hb[0] + hb[2] / 2), Math.round(hb[1] + hb[3] / 2), { label: "hover card" });
await page.waitForTimeout(600);
info.hoverAfter = await probe(hoverId);
await page.screenshot({ path: `${OUT}/diag-hover.png` });

/* 3) 现有 CSS 里到底有哪些 :hover 规则命中卡壳 */
info.hoverRules = await page.evaluate(() => {
  const out = [];
  for (const sh of document.styleSheets) {
    let rules;
    try { rules = sh.cssRules; } catch { continue; }
    const walk = (rs, base) => {
      for (const r of rs || []) {
        if (r.cssRules) { walk(r.cssRules, base); continue; }
        const sel = r.selectorText || "";
        if (!sel.includes(":hover")) continue;
        if (!/lc|panel|pp-|gev-lc|dock|location|voice|data-|scene/.test(sel)) continue;
        out.push({ href: (sh.href || "inline").split("/").pop(), sel: sel.slice(0, 160), css: (r.style && r.style.cssText || "").slice(0, 200) });
      }
    };
    walk(rules);
  }
  return out.slice(0, 60);
});

info.edge = await page.evaluate(() => (window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null));

await fs.writeFile(`${OUT}/diag.json`, JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 1).slice(0, 16000));
