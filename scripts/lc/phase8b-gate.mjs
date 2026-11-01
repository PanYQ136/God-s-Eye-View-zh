#!/usr/bin/env node
/* Phase8B —— 玻璃 P0 光学验收（D1/D2/D3 + #2/#3/#6）
   只读探针：不改产品代码、不改阈值；全部读数取「产品运行时 + 真实截图」。
   ── 判据（写死在本文件）────────────────────────────────────────────────
   A0 GPU：window.__gevGpu.probe().renderer 必须含 'RTX 3060'，否则整轮 FAIL
   A1 token 同源：页面 GLASS 常量 == src/lc/tokens.json material 段
   A2 变体枚举：默认 clear；regular/clear 双向切换写在 data-lc-material；非法值回落到默认
   A3 高光随指针（D2/#2）：指针在卡左/右 20% → --lc-gloss-x 差 ≥ 40 点，
                             且顶沿像素差的加权质心随指针左→右移动 ≥ 0.25 卡宽
   A4 阴影随亮度（D2/G7）：注入亮度 0.15 → 0.85，--lc-shadow-a 单调上移并贴近
                             min+(max-min)*luma（误差 ≤0.04）；5Hz 真采样 lumaSamples ≥3
   A5 文字局部 scrim（#6/D6）：header 顶部 24px 带的亮度在「开/关 --lc-text-scrim-a」之间
                             变化 ≥ 3 灰阶，且渐变在 24px 处收敛（底部差 ≤ 1.5 灰阶）
   A6 Clear scrim（D1/G12）：亮度 0.8 → 断言计数 +1 且日志有 scrim-assert；
                             默认 mode=off 时 data-lc-scrim 仍 off（观感不变）；
                             setScrim('auto') 后 data-lc-scrim=on 且卡面压暗 ≥ 12 灰阶
   A7 morph↔lens（D3/G22）：真点击期间 __gevEdge.cfg().enabled 出现 false 且随后恢复 true；
                             duration ∈ [350,450]；pPeak ∈ [1.02,1.05]；degrade→restore 间隔 ≥ 1 帧
   用法: node scripts/lc/phase8b-gate.mjs [tag]
   产物: .gev-logs/lc/phase8b/*.png + phase8b-gate[-tag].json
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const TAG = process.argv[2] ? '-' + process.argv[2] : '';
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4173/?welcome=0';
const OUT = '.gev-logs/lc/phase8b';
mkdirSync(OUT, { recursive: true });
const W = 1348;
const VH = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, pass, detail) => {
  R.push({ name, pass: !!pass, ...(detail || {}) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail ? JSON.stringify(detail).slice(0, 260) : ''}`);
};

const TOKENS = JSON.parse(readFileSync('src/lc/tokens.json', 'utf8'));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${VH + 160}`,
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true }));
  } catch (e) {}
  try {
    sessionStorage.setItem('gev.gl.armed', '1');
  } catch (e) {}
});
const t0 = Date.now();
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page
    .evaluate(
      () =>
        !!(
          window.__lc &&
          window.__lc.api &&
          window.__lc.api.interactiveAt &&
          window.__lc.glass &&
          window.__gevEdge &&
          window.__gevEdge.stats().count > 0
        ),
    )
    .catch(() => false);
  if (ok) break;
  await sleep(400);
}
const bootMs = Date.now() - t0;
await sleep(4500);
const cdp = await page.createCDPSession();
const shot = async () =>
  (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const save = (name, b64) => {
  if (!b64) return null;
  const p = `${OUT}/${TAG || '-default'}-${name}.png`;
  writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
};
const parkPtr = async () => {
  await page.mouse.move(4, VH - 8, { steps: 3 });
  await sleep(320);
};

/* 页内像素内核：解码 + 8x 裁剪 + 区域统计（全部在页面里做，避免额外的图像依赖） */
await page.evaluate(() => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  window.__p8 = {
    dec,
    luma,
    /* 矩形内平均亮度（CSS 坐标） */
    mean(A, box) {
      const K = A.K;
      const x0 = Math.max(0, Math.round(box.x * K));
      const y0 = Math.max(0, Math.round(box.y * K));
      const x1 = Math.min(A.w, Math.round((box.x + box.w) * K));
      const y1 = Math.min(A.h, Math.round((box.y + box.h) * K));
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += luma(A.d, (y * A.w + x) * 4); n++; }
      return n ? +(s / n).toFixed(3) : 0;
    },
    /* 顶沿 3px 带里「亮度的加权质心 x」（归一化到卡宽） */
    topCentroid(A, B, rect) {
      const K = A.K;
      const x0 = Math.round(rect.x * K);
      const x1 = Math.min(A.w, Math.round((rect.x + rect.w) * K));
      const y0 = Math.round(rect.y * K);
      const y1 = Math.min(A.h, y0 + Math.max(2, Math.round(3 * K)));
      let sw = 0;
      let s = 0;
      let tot = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * A.w + x) * 4;
          const dv = luma(A.d, i) - luma(B.d, i);
          if (dv > 0.5) { s += dv; sw += dv * ((x - x0) / Math.max(1, x1 - x0)); tot++; }
        }
      return { centroid: s > 0 ? +(sw / s).toFixed(4) : null, w: +s.toFixed(1), n: tot };
    },
  };
  window.__p8crop = async (b64, box, s) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const K = bmp.width / innerWidth;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(box.w * K * s));
    cv.height = Math.max(1, Math.round(box.h * K * s));
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(box.x * K), Math.round(box.y * K), Math.round(box.w * K), Math.round(box.h * K), 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png').split(',')[1];
  };
});

