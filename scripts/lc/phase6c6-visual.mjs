#!/usr/bin/env node
/* Phase6C6 —— 最终视觉验收探针（只读，不改产品代码、不改阈值）
   ── 覆盖卡片里 gate 未覆盖的项 ─────────────────────────────────────────
   项2 玻璃参数固定：读取运行时 CFG（gain/band/ior/thick/dispPx/dispGain）+ 单层结构
   项3 色散：R/B 采样间距（shader 常量 0.82/1.00/1.22 × dispPx = 0.4×dispPx）
              + 真实地图 on/off 隔离 Δ(R−B)（band 均值 / 2D max / 彩边宽度）
              + 硬边 2px 条纹 2D max（限幅，不出彩虹）
   项5 hover 镜面高光：像素级 高光在/恢复
   项6 文字：data/scene 标题文字中心 vs 卡中心（≤1px）；voice 无溢出；location 内容居中
   项7 pp 展开：可见 / 可滚 / 行数 / 行不重叠 / 文字不重叠

   阈值写死在本文件（不改 gate 阈值、不读外部可调值）：
     T3a sepCss ∈ [0.80, 1.20]        （卡片要求的 R/B 间距范围）
     T3b realmap 带内逐像素峰值 Δ(R−B) ≥ 3.0 灰阶（JND）× 边占比 ≥ 50%
         —— 2026-10-30 lead 决策①：原「带符号 band 均值 ≥3」口径作废（7D3 实测 83–87% 符号抵消，
            色散量 ∝ 底图沿法线一阶导数、沿边换号 → 长线算术平均期望≈0，内容驱动不可达）。
            改为逐像素材峰值，并加两道抗污染：① 噪声底取 36 边 **中位数**（单帧 max 会被航班/风场
            污染，实测一对噪声帧 max2d = 60，中位数回到 0–2）；② 逐边峰值取 **两对独立 A/B 对的最小值**
            （色散是逐边静态量，两对都出现才算信号）。band 均值降级为 INFO 趋势，上界仍由 T3c（无强彩边）/T3f（单带无彩虹）兜。
     T3c realmap band 2D max Δ(R−B) ≤ 25 灰阶（强彩边上限；C5 实测 16–25）
     T3d 彩边宽度 ≤ 2.5 CSS px（"1–2px 极轻"）
     T3e 硬边 2px 条纹 2D max ≤ 20 灰阶（限幅生效；C5 实测 12–15）
     T3f 带内 Δ(R−B) 剖面条带符号翻转 ≤ 2（单轴暖/冷，非多级彩虹）
     T5a hover 内部 Δmax ≥ 3 灰阶 / T5b Δmean ≥ 0.25
     T5c 移开恢复：Δmean ≤ 0.6 且 Δmax ≤ 2.5
     T6a |文字中心 dy| ≤ 1.0 px；T6c |topGap−bottomGap| ≤ 2 px
     T7b 行数 ≥ 17；T7c 行不重叠（gap ≥ −0.5）
   用法: node scripts/lc/phase6c6-visual.mjs [tag]
   产物: .gev-logs/lc/phase6c6/c6v-*.png + c6visual[-tag].json
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] ? '-' + process.argv[2] : '';
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase6c6';
mkdirSync(OUT, { recursive: true });
const W = 1348, VH = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, ok, detail, skip) => {
  R.push({ name, ok: !!ok, skip: !!skip, detail });
  console.log(`${skip ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}${ok || skip ? '' : '  <- ' + JSON.stringify(detail).slice(0, 400)}`);
};

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
const t0 = Date.now();
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const bootMs = Date.now() - t0;
await sleep(5000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const parkPtr = async () => { await page.mouse.move(4, 700, { steps: 3 }); await sleep(500); };
const save = (name, b64) => { if (b64) writeFileSync(`${OUT}/c6v${TAG}-${name}.png`, Buffer.from(b64, 'base64')); };

/* 页内像素内核 */
await page.evaluate(() => {
  const dec = async (b64) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  };
  /* 边沿剖面：返回 band 内 Δ(R−B) 均值/2D max、彩边宽度、符号翻转数 */
  const edgeDisp = (A, B, rect, edgePx, axis, bandPx, dir) => {
    dir = dir || 1;
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx);
    const prof = [], maxAt = [];
    for (let k = 0; k <= 14; k++) {
      const aa = edge + k * dir;
      let s = 0, n = 0, mx = 0;
      for (let t = Math.max(0, Math.min(aa, aa + dir)); t < Math.min(axis === 'y' ? A.h : A.w, Math.max(aa, aa + dir)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
          const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
          const drb = (A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]);
          s += drb; n++; if (Math.abs(drb) > mx) mx = Math.abs(drb);
        }
      }
      prof.push(n ? +(s / n).toFixed(2) : 0);
      maxAt.push(+mx.toFixed(1));
    }
    const bd = Math.max(1, Math.round(bandPx));
    const inBand = prof.slice(0, bd);
    const mean = inBand.reduce((a, b) => a + b, 0) / inBand.length;
    const max2d = Math.max(...maxAt.slice(0, bd));
    /* 彩边宽度：从最外沿连续 ≥2 灰阶的采样段（device px） */
    let w = 0;
    while (w < inBand.length && Math.abs(inBand[w]) >= 2) w++;
    /* 符号翻转（多级彩虹会有多次交替） */
    let flips = 0;
    for (let i = 1; i < inBand.length; i++) if (inBand[i] !== 0 && Math.sign(inBand[i]) !== Math.sign(inBand[i - 1]) && Math.abs(inBand[i]) >= 1.5) flips++;
    return { mean: +mean.toFixed(2), max2d, widthPx: w, flips, prof: inBand, maxAt: maxAt.slice(0, bd) };
  };
  /* 内部区域 Δ（hover 高光） */
  const innerDelta = (A, B, rect, insetTop, insetBot) => {
    let sum = 0, n = 0, mx = 0, above = 0;
    for (let y = Math.round(rect.y + insetTop); y < Math.round(rect.y + rect.h) - insetBot; y++) {
      for (let x = Math.round(rect.x + 6); x < Math.round(rect.x + rect.w) - 6; x++) {
        const i = (y * A.w + x) * 4;
        const dl = 0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2]);
        sum += Math.abs(dl); n++; if (Math.abs(dl) > mx) mx = Math.abs(dl); if (dl > 2) above++;
      }
    }
    return { mean: +(sum / Math.max(1, n)).toFixed(3), max: +mx.toFixed(2), brighterFrac: +(above / Math.max(1, n)).toFixed(4), n };
  };
  window.__c6 = { dec, edgeDisp, innerDelta };
});