/* ── A0 GPU ──────────────────────────────────────────────────────────── */
const gpu = await page.evaluate(() => {
  try {
    return window.__gevGpu.probe();
  } catch (e) {
    return null;
  }
});
const renderer = (gpu && gpu.renderer) || '';
rec('A0 GPU = RTX 3060（非软件渲染）', /RTX 3060/i.test(renderer), { renderer, tier: gpu && gpu.tier, bootMs });

/* ── A1 token 同源 ───────────────────────────────────────────────────── */
const glassTokens = await page.evaluate(() => window.__lc.glass.tokens());
const tokDiff = [];
const cmp = (path, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) tokDiff.push({ path, page: a, json: b });
};
cmp('material.variants', glassTokens.variants, TOKENS.material.variants);
cmp('material.default', glassTokens.defaultVariant, TOKENS.material.default);
cmp('material.clearScrim.threshold', glassTokens.scrim.threshold, TOKENS.material.clearScrim.threshold);
cmp('material.clearScrim.alpha', glassTokens.scrim.alpha, TOKENS.material.clearScrim.alpha);
cmp('material.highlight.maxOpacity', glassTokens.highlight.max, TOKENS.material.highlight.maxOpacity);
cmp('material.highlight.baseOpacity', glassTokens.highlight.base, TOKENS.material.highlight.baseOpacity);
cmp('material.shadow.hz', glassTokens.shadow.hz, TOKENS.material.shadow.hz);
cmp('material.shadow.minAlpha', glassTokens.shadow.min, TOKENS.material.shadow.minAlpha);
cmp('material.shadow.maxAlpha', glassTokens.shadow.max, TOKENS.material.shadow.maxAlpha);
cmp('material.morphLens.restoreFrames', glassTokens.morphLens.restoreFrames, TOKENS.material.morphLens.restoreFrames);
rec('A1 页面 GLASS 常量 == tokens.json material 段', tokDiff.length === 0, { diff: tokDiff });

/* ── A2 变体枚举 ─────────────────────────────────────────────────────── */
const TRACKED = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
const v0 = await page.evaluate((ids) => {
  const s = window.__lc.glass.state();
  const els = ids.map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.dataset.lcMaterial || '');
  return { variant: s.variant, variants: s.variants, els, uniq: [...new Set(els)], extra: [...document.querySelectorAll('.gev-lc')].filter((e) => !ids.includes(e.id)).map((e) => e.id + ':' + (e.dataset.lcMaterial || '-')) };
}, TRACKED);
const v1 = await page.evaluate((ids) => {
  const els = () => ids.map((id) => document.getElementById(id)).filter(Boolean);
  window.__lc.glass.setMaterial('regular');
  const a = [...new Set(els().map((e) => e.dataset.lcMaterial))];
  window.__lc.glass.setMaterial('clear');
  const b = [...new Set(els().map((e) => e.dataset.lcMaterial))];
  const bad = window.__lc.glass.setMaterial('__nope__');
  return { regular: a, clear: b, fallback: bad, cards: els().length };
}, TRACKED);
rec(
  'A2 material 枚举 regular|clear（默认 clear，双向落 data-lc-material，非法值回落）',
  v0.variant === 'clear' &&
    JSON.stringify(v0.variants) === '["regular","clear"]' &&
    v0.uniq.length === 1 &&
    v0.uniq[0] === 'clear' &&
    v0.els.length === TRACKED.length &&
    v1.regular.join() === 'regular' &&
    v1.clear.join() === 'clear' &&
    v1.fallback === 'clear',
  { ...v0, ...v1 },
);