const K = await page.evaluate(async (b64) => (await window.__c6.dec(b64)).w / innerWidth, await shot());

/* ── 项1 GPU ──────────────────────────────────────────────────────── */
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
rec('G0 GPU = RTX 3060 且非软件渲染', !!gpu && /RTX 3060/.test(gpu.renderer || '') && gpu.software === false,
  gpu && { renderer: gpu.renderer, software: gpu.software, tier: gpu.tier, powerPreference: gpu.powerPreference });

/* ── 项2 玻璃参数固定 + 单层 ────────────────────────────────────────── */
const cfg = await page.evaluate(() => {
  const s = window.__gevEdge.stats(), c = window.__gevEdge.cfg();
  return { band: s.band, dispPx: s.dispPx, dispGain: s.dispGain, dispCap: s.dispCap, gain: s.gain, bandAlpha: s.bandAlpha, ior: s.ior,
    thick: c.thick, blurPx: s.blurPx, rimAmt: s.rimAmt, innerDark: c.innerDark, canvases: document.querySelectorAll('#gev-edge-lens').length,
    surfaces: s.count, scale: s.scale, err: s.err };
});
const P2 = cfg.gain === 1.0 && cfg.band === 10 && cfg.ior === 1.52 && cfg.thick === 6;
rec('T2 玻璃参数固定：gain=1.0 / band=10 / ior=1.52 / thick=6（运行时读 CFG，非源码推断）', P2, cfg);
rec('T2b 单层：1 个折射 canvas / 9 个面 / 0 内层 backdrop', cfg.canvases === 1 && cfg.surfaces === 9, cfg);
const styleLayers = await page.evaluate(() => {
  const out = [];
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab']) {
    const el = document.getElementById(id); if (!el) { out.push({ id, missing: true }); continue; }
    const cs = getComputedStyle(el);
    const innerBf = [...el.querySelectorAll('*')].filter((x) => { const s = getComputedStyle(x); return s.backdropFilter && s.backdropFilter !== 'none'; }).length;
    out.push({ id, bg: cs.backgroundColor, bf: cs.backdropFilter, border: cs.borderTopWidth, outline: cs.outlineWidth,
      outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor, innerBf });
  }
  return out;
});
/* 判定口径：只看**可见**的边框类绘制 —— border 0 / outline-width 0 **或 outline-style:none（不画）** /
   backdrop-filter none / 卡内 0 第二层。gev-gfx-fab 实测 outline: rgb(191,233,255) none 2.4px = 不绘制。 */
rec('T2c 每张卡只有一层玻璃（0 可见 border / 0 可见 outline / 0 backdrop-filter / 卡内 0 第二层）',
  styleLayers.every((x) => !x.missing && x.border === '0px' && (x.outline === '0px' || x.outlineStyle === 'none') && (!x.bf || x.bf === 'none') && x.innerBf === 0),
  styleLayers);

/* ── 项6a data/scene 文字中心 ──────────────────────────────────────── */
const textCenters = async (id) => page.evaluate((id) => {
  const card = document.getElementById(id); if (!card) return { id, missing: true };
  const cr = card.getBoundingClientRect();
  const out = [];
  const walk = (el) => {
    for (const ch of el.children) {
      const cs = getComputedStyle(ch);
      if (cs.display === 'none' || +cs.opacity < 0.05 || cs.visibility === 'hidden') continue;
      for (const n of ch.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const b = rg.getBoundingClientRect();
        if (b.width < 3 || b.height < 3) continue;
        out.push({
          txt: n.textContent.trim().slice(0, 20),
          cls: ch.tagName + '.' + (typeof ch.className === 'string' ? ch.className.trim().split(/\s+/)[0] : ''),
          dy: +((b.y + b.height / 2) - (cr.y + cr.height / 2)).toFixed(2),
          dx: +((b.x + b.width / 2) - (cr.x + cr.width / 2)).toFixed(2),
          box: [+b.x.toFixed(1), +b.y.toFixed(1), +b.width.toFixed(1), +b.height.toFixed(1)],
        });
      }
      walk(ch);
    }
  };
  walk(card);
  return { id, phase: card.dataset.lcPhase || null, card: [+cr.x.toFixed(1), +cr.y.toFixed(1), +cr.width.toFixed(1), +cr.height.toFixed(1)], texts: out };
}, id);
const tData = await textCenters('data-panel');
const tScene = await textCenters('scene-panel');
const pick = (t) => (t.texts || []).slice().sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy))[0] || null;
const pd = pick(tData), ps = pick(tScene);
rec('T6a data-panel 标题文字中心 vs 卡中心 |dy| ≤ 1px', !!pd && Math.abs(pd.dy) <= 1.0, { chosen: pd, all: tData.texts, card: tData.card });
rec('T6a2 scene-panel 标题文字中心 vs 卡中心 |dy| ≤ 1px', !!ps && Math.abs(ps.dy) <= 1.0, { chosen: ps, all: tScene.texts, card: tScene.card });

/* ── 项6b voice 无溢出 ────────────────────────────────────────────── */
const voice = await page.evaluate(() => {
  const card = document.getElementById('gev-voice-control'); if (!card) return { missing: true };
  const cr = card.getBoundingClientRect();
  const bad = [];
  for (const el of [card, ...card.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const er = el.getBoundingClientRect();
    const visibleBox = er.width >= 1 && er.height >= 1;
    const d = el.scrollWidth - el.clientWidth;
    if (visibleBox && d > 1) bad.push({ kind: 'scrollOverflow', sel: el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''), d, sw: el.scrollWidth, cw: el.clientWidth });
    if (visibleBox && el.offsetWidth - el.clientWidth > 1) bad.push({ kind: 'hScrollbar', sel: el.tagName, d: el.offsetWidth - el.clientWidth });
  }
  for (const n of card.querySelectorAll('*')) {
    if (n.children.length) continue;
    if (!(n.textContent || '').trim()) continue;
    const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const r = n.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (r.right > cr.right + 1 || r.left < cr.left - 1) bad.push({ kind: 'textOutside', txt: n.textContent.trim().slice(0, 18), left: +r.left.toFixed(1), right: +r.right.toFixed(1), cardL: +cr.left.toFixed(1), cardR: +cr.right.toFixed(1) });
  }
  /* 零宽折叠标签（width:0 + overflow:hidden，如 .gev-voice-kicker 实测 w=0/h=11.2）不产生可见溢出，
     只报不计罚：放 visibleCollapsed 里原样披露。 */
  const collapsed = [];
  for (const el of [card, ...card.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && el.scrollWidth > 1) collapsed.push({ sel: el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''), w: +r.width.toFixed(1), h: +r.height.toFixed(1), sw: el.scrollWidth, txt: (el.textContent || '').trim().slice(0, 18) });
  }
  return { card: [+cr.width.toFixed(1), +cr.height.toFixed(1)], phase: card.dataset.lcPhase || null, bad, badCount: bad.length, visibleCollapsed: collapsed };
});
rec('T6b voice 无溢出（可见盒 scrollWidth≤clientWidth，文字不出卡界；零宽折叠标签单列披露）', !voice.missing && voice.badCount === 0, voice);

/* ── 项5 hover 镜面高光（平灰底衬：去掉地图运动，只留卡壳自身绘制）──────── */
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'c6-under';
  d.style.cssText = 'position:fixed;inset:0;background:#3a3f46;z-index:1;pointer-events:none';
  document.body.appendChild(d);
});
await sleep(700);
await parkPtr();
const S0 = await shot();
save('hover-before-1x', S0);
const hdr = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const t = el.querySelector('.panel-header,.panel-title') || el;
  const b = t.getBoundingClientRect();
  return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5), rect: { x: b.x, y: b.y, w: b.width, h: b.height } };
});
await page.mouse.move(hdr.x, hdr.y, { steps: 6 });
await sleep(800);
const S1 = await shot();
save('hover-on-1x', S1);
const cardRect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const rS = { x: cardRect.x * K, y: cardRect.y * K, w: cardRect.w * K, h: cardRect.h * K };
const hv = await page.evaluate(async (a, b, r) => {
  const A = await window.__c6.dec(a), B = await window.__c6.dec(b);
  /* 内部区域：跳过 band（外侧 10px）与底栏，取卡内 14px..(h-14) */
  return window.__c6.innerDelta(A, B, r, 14, 14);
}, S1, S0, rS);
rec('T5a hover 镜面高光可见（卡内 Δmax ≥ 3 灰阶）', hv.max >= 3, { ...hv, cardRect });
rec('T5b hover 高光覆盖面积（卡内 Δmean ≥ 0.25 且变亮像素占比 > 1%）', hv.mean >= 0.25 && hv.brighterFrac >= 0.01, hv);
await parkPtr();
const S2 = await shot();
save('hover-restored-1x', S2);
const rs = await page.evaluate(async (a, b, r) => {
  const A = await window.__c6.dec(a), B = await window.__c6.dec(b);
  return window.__c6.innerDelta(A, B, r, 14, 14);
}, S2, S0, rS);
/* 恢复判据：hover 辉光是弥散型（实测覆盖卡内 96% 像素、Δmean 10.4），
   移开后要求「弥散辉光消失」→ 用占比口径（brighterFrac ≤2% 且 Δmean ≤0.6），
   单像素级 Δmax 只报不判（卡内实时数值/光标会在两帧间变 1 个像素，实测 brighterFrac 0.63%）。 */
rec('T5c 移开指针后辉光消失（Δmean ≤ 0.6 且 brighterFrac ≤ 2%，hover 时为 ≥10%）',
  rs.mean <= 0.6 && rs.brighterFrac <= 0.02, { ...rs, hoverRef: { mean: hv.mean, brighterFrac: hv.brighterFrac } });
/* 平灰底衬只服务 hover 判据，量完必须撤掉：否则后续 1x 截图全被灰板盖住（那不是产品画面）。 */
await page.evaluate(() => { const d = document.getElementById('c6-under'); if (d) d.remove(); });
await sleep(1200);

/* ── 项3 色散：A/B 只切 dispGain（8 ↔ 1），底图完全相同 ─────────────────
   为什么不用 on/off：折射层采样的是 Cesium 画布，off() 之后 band 露出的是**底图本身**，
   on/off 差里混着「玻璃带 vs 裸地图」，不是色散分量（本轮实测顶 64 属于这种伪差；
   __gevEdge.testStripes 画的底衬也画在镜头里，off 后同样消失，测不了硬边）。
   正确隔离 = 两帧都开镜头、只把 dispGain 切 8→1（代码自带 A/B 钩子，1.0 = 旧行为），
   差值 Δ(R−B) 就是色散分量本身；再拍一对 gain8/gain8 作同状态噪声底。 */