/* 打开 data-panel（真点击标题行），后续 A3/A5/A7 都在展开卡上做 */
const rectOf = (id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id, x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
const headerOf = (id) =>
  page.evaluate((id) => {
    const el = document.querySelector(`#${id} .panel-header, #${id} .pp-header-row, #${id} .dock-tray-toggle, #${id} .gev-voice-heading, #${id} .location-bar-toggle`);
    const card = document.getElementById(id);
    const r = el && el.getBoundingClientRect().height > 4 ? el.getBoundingClientRect() : card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
const phaseOf = (id) => page.evaluate((id) => (window.__lc.api.phases() || {})[id], id);
const diag = [];
/** 真鼠标点卡：mini 整条都是切换目标 → 点卡心；open → 点标题行左侧（避开控件）。
    点不动（相位没变）时补一次：收起的卡回到轨道后要等 App 重新落位，早点点会落空。 */
const toggleCard = async (id) => {
  const attempts = [];
  for (let i = 0; i < 2; i++) {
    const phase = await phaseOf(id);
    const r = phase === 'mini' ? await rectOf(id) : await headerOf(id);
    const x = Math.round(phase === 'mini' ? r.x + r.w / 2 : r.x + 8);
    const y = Math.round(r.y + r.h / 2);
    const at = await page.evaluate((x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.tagName + '.' + String(el.className || '').split(' ').slice(0, 3).join('.') : 'none';
    }, x, y);
    await page.mouse.click(x, y);
    await sleep(820);
    const after = await phaseOf(id);
    attempts.push({ phaseBefore: phase, rect: r, click: [x, y], at, phaseAfter: after });
    if (after !== phase) break;
    await sleep(320);
  }
  diag.push({ id, attempts });
  return attempts[attempts.length - 1].phaseAfter;
};
const ph0 = await phaseOf('data-panel');
if (ph0 === 'mini') await toggleCard('data-panel');
else await page.mouse.move(4, VH - 8);

/* ── A7 morph ↔ lens（真点击，逐帧采样开关与帧计数）────────────────── */
await page.evaluate(() => {
  window.__p8morph = { samples: [], stop: false };
  const loop = () => {
    if (window.__p8morph.stop) return;
    const e = window.__gevEdge;
    const g = window.__lc.glass.state();
    window.__p8morph.samples.push({
      t: +performance.now().toFixed(1),
      enabled: !!(e && e.cfg().enabled),
      frames: e ? e.stats().frames : -1,
      morph: (g.morph || {}).active || 0,
      phase: (window.__lc.api.phases() || {})['data-panel'],
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const phA = await phaseOf('data-panel');
const phClose = await toggleCard('data-panel'); /* 采集「关」的 morph */
const phB = await phaseOf('data-panel');
const phOpen = await toggleCard('data-panel'); /* 采集「开」的 morph */
await page.evaluate(() => {
  window.__p8morph.stop = true;
});
const morphChk = await page.evaluate(() => {
  const s = window.__p8morph.samples;
  const g = window.__lc.glass.state().morph;
  const m = (window.__lc.morph && window.__lc.morph.last) || {};
  const off = s.filter((x) => !x.enabled);
  const offIdx = s.findIndex((x) => !x.enabled);
  const backIdx = offIdx < 0 ? -1 : s.findIndex((x, i) => i > offIdx && x.enabled);
  /* 逐窗口冻结：最长的一段连续 enabled=false 期间 draw frames 前进多少（应 ≤1） */
  let run = [];
  const runs = [];
  for (const x of s) {
    if (!x.enabled) run.push(x);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const freezes = runs.map((r) => ({ n: r.length, dFrames: Math.max(...r.map((x) => x.frames)) - Math.min(...r.map((x) => x.frames)), phases: [...new Set(r.map((x) => x.phase))] }));
  const freeze = freezes.length ? Math.max(...freezes.map((f) => f.dFrames)) : -1;
  const offPhases = [...new Set(off.map((x) => x.phase))];
  return {
    samples: s.length,
    offFrames: off.length,
    offIdx,
    backIdx,
    offPhases,
    freezes,
    framesFrozenDuringOff: freeze,
    morphActiveMax: Math.max(...s.map((x) => x.morph)),
    meta: g,
    last: { duration: m.duration, pPeak: m.pPeak, pPeakY: m.pPeakY, easing: m.easing, id: m.id, from: m.from, to: m.to },
  };
});
const dOk = morphChk.last.duration >= 350 && morphChk.last.duration <= 450;
/* pPeak 是「曲线参数」的峰值，视觉峰值 = 1 + |1-s|·(pPeak-1) —— 卡片要的是视觉 1.02–1.05 */
const [fx, fy, fw, fh] = morphChk.last.from || [0, 0, 1, 1];
const [tx, ty, tw, th] = morphChk.last.to || [0, 0, 1, 1];
const visX = 1 + Math.abs(1 - fw / tw) * (morphChk.last.pPeak - 1);
const visY = 1 + Math.abs(1 - fh / th) * (morphChk.last.pPeakY - 1);
const pOk = visX >= 1.02 && visX <= 1.05 && visY >= 1.02 && visY <= 1.05;
const gapMs = morphChk.meta.lastRestoreAt - morphChk.meta.degradeAt;
rec(
  'A7 morph 期 lens 关闭、结束 1 帧后恢复（D3/G22）',
  morphChk.offFrames > 0 &&
    morphChk.backIdx > morphChk.offIdx &&
    morphChk.framesFrozenDuringOff <= 1 &&
    gapMs >= 250 &&
    dOk &&
    pOk &&
    phA === 'open' &&
    phClose === 'mini' &&
    phOpen === 'open' &&
    visX >= 1.02 &&
    visY >= 1.02,
  {
    phases: { before: phA, afterClose: phClose, afterOpen: phOpen },
    offFrames: morphChk.offFrames,
    offPhases: morphChk.offPhases,
    framesFrozen: morphChk.framesFrozenDuringOff,
    restoreAfterOff: morphChk.backIdx > morphChk.offIdx,
    degradeToRestoreMs: +gapMs.toFixed(1),
    begins: morphChk.meta.begins,
    restores: morphChk.meta.restores,
    duration: morphChk.last.duration,
    pPeak: morphChk.last.pPeak,
    pPeakY: morphChk.last.pPeakY,
    visualPeakX: +visX.toFixed(4),
    visualPeakY: +visY.toFixed(4),
    samples: morphChk.samples,
  },
);

/* 再开一次并保持展开，供 A3/A5 使用 */
const cardMiniNow = await rectOf('data-panel');
await page.mouse.click(Math.round(cardMiniNow.x + 30), Math.round(cardMiniNow.y + 18));
await sleep(1100);

/* ── A3 高光随指针 ───────────────────────────────────────────────────── */
const card = await rectOf('data-panel');
const headerRect = await page.evaluate(() => {
  const el = document.querySelector('#data-panel .panel-header');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const setPtr = async (x, y) => {
  await page.mouse.move(Math.round(x), Math.round(y), { steps: 6 });
  await sleep(300);
};
const glossVars = () =>
  page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const cs = getComputedStyle(el);
    return { x: cs.getPropertyValue('--lc-gloss-x').trim(), a: cs.getPropertyValue('--lc-gloss-a').trim(), st: window.__lc.glass.state().gloss };
  });
/* 左/右各 3 对：地图在动，单对的差值质心会被底图变化污染 → 取中位数。
   像素证明用 lens 的确定性棋盘底衬（__gevEdge.testChecker），底衬静态 → 差值只剩高光本身。 */
await page.evaluate(() => window.__gevEdge.testChecker(true, 8));
await sleep(500);
const ptrY = card.y + 10;
const reps = [];
for (let i = 0; i < 3; i++) {
  await setPtr(card.x + card.w * 0.2, ptrY);
  const a = await shot();
  const gA = await glossVars();
  await setPtr(card.x + card.w * 0.8, ptrY);
  const b = await shot();
  const gB = await glossVars();
  const cen = await page.evaluate(
    async (a, b, rect) => {
      const A = await window.__p8.dec(a);
      const B = await window.__p8.dec(b);
      return window.__p8.topCentroid(A, B, rect);
    },
    a,
    b,
    card,
  );
  reps.push({ glossL: parseFloat(gA.x), glossR: parseFloat(gB.x), aL: parseFloat(gA.a), aR: parseFloat(gB.a), centroid: cen.centroid, diffPx: cen.w });
  if (i === 0) {
    const box = { x: card.x, y: card.y - 1, w: card.w, h: 6 };
    save('a3-gloss-left-8x', await page.evaluate((bb, bx, s) => window.__p8crop(bb, bx, s), a, box, 8));
    save('a3-gloss-right-8x', await page.evaluate((bb, bx, s) => window.__p8crop(bb, bx, s), b, box, 8));
  }
}
/* 指针离卡很远时的基线（opacity 应回落到 base 0.10） */
await page.mouse.move(4, VH - 8, { steps: 4 });
await sleep(320);
const gFar = await glossVars();
/* 关掉棋盘底衬，回到真实地图（后续 A4–A8 都在真实底图口径下量） */
await page.evaluate(() => window.__gevEdge.testChecker(false));
await sleep(420);
const medCen = reps.map((r) => r.centroid).filter((v) => v != null).sort((x, y) => x - y)[Math.floor(reps.length / 2)] ?? null;
const xDelta = Math.min(...reps.map((r) => Math.abs(r.glossR - r.glossL)));
const aMax = Math.max(...reps.flatMap((r) => [r.aL, r.aR]));
rec(
  'A3 指针移动 → 上沿高光弧段位置变化（Fresnel，opacity ≤0.25）',
  xDelta >= 40 && aMax <= 0.2501 && aMax >= 0.24 && parseFloat(gFar.a) <= 0.101 && medCen != null && medCen <= 0.46,
  {
    glossX: reps.map((r) => [r.glossL, r.glossR]),
    glossA: reps.map((r) => [r.aL, r.aR]),
    glossAFar: gFar.a,
    centroids: reps.map((r) => r.centroid),
    centroidMedian: medCen,
    xDeltaMin: xDelta,
  },
);

/* ── A4 阴影随亮度（5Hz lerp）────────────────────────────────────────── */
const shadowSeq = await page.evaluate(async () => {
  const out = [];
  const el = document.getElementById('data-panel');
  const g = window.__lc.glass;
  g.setSampling(false); /* 注入期间暂停 5Hz 真采样，否则注入值会被下一拍真实地图亮度覆盖 */
  const tap = (label) => {
    const cs = getComputedStyle(el);
    const s = g.state();
    out.push({
      label,
      t: +performance.now().toFixed(0),
      luma: s.luma,
      shadowA: s.shadowA,
      cssShadow: cs.boxShadow.slice(0, 120),
      src: s.lumaSrc,
    });
  };
  g.__setLuma(0.15);
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 0; i < 6; i++) { tap('dark'); await new Promise((r) => setTimeout(r, 200)); }
  g.__setLuma(0.85);
  for (let i = 0; i < 10; i++) { tap('bright'); await new Promise((r) => setTimeout(r, 200)); }
  const s = g.state();
  return { seq: out, lumaSamples: s.lumaSamples, lumaSrc: s.lumaSrc, shadowA: s.shadowA };
});
const darkS = shadowSeq.seq.filter((x) => x.label === 'dark');
const brightS = shadowSeq.seq.filter((x) => x.label === 'bright');
const targetDark = 0.1 + 0.2 * 0.15;
const targetBright = 0.1 + 0.2 * 0.85;
const darkEnd = darkS[darkS.length - 1].shadowA;
const brightEnd = brightS[brightS.length - 1].shadowA;
const monoUp = brightS.every((x, i) => i === 0 || x.shadowA >= brightS[i - 1].shadowA - 1e-6);
/* Phase8C 起：D4 的 spill 会给阴影**染色**（--lc-shadow-rgb 由环带色驱动，不再是纯黑），
   D2/G7 管的一直是 alpha —— 所以这里按「rgba 的 alpha 等于 lerp 目标（±0.02）」判，
   判据强度不变（原来是 alpha 正则，现在仍是同一个 alpha，只是不吃死 (0,0,0) 的色值）。 */
const cssAlphaM = /rgba?\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\s*\)/.exec(brightS[brightS.length - 1].cssShadow);
const cssAlphaVal = cssAlphaM ? parseFloat(cssAlphaM[1]) : null;
const cssHasAlpha = cssAlphaVal != null && Math.abs(cssAlphaVal - targetBright) <= 0.02;
rec(
  'A4 阴影按背后亮度 5Hz lerp（D2/G7）',
  Math.abs(darkEnd - targetDark) <= 0.04 &&
    Math.abs(brightEnd - targetBright) <= 0.04 &&
    brightEnd > darkEnd + 0.05 &&
    monoUp &&
    cssHasAlpha &&
    shadowSeq.lumaSamples >= 3,
  {
    targetDark: +targetDark.toFixed(3),
    targetBright: +targetBright.toFixed(3),
    darkEnd: +darkEnd.toFixed(3),
    brightEnd: +brightEnd.toFixed(3),
    monotonic: monoUp,
    cssShadow: brightS[brightS.length - 1].cssShadow,
    cssAlpha: cssAlphaVal,
    realSamples: shadowSeq.lumaSamples,
    lumaSrc: shadowSeq.lumaSrc,
  },
);
/* 恢复真实亮度读数（采样仍暂停，A6 结束再恢复 5Hz 真采样） */
await page.evaluate(() => window.__lc.glass.sampleLumaNow());

/* ── A5 文字局部 scrim ───────────────────────────────────────────────── */
const hdr = headerRect || { x: card.x + 8, y: card.y + 8, w: card.w - 16, h: 48 };
const bandTop = { x: card.x + 8, y: card.y + 2, w: Math.min(card.w - 16, 140), h: 5 };
const bandDeep = { x: card.x + 8, y: card.y + 30, w: Math.min(card.w - 16, 140), h: 5 };
await parkPtr();
await sleep(300);
const shotScrimOn = await shot();
const mOn = await page.evaluate(
  async (a, t, d) => {
    const A = await window.__p8.dec(a);
    return { top: window.__p8.mean(A, t), deep: window.__p8.mean(A, d), css: getComputedStyle(document.getElementById('data-panel')).backgroundImage.slice(0, 200) };
  },
  shotScrimOn,
  bandTop,
  bandDeep,
);
await page.evaluate(() => {
  document.getElementById('data-panel').style.setProperty('--lc-text-scrim-a', '0');
});
await sleep(320);
const shotScrimOff = await shot();
const mOff = await page.evaluate(
  async (a, t, d) => {
    const A = await window.__p8.dec(a);
    return { top: window.__p8.mean(A, t), deep: window.__p8.mean(A, d) };
  },
  shotScrimOff,
  bandTop,
  bandDeep,
);
await page.evaluate(() => {
  document.getElementById('data-panel').style.removeProperty('--lc-text-scrim-a');
});
const dTop = mOff.top - mOn.top;
const dDeep = mOff.deep - mOn.deep;
rec(
  'A5 文字局部 scrim：24px 渐变、alpha≤0.35、只压文字行（#6/D6）',
  dTop >= 3 && Math.abs(dDeep) <= 1.6 && /linear-gradient/.test(mOn.css) && TOKENS.material.textScrim.alpha <= 0.35 && TOKENS.material.textScrim.px === 24,
  { topDelta: +dTop.toFixed(2), deepDelta: +dDeep.toFixed(2), onTop: mOn.top, onDeep: mOn.deep, offTop: mOff.top, offDeep: mOff.deep, css: mOn.css },
);
{
  const box = { x: card.x, y: card.y, w: Math.min(card.w, 220), h: 40 };
  save('a5-textscrim-on-8x', await page.evaluate((b, bx, s) => window.__p8crop(b, bx, s), shotScrimOn, box, 8));
  save('a5-textscrim-off-8x', await page.evaluate((b, bx, s) => window.__p8crop(b, bx, s), shotScrimOff, box, 8));
}

/* ── A6 Clear 亮底 scrim 断言 ────────────────────────────────────────── */
const centerBox = { x: card.x + card.w * 0.55, y: card.y + card.h * 0.55, w: 24, h: 16 };
await page.evaluate(() => window.__lc.glass.setScrim('off'));
await page.evaluate(() => window.__lc.glass.sampleLumaNow());
await sleep(260);
const shotNoScrim = await shot();
const scrimCase = await page.evaluate(async () => {
  const g = window.__lc.glass;
  const before = g.state().assert.scrim;
  g.__setLuma(0.8);
  await new Promise((r) => setTimeout(r, 120));
  const logOnly = { assert: g.state().assert, scrim: g.state().scrim, mode: g.state().scrimMode, el: document.getElementById('data-panel').dataset.lcScrim, log: g.log().slice(-4) };
  const afterAssert = g.state().assert.scrim;
  g.setScrim('auto');
  await new Promise((r) => setTimeout(r, 160));
  const applied = { scrim: g.state().scrim, mode: g.state().scrimMode, el: document.getElementById('data-panel').dataset.lcScrim, alpha: g.state().scrimAlpha, cssVar: getComputedStyle(document.getElementById('data-panel')).getPropertyValue('--lc-scrim-a').trim() };
  return { before, afterAssert, logOnly, applied };
});
await sleep(220);
const shotScrimOn2 = await shot();
const mScrim = await page.evaluate(
  async (a, b, box) => {
    const A = await window.__p8.dec(a);
    const B = await window.__p8.dec(b);
    return { without: window.__p8.mean(A, box), with_: window.__p8.mean(B, box) };
  },
  shotNoScrim,
  shotScrimOn2,
  centerBox,
);
const dim = mScrim.without - mScrim.with_;
rec(
  'A6 Clear 亮底 scrim：断言触发 + 默认只日志 + auto 时压暗 ≥12 灰阶（D1/G12）',
  scrimCase.afterAssert === scrimCase.before + 1 &&
    scrimCase.logOnly.el === 'off' &&
    scrimCase.logOnly.log.some((x) => x.kind === 'scrim-assert') &&
    scrimCase.applied.el === 'on' &&
    scrimCase.applied.alpha === 0.35 &&
    dim >= 12,
  {
    assertBefore: scrimCase.before,
    assertAfter: scrimCase.afterAssert,
    defaultScrim: scrimCase.logOnly.el,
    applied: scrimCase.applied,
    meanWithout: mScrim.without,
    meanWith: mScrim.with_,
    dim: +dim.toFixed(2),
  },
);
{
  const box = { x: card.x, y: card.y, w: Math.min(card.w, 260), h: Math.min(card.h, 120) };
  save('a6-scrim-off-8x', await page.evaluate((b, bx, s) => window.__p8crop(b, bx, s), shotNoScrim, box, 8));
  save('a6-scrim-on-8x', await page.evaluate((b, bx, s) => window.__p8crop(b, bx, s), shotScrimOn2, box, 8));
}
/* 复原：默认观感（scrim off，亮度假注入回真实值，恢复 5Hz 真采样） */
await page.evaluate(() => {
  const g = window.__lc.glass;
  g.setScrim('off');
  g.sampleLumaNow();
  g.setSampling(true);
});
await sleep(400);

/* ── 1x 全图 + 卡片 4x ───────────────────────────────────────────────── */
await parkPtr();
await sleep(300);
const shotFull = await shot();
save('a0-full-1x', shotFull);
save('a0-data-panel-4x', await page.evaluate((b, bx, s) => window.__p8crop(b, bx, s), shotFull, card, 4));
const finalState = await page.evaluate(() => {
  const s = window.__lc.glass.state();
  return {
    variant: s.variant,
    scrim: s.scrim,
    scrimMode: s.scrimMode,
    luma: s.luma,
    lumaSrc: s.lumaSrc,
    lumaSamples: s.lumaSamples,
    shadowA: s.shadowA,
    gloss: s.gloss,
    morph: s.morph,
    assert: s.assert,
    log: window.__lc.glass.log().slice(-6),
  };
});
/* 默认观感断言：收尾必须是 clear + scrim off */
rec('A8 默认观感不变（clear + scrim off + 单层壳）', finalState.variant === 'clear' && finalState.scrim === false && finalState.scrimMode === 'off', {
  variant: finalState.variant,
  scrim: finalState.scrim,
  scrimMode: finalState.scrimMode,
});

const out = {
  phase: '8B',
  at: new Date().toISOString(),
  url: BASE,
  bootMs,
  viewport: [W, VH],
  renderer,
  gpuTier: gpu && gpu.tier,
  pass: R.every((x) => x.pass),
  fails: R.filter((x) => !x.pass).map((x) => x.name),
  results: R,
  shadowSeq: shadowSeq.seq,
  morphChk,
  a7: { diag, freezes: morphChk.freezes, offPhases: morphChk.offPhases, samples: morphChk.samples },
  scrimCase,
  finalState,
  consoleErrors: errs.slice(0, 12),
  shots: {
    full: `${OUT}/${TAG || '-default'}-a0-full-1x.png`,
    card4x: `${OUT}/${TAG || '-default'}-a0-data-panel-4x.png`,
    glossLeft8x: `${OUT}/${TAG || '-default'}-a3-gloss-left-8x.png`,
    glossRight8x: `${OUT}/${TAG || '-default'}-a3-gloss-right-8x.png`,
    textScrimOn8x: `${OUT}/${TAG || '-default'}-a5-textscrim-on-8x.png`,
    textScrimOff8x: `${OUT}/${TAG || '-default'}-a5-textscrim-off-8x.png`,
    scrimOn8x: `${OUT}/${TAG || '-default'}-a6-scrim-on-8x.png`,
    scrimOff8x: `${OUT}/${TAG || '-default'}-a6-scrim-off-8x.png`,
  },
};
writeFileSync(`${OUT}/phase8b-gate${TAG}.json`, JSON.stringify(out, null, 2));

console.log('\n=== Phase8B gate ===');
console.log('renderer:', renderer);
console.log('pass:', out.pass, ' fails:', out.fails.join(' | ') || '(none)');
console.log('json:', `${OUT}/phase8b-gate${TAG}.json`);
await browser.close();
process.exit(out.pass ? 0 : 1);