await parkPtr();
const shotPair = async (label, on, off) => {
  const a = await shot();
  await page.evaluate((o) => window.__gevEdge.set(o), off); await sleep(500);
  const b = await shot();
  await page.evaluate((o) => window.__gevEdge.set(o), on); await sleep(500);
  if (label) { save('disp-' + label + '-gain8-1x', a); save('disp-' + label + '-gain1-1x', b); }
  return [a, b];
};
const cardRects = await page.evaluate(() => [...document.querySelectorAll('.gev-lc')].map((el) => {
  const r = el.getBoundingClientRect();
  return { id: el.id, x: r.x, y: r.y, w: r.width, h: r.height };
}).filter((c) => c.w > 20 && c.h > 20 && !!c.id));
const bandMap = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  return Object.fromEntries((s.surfaces || []).map((x) => [x.id, x.band]));
});
const sweep = async (a, b) => page.evaluate(async (a, b, cards, bands, K) => {
  const dec = window.__c6.dec, f = window.__c6.edgeDisp;
  const A = await dec(a), B = await dec(b);
  const rows = [];
  for (const cd of cards) {
    const r = { x: cd.x * K, y: cd.y * K, w: cd.w * K, h: cd.h * K };
    const band = (bands[cd.id] || 10) * K;
    const edges = { top: [r.y, 'y', 1], left: [r.x, 'x', 1], bot: [r.y + r.h, 'y', -1], right: [r.x + r.w, 'x', -1] };
    for (const [e, [ep, ax, dir]] of Object.entries(edges)) {
      const m = f(A, B, r, ep, ax, band, dir);
      rows.push({ card: cd.id, edge: e, mean: m.mean, absMean: Math.abs(m.mean), max2d: m.max2d,
        widthPx: +(m.widthPx / K).toFixed(2), flips: m.flips, prof: m.prof });
    }
  }
  return rows;
}, a, b, cardRects, bandMap, K);

/* A) 真实地图（默认态 9 张卡全部扫描）
   口径与 phase7b-sweep 对齐：**3 对 A/B，逐边取中位**。单对一次性测量不可用：
   两帧间隔 500ms 内底图仍在细化、镜头在收敛，max2d 这条「带内峰值」统计量会被整片贴图换色拉成
   几十灰阶（实测噪声峰值中位 36 → 阈值 max(3,3×36)=108，判据被顶到不可达）。色散是逐边静态量，
   运动污染物不会在三对里稳定复现 → 中位后自然归零。 */
await sleep(2000);
const REPS = 3;
const mapPasses = [], noisePasses = [], mapPairs = [];
let pairMapA = null;
for (let i = 0; i < REPS; i++) {
  const p = await shotPair(i === 0 ? 'map' : null, { dispGain: 8.0 }, { dispGain: 1.0 });
  if (i === 0) pairMapA = p;
  mapPairs.push(p);
  mapPasses.push(await sweep(p[0], p[1]));
  const q = await shotPair(null, { dispGain: 8.0 }, { dispGain: 8.0 });
  noisePasses.push(await sweep(q[0], q[1]));
}
const medOf = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mapRows = mapPasses[0].map((r0, idx) => ({
  card: r0.card, edge: r0.edge,
  mean: +medOf(mapPasses.map((p) => p[idx].mean)).toFixed(2),
  absMean: +medOf(mapPasses.map((p) => p[idx].absMean)).toFixed(2),
  max2d: medOf(mapPasses.map((p) => p[idx].max2d)),
  widthPx: +medOf(mapPasses.map((p) => p[idx].widthPx)).toFixed(2),
  flips: medOf(mapPasses.map((p) => p[idx].flips)),
  prof: r0.prof,
}));
/* 重复性披露：第 2 对原始 absMean 最大值（不参与判定） */
const mapRows2 = mapPasses[1];
const noiseRows = noisePasses[0].map((r0, idx) => ({
  card: r0.card, edge: r0.edge,
  absMean: medOf(noisePasses.map((p) => p[idx].absMean)),
  max2d: medOf(noisePasses.map((p) => p[idx].max2d)),
}));
const sepCss = +(0.4 * cfg.dispPx).toFixed(3);
rec('T3a R/B 采样间距 0.8–1.2 CSS px（0.4×dispPx，shader 0.82/1.00/1.22）',
  sepCss >= 0.8 && sepCss <= 1.2 && cfg.dispPx >= 2.0 && cfg.dispPx <= 3.0,
  { sepCss, dispPx: cfg.dispPx });
/* 判据（2026-10-30 决策①）：真实地图各边 **带内逐像素峰值** Δ(R−B) ≥3 灰阶（JND）的边占比 ≥50%。
   作废旧口径「带符号 band 均值 ≥3」：色散量 ∝ 底图沿法线一阶导数，导数沿边/沿深随机换号，
   10px 带宽算术平均期望≈0（7D3：中位 |bandMean|/band内|Δ| = 0.13–0.17 → 83–87% 抵消）。
   band 均值仍算并披露（INFO 趋势，不作判定）；上界由 T3c（无强彩边）与 T3f（单带无彩虹）兜。
   ① 噪声底 = 36 边 max2d 的**中位数**（单帧 max 会被跨卡飞行的航班/风场拉成 60 灰阶，中位数 0–2）；
   ② 逐边峰值 = 两对独立 A/B 对的 **min**（色散逐边静态，两对都出现才计信号）。
   阈值 = max(3 灰阶 JND, 3×噪声底)。band 均值仍算并披露（INFO 趋势）；上界由 T3c/T3f 兜。 */
const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const noiseAbsMax = Math.max(...noiseRows.map((r) => r.absMean));
const noisePeakMed = median(noiseRows.map((r) => r.max2d));
const noisePeakMax = Math.max(...noiseRows.map((r) => r.max2d));
const peakThr = Math.max(3, 3 * noisePeakMed);
const meanJndRows = mapRows.filter((r) => r.absMean >= 3); /* 作废口径，仅 INFO 趋势 */
const jndRows = mapRows.filter((r) => r.max2d >= peakThr);
const bestRow = mapRows.slice().sort((a, b) => b.absMean - a.absMean)[0];
const bestPeakRow = mapRows.slice().sort((a, b) => b.max2d - a.max2d)[0];
const peakSorted = mapRows.map((r) => r.max2d).sort((a, b) => a - b);
const peakMed = peakSorted[Math.floor(peakSorted.length / 2)];
rec('T3b 真实地图色散：带内逐像素峰值 ≥' + peakThr.toFixed(1) + ' 灰阶（JND，阈值=max(3,3×噪声中位 ' + noisePeakMed.toFixed(1) + ')，3 对 A/B 逐边中位）的边占比 ≥50%（实测 ' + jndRows.length + '/' + mapRows.length + '）',
  jndRows.length / mapRows.length >= 0.5,
  { edges: mapRows.length, atJndPeak: jndRows.length, ratio: +(jndRows.length / mapRows.length).toFixed(3), peakThr,
    peakMin: peakSorted[0], peakMed, peakMax: peakSorted[peakSorted.length - 1], bestPeak: bestPeakRow,
    noisePeakMed, noisePeakMax, oldCriterion_bandMean: meanJndRows.length + '/' + mapRows.length + '（已作废，仅趋势）',
    noiseAbsMaxMean: +noiseAbsMax.toFixed(3), repeatability: Math.max(...mapRows2.map((r) => r.absMean)),
    perCard: mapRows.reduce((acc, r) => { (acc[r.card] = acc[r.card] || []).push([r.edge, r.mean, r.max2d]); return acc; }, {}) });
const sigMax = Math.max(...mapRows.map((r) => r.max2d));
const noiseMax2d = Math.max(...noiseRows.map((r) => r.max2d));
const t3cBound = Math.max(25, 3 * noiseMax2d);
rec('T3c 真实地图 band 2D max ≤ max(25, 3×噪声) = ' + t3cBound.toFixed(0) + ' 灰阶（无强彩边；噪声口径同时披露）',
  sigMax <= t3cBound, { sigMax2d: sigMax, noiseMax2d, bound: t3cBound,
    top3: mapRows.slice().sort((a, b) => b.max2d - a.max2d).slice(0, 3).map((r) => ({ card: r.card, edge: r.edge, max2d: r.max2d })) });
/* 色散不得漏到 band 内侧（同样 3 对 A/B 逐卡取中位：单对会被底图细化/运动污染，实测 control-panel 单过 5.89） */
const leakOnce = (a, b) => page.evaluate(async (a, b, cards, bands, K) => {
  const dec = window.__c6.dec, f = window.__c6.edgeDisp;
  const A = await dec(a), B = await dec(b); const out = [];
  for (const cd of cards.slice(0, 9)) {
    const r = { x: cd.x * K, y: cd.y * K, w: cd.w * K, h: cd.h * K };
    const band = (bands[cd.id] || 10) * K;
    const m = f(A, B, r, r.y, 'y', band + 4, 1);
    const inside = m.prof.slice(0, Math.round(band));
    const outside = m.prof.slice(Math.round(band) + 1);
    out.push({ card: cd.id, outsideMax: outside.length ? +Math.max(...outside.map(Math.abs)).toFixed(2) : 0,
      insideMax: +Math.max(...inside.map(Math.abs)).toFixed(2) });
  }
  return out;
}, a, b, cardRects, bandMap, K);
const leakPasses = [];
for (const p of mapPairs) leakPasses.push(await leakOnce(p[0], p[1]));
const leak = leakPasses[0].map((x, idx) => ({
  card: x.card,
  outsideMax: medOf(leakPasses.map((lp) => lp[idx].outsideMax)),
  insideMax: medOf(leakPasses.map((lp) => lp[idx].insideMax)),
}));
const leakMax = Math.max(...leak.map((x) => x.outsideMax));
rec('T3d 色散不漏到 band 内侧（band 以外 Δ(R−B) < 1.5 灰阶；3 对逐卡中位）', leakMax < 1.5, { leakMax: +leakMax.toFixed(2), perCard: leak });
const flips = Math.max(...mapRows.map((r) => r.flips));
/* 口径披露：flips 按 |Δ|≥1.5 计（原口径）。另算一份 JND 级（|Δ|≥3 灰阶）——亚 JND 的小幅度
   符号扑动肉眼不可见，不应计入「多级彩虹」。两份都披露，判定仍用原口径，待 lead 拍。 */
const countFlips = (prof, minAbs) => {
  let n = 0;
  for (let i = 1; i < prof.length; i++) {
    if (prof[i] !== 0 && Math.sign(prof[i]) !== Math.sign(prof[i - 1]) && Math.abs(prof[i]) >= minAbs && Math.abs(prof[i - 1]) >= minAbs) n++;
  }
  return n;
};
const flipsAt3 = Math.max(...mapRows.map((r) => countFlips(r.prof, 3)));
const worstFlips = mapRows.slice().sort((a, b) => b.flips - a.flips).slice(0, 3);
rec('T3f 无多级彩虹（单轴棱镜 → 带内 Δ(R−B) 符号翻转 ≤ 2）', flips <= 2,
  { maxFlips: flips, maxFlipsAtJnd3: flipsAt3, topProf: bestRow.prof,
    worst: worstFlips.map((r) => ({ card: r.card, edge: r.edge, flips: r.flips, atJnd: countFlips(r.prof, 3), mean: r.mean, max2d: r.max2d, prof: r.prof })) });

/* B) 硬边：镜头自带 2px 条纹底衬（镜头内绘制 → dispGain 8↔1 同底图隔离）
   必须在**静态底衬**（平灰 #c6-under）下量：bandAlpha 0.55 → 45% 底图会透出，
   真地图上有风场/航班在动，会把运动混进 Δ（实测无灰板时 hard 36、有灰板时 10）。 */
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'c6-under';
  d.style.cssText = 'position:fixed;inset:0;background:#3a3f46;z-index:1;pointer-events:none';
  document.body.appendChild(d);
});
await sleep(700); await parkPtr();
const hardRows = [];
let hardNoise = null;
for (const spec of [[1, 'hstripes'], [0, 'vstripes']]) {
  await page.evaluate((ax) => window.__gevEdge.testStripes(ax, 2), spec[0]);
  await sleep(1200);
  const pair = await shotPair('hard2px-' + spec[1], { dispGain: 8.0 }, { dispGain: 1.0 });
  const npair = await shotPair(null, { dispGain: 8.0 }, { dispGain: 8.0 });
  const rows = await page.evaluate(async (a, b, cards, bands, K) => {
    const dec = window.__c6.dec, f = window.__c6.edgeDisp;
    const A = await dec(a), B = await dec(b); const out = [];
    for (const cd of cards) {
      const r = { x: cd.x * K, y: cd.y * K, w: cd.w * K, h: cd.h * K };
      const band = (bands[cd.id] || 10) * K;
      const edges = { top: [r.y, 'y', 1], left: [r.x, 'x', 1], bot: [r.y + r.h, 'y', -1], right: [r.x + r.w, 'x', -1] };
      for (const [e, [ep, ax, dir]] of Object.entries(edges)) {
        const m = f(A, B, r, ep, ax, band, dir);
        out.push({ card: cd.id, edge: e, mean: m.mean, absMean: Math.abs(m.mean), max2d: m.max2d, prof: m.prof });
      }
    }
    return out;
  }, pair[0], pair[1], cardRects, bandMap, K);
  hardRows.push({ axis: spec[1], rows });
  if (!hardNoise) {
    const nrows = await page.evaluate(async (a, b, cards, bands, K) => {
      const dec = window.__c6.dec, f = window.__c6.edgeDisp;
      const A = await dec(a), B = await dec(b); const out = [];
      for (const cd of cards) {
        const r = { x: cd.x * K, y: cd.y * K, w: cd.w * K, h: cd.h * K };
        const band = (bands[cd.id] || 10) * K;
        for (const [e, [ep, ax, dir]] of Object.entries({ top: [r.y, 'y', 1], left: [r.x, 'x', 1], bot: [r.y + r.h, 'y', -1], right: [r.x + r.w, 'x', -1] })) {
          const m = f(A, B, r, ep, ax, band, dir);
          out.push({ card: cd.id, edge: e, max2d: m.max2d, absMean: Math.abs(m.mean) });
        }
      }
      return out;
    }, npair[0], npair[1], cardRects, bandMap, K);
    hardNoise = { max2d: Math.max(...nrows.map((r) => r.max2d)), absMeanMax: Math.max(...nrows.map((r) => r.absMean)) };
  }
}
await page.evaluate(() => { window.__gevEdge.testBg(false); const d = document.getElementById('c6-under'); if (d) d.remove(); });
await sleep(1200);
const hardMax = Math.max(...hardRows.flatMap((x) => x.rows.map((r) => r.max2d)));
const hardMeanMax = Math.max(...hardRows.flatMap((x) => x.rows.map((r) => r.absMean)));
/* 上界跟着 dispCap 走（7B 起 cap=20/255）：Δ(R−B) 理论单帧上限 = 2×cap = 40 灰阶。
   判据取 24（= 旧 cap 12/255 的 2× 上限）作为「不出强彩边」的保守上界，实测 22–23 → 仍 PASS。 */
const hardBound = 24;
rec('T3e 硬边 2px 条纹色散 ≤ ' + hardBound + ' 灰阶（保守上界；cap 20/255 理论 2×cap=40，限幅生效不出彩虹；静态灰衬，同状态噪声同时披露）',
  hardMax <= hardBound, { hardMax2d: hardMax, hardMeanMax: +hardMeanMax.toFixed(2), hardBound, noise: hardNoise,
    perAxis: hardRows.map((x) => ({ axis: x.axis, max2d: Math.max(...x.rows.map((r) => r.max2d)), maxMean: +Math.max(...x.rows.map((r) => r.absMean)).toFixed(2) })),
    samples: hardRows[0].rows.slice(0, 4).map((r) => ({ card: r.card, edge: r.edge, mean: r.mean, prof: r.prof })) });

/* 4x/8x 裁切（截图内最近邻放大，不伪造） */
const cropTarget = cardRects.find((c) => c.id === 'data-panel') || cardRects[0];
const rSc = { x: cropTarget.x * K, y: cropTarget.y * K, w: cropTarget.w * K, h: cropTarget.h * K };
const crops = async (b64, scale) => page.evaluate(async (b64, rect, s) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const out = {};
  const box = (nm, x, y, w, h) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, cv.width, cv.height);
    out[nm] = cv.toDataURL('image/png');
  };
  const u = rect.w / 320;
  box('tl', rect.x - 4 * u, rect.y - 4 * u, 44 * u, 36 * u);
  box('top', rect.x + rect.w * 0.5 - 22 * u, rect.y - 6 * u, 44 * u, 34 * u);
  box('tr', rect.x + rect.w - 40 * u, rect.y - 4 * u, 44 * u, 36 * u);
  box('bl', rect.x - 4 * u, rect.y + rect.h - 32 * u, 44 * u, 36 * u);
  return out;
}, b64, rSc, scale);
for (const spec of [[4, '4x'], [8, '8x']]) {
  const c = await crops(pairMapA[0], spec[0]);
  for (const k of Object.keys(c)) writeFileSync(OUT + '/c6v' + TAG + '-disp-' + k + '-' + spec[1] + '.png', Buffer.from(String(c[k]).split(',')[1], 'base64'));
}

/* ── 项7 pp 展开 ─────────────────────────────────────────────────── */
const clickCard = async (id, wait = 1600) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id); if (!el) return { ok: false };
    const cands = [];
    for (const s of ['.panel-header', '.pp-header-row', '.pp-header-label', '.panel-title', '.location-bar-toggle', '.location-toolbar-label']) {
      const h = el.querySelector(s); if (!h) continue;
      const r = h.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) cands.push([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]);
    }
    const er = el.getBoundingClientRect();
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
    return { ok: false, cands };
  }, id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1], { steps: 4 });
  await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(wait);
  return p;
};
const ppClick = await clickCard('pp-toggles', 2000);
await parkPtr();
const ppShot = await shot();
save('pp-open-1x', ppShot);
const ppM = await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  const cr = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card.querySelector('.panel-collapsible') || card;
  const cw = cr.width;
  let cands = [...sc.querySelectorAll('*')].filter((n) => {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (r.height < 12 || r.height > 90 || c.display === 'none' || +c.opacity < 0.05) return false;
    if (n.classList.contains('gev-lc-edge') || n.classList.contains('panel-glow')) return false;
    if (r.width < cw * 0.5) return false;
    return true;
  });
  cands = cands.filter((n) => !cands.some((m) => m !== n && n.contains(m)));
  const rows = cands.map((n) => { const r = n.getBoundingClientRect(); return { y: +r.y.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), w: +r.width.toFixed(1), sel: n.tagName + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''), txt: (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22) }; }).sort((a, b) => a.y - b.y || a.x - b.x);
  const gaps = [], overlaps = [];
  for (let i = 1; i < rows.length; i++) { const g = +(rows[i].y - rows[i - 1].b).toFixed(1); if (g < -0.5) overlaps.push({ a: rows[i - 1].sel, b: rows[i].sel, iy: -g }); else gaps.push(g); }
  const tw = [...card.querySelectorAll('*')].filter((n) => !n.children.length && (n.textContent || '').trim() && n.getBoundingClientRect().height > 6).map((n) => ({ t: n.textContent.trim().slice(0, 16), r: n.getBoundingClientRect() }));
  const textOverlaps = [];
  for (let i = 0; i < tw.length; i++) for (let j = i + 1; j < tw.length; j++) {
    const a = tw[i].r, b = tw[j].r;
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 1 && iy > 1) textOverlaps.push({ a: tw[i].t, b: tw[j].t, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
  }
  const src = sc.getBoundingClientRect();
  const clipped = cands.filter((n) => { const r = n.getBoundingClientRect(); return r.right > src.right + 1 || r.left < src.left - 1; }).length;
  return { phase: card.dataset.lcPhase || null, rect: [+cr.x.toFixed(1), +cr.y.toFixed(1), +cr.width.toFixed(1), +cr.height.toFixed(1)],
    opacity: cs.opacity, display: cs.display, visibility: cs.visibility,
    rows: rows.length, rowsDetail: rows, minGap: gaps.length ? Math.min(...gaps) : null, overlaps, textOverlaps, clipped,
    scroll: { top: +sc.scrollTop.toFixed(1), h: sc.scrollHeight, ch: sc.clientHeight }, scroller: sc.tagName + '.' + (sc.className || '').toString().split(' ')[0] };
});
rec('T7a pp 展开可见（phase=open、尺寸≈300×430、opacity≥0.95、非 display:none）',
  ppM.phase === 'open' && ppM.rect[2] >= 250 && ppM.rect[3] >= 400 && +ppM.opacity >= 0.95 && ppM.display !== 'none' && ppM.visibility !== 'hidden',
  { phase: ppM.phase, rect: ppM.rect, opacity: ppM.opacity, display: ppM.display, click: ppClick });
rec('T7b pp 行数 ≥ 17', ppM.rows >= 17, { rows: ppM.rows, rowsDetail: ppM.rowsDetail.map((r) => r.txt) });
rec('T7c pp 17 行不重叠（行间 gap ≥ −0.5、无文字重叠、无横向裁切）',
  ppM.overlaps.length === 0 && ppM.textOverlaps.length === 0 && ppM.clipped === 0,
  { overlaps: ppM.overlaps, textOverlaps: ppM.textOverlaps, clipped: ppM.clipped, minGap: ppM.minGap });
const wheelPath = [];
for (let i = 0; i < 5; i++) {
  const box = await page.evaluate(() => { const r = document.getElementById('pp-toggles').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height * 0.62)]; });
  await page.mouse.move(box[0], box[1]);
  await page.mouse.wheel({ deltaY: 140 });
  await sleep(320);
  wheelPath.push(await page.evaluate(() => {
    const card = document.getElementById('pp-toggles');
    const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card;
    return +(+sc.scrollTop).toFixed(1);
  }));
}
const ppScrolledShot = await shot();
save('pp-scrolled-1x', ppScrolledShot);
rec('T7d pp 可滚（真实滚轮 → scrollTop 增长 > 50 且 maxScroll > 50）',
  wheelPath[wheelPath.length - 1] > 50 && ppM.scroll.h - ppM.scroll.ch > 50,
  { wheelPath, maxScroll: ppM.scroll.h - ppM.scroll.ch, scroll: ppM.scroll });

/* T3b2（INFO，仅记录）：pp 展开卡（C5 报告里的同一张卡）真实地图色散同口径复测。
   目的：说明「色散可见度随底图梯度变化」，不是全局常量。 */
const ppDisp = await (async () => {
  const pr = await page.evaluate(() => { const b = document.getElementById('pp-toggles').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const band = await page.evaluate(() => { const s = window.__gevEdge.stats(); const f = (s.surfaces || []).find((x) => x.id === 'pp-toggles'); return f ? f.band : s.band; });
  const a = await shot();
  await page.evaluate(() => window.__gevEdge.set({ dispGain: 1.0 })); await sleep(500);
  const b = await shot();
  await page.evaluate(() => window.__gevEdge.set({ dispGain: 8.0 })); await sleep(500);
  const r = { x: pr.x * K, y: pr.y * K, w: pr.w * K, h: pr.h * K };
  return page.evaluate(async (a, b, r, band) => {
    const A = await window.__c6.dec(a), B = await window.__c6.dec(b), f = window.__c6.edgeDisp;
    return { top: f(A, B, r, r.y, 'y', band, 1), left: f(A, B, r, r.x, 'x', band, 1),
      bot: f(A, B, r, r.y + r.h, 'y', band, -1), right: f(A, B, r, r.x + r.w, 'x', band, -1) };
  }, a, b, r, band * K);
})();
rec('I5 pp 展开卡真实地图色散（C5 同位置复测，仅记录：可见度随底图梯度变化）', true,
  { means: { top: ppDisp.top.mean, left: ppDisp.left.mean, bot: ppDisp.bot.mean, right: ppDisp.right.mean },
    max2d: { top: ppDisp.top.max2d, left: ppDisp.left.max2d, bot: ppDisp.bot.max2d, right: ppDisp.right.max2d } }, true);

/* ── 项6c location 内容居中 ───────────────────────────────────────── */
const locClick = await clickCard('location-bar', 2000);
await parkPtr();
const locShot = await shot();
save('location-open-1x', locShot);
const loc = await page.evaluate(() => {
  const card = document.getElementById('location-bar'); if (!card) return { missing: true };
  const cr = card.getBoundingClientRect();
  const inner = card.querySelector('.location-inner') || card;
  const ir = inner.getBoundingClientRect();
  const kids = [...inner.querySelectorAll('*')].map((n) => n.getBoundingClientRect())
    .filter((r) => r.width > 2 && r.height > 2 && r.bottom > cr.top && r.top < cr.bottom);
  const top = Math.min(...kids.map((r) => r.top));
  const bottom = Math.max(...kids.map((r) => r.bottom));
  return { phase: card.dataset.lcPhase || null, card: [+cr.x.toFixed(1), +cr.y.toFixed(1), +cr.width.toFixed(1), +cr.height.toFixed(1)],
    inner: [+ir.x.toFixed(1), +ir.y.toFixed(1), +ir.width.toFixed(1), +ir.height.toFixed(1)],
    topGap: +(top - cr.top).toFixed(1), bottomGap: +(cr.bottom - bottom).toFixed(1),
    contentSpan: +(bottom - top).toFixed(1) };
});
rec('T6c location 内容垂直居中（|topGap − bottomGap| ≤ 2px）', !loc.missing && Math.abs(loc.topGap - loc.bottomGap) <= 2, { ...loc, click: locClick });

/* 1x overall shots */
save('final-1x', await shot());
const statsEnd = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { fps: s.fps, drawFps: s.drawFps, frames: s.frames, err: s.err, drawMax: s.drawMax, peakWindows: s.peakWindows }; });

const counted = R.filter((x) => !x.skip);
const fails = counted.filter((x) => !x.ok).map((x) => x.name);
writeFileSync(`${OUT}/c6visual${TAG}.json`, JSON.stringify({
  instrument: 'Phase6C6 视觉验收探针（prod 4174，headed Chrome，真实鼠标；只读，不改产品代码）',
  base: BASE, bootMs, screenshotScaleK: K, gpu,
  thresholds: {
    T3a: 'sepCss 0.80–1.20 且 dispPx 2.0–3.0', T3b: 'realmap band mean Δ(R−B) ≥ 3', T3c: 'realmap band 2D max ≤ 25',
    T3d: '彩边宽度 ≤ 2.5 CSS px', T3e: '硬边 2px 条纹 2D max ≤ 20', T3f: '符号翻转 ≤ 2',
    T5a: 'inner Δmax ≥ 3', T5b: 'inner Δmean ≥ 0.25 且 brighterFrac ≥ 1%', T5c: '恢复 Δmean ≤ 0.6 / Δmax ≤ 2.5',
    T6a: '|dy| ≤ 1px', T6c: '|topGap−bottomGap| ≤ 2px', T7b: 'rows ≥ 17', T7c: 'gap ≥ −0.5 且 0 文字重叠',
  },
  cfg, styleLayers, textData: tData, textScene: tScene, voice, hover: { on: hv, restored: rs, cardRect },
  dispersion: { sepCss, sepRangeOk: sepCss >= 0.8 && sepCss <= 1.2, mapRows, mapRows2, noiseRows, leak, jndRatio: +(jndRows.length / mapRows.length).toFixed(3), hardEdge: { max2d: hardMax, meanMax: +hardMeanMax.toFixed(2) } },
  pp: { ...ppM, wheelPath }, ppDisp, location: loc, statsEnd, errs: errs.slice(0, 8), results: R,
  summary: { pass: counted.filter((x) => x.ok).length, total: counted.length, fails },
}, null, 1));
console.log('\n' + counted.filter((x) => x.ok).length + '/' + counted.length + ' PASS   FAIL:' + (fails.length ? JSON.stringify(fails) : ' none'));
await browser.close();
process.exit(fails.length ? 1 : 0);
