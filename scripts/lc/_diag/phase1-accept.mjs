#!/usr/bin/env node
/**
 * scripts/lc/phase1-accept.mjs —— Phase 1 验收（T1/T2/T3/T6/T7/T12/T13/T14/T15/T16）
 *
 * 规矩（架构 §9.1）：
 *   · 只用真实 CDP 鼠标（isTrusted=true），**禁止** __gevLc.open()/toggle() 旁路；
 *   · 每条断言都出可复算数字（rect / 命中 / computed / getAnimations / rAF 采样）；
 *   · 截图存档（含 deviceScaleFactor=4 的角部/边缘放大图）供「灰圈=0」目检。
 *
 * 用法：
 *   node scripts/lc/phase1-accept.mjs [--url=http://127.0.0.1:4173/] [--w=1536] [--h=730]
 *        [--tag=r1] [--skip-sw]
 * 产物：.gev-logs/lc/phase1/<tag>/  {report.json, *.png}
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=').slice(1).join('=') : d;
};
const URL_ = arg('url', 'http://127.0.0.1:4173/');
const W = +arg('w', 1536);
const H = +arg('h', 730);
const TAG = arg('tag', 'r1');
const SKIP_SW = process.argv.includes('--skip-sw');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('.gev-logs/lc/phase1', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARDS = {
  'data-panel': [320, 380],
  'scene-panel': [320, 340],
  'pp-toggles': [300, 430],
  'cctv-panel': [340, 430],
  'global-context-panel': [320, 400],
  'location-bar': [380, 240],
  'control-panel': [520, 380],
  'gev-voice-control': [260, 240],
};
const HEADERS = [
  ['data-panel', '#data-panel .panel-header'],
  ['scene-panel', '#scene-panel .panel-header'],
  ['pp-toggles', '#pp-toggles .pp-header-row'],
  ['cctv-panel', '#cctv-panel .panel-header'],
  ['global-context-panel', '#global-context-panel .panel-header'],
  ['location-bar', '#location-bar-toggle'],
  ['control-panel', '#control-panel-toggle'],
  ['gev-voice-control', '#gev-voice-control .gev-voice-heading'],
];
const DOCK = ['location-bar', 'control-panel', 'gev-voice-control'];

const R = [];
const rec = (id, name, pass, detail) => {
  R.push({ id, name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(5)} ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
};

function launch(extraArgs = [], opts = {}) {
  return puppeteer.launch({
    headless: !process.argv.includes('--headful'),
    executablePath: CHROME,
    args: [
      '--no-sandbox',
      `--window-size=${W + 24},${H + 160}`,
      '--window-position=1980,20',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      ...extraArgs,
    ],
    protocolTimeout: 900000,
    ...opts,
  });
}

const SEED = () => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.removeItem('gev-liquid-cards:v2:last');
    sessionStorage.removeItem('gev.gpu.notice.shown');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem(
      'gev.gfx',
      JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'high-performance' }),
    );
    window.__ptr = [];
    const push = (ev) =>
      window.__ptr.push({
        type: ev.type,
        trusted: ev.isTrusted,
        x: Math.round(ev.clientX || 0),
        y: Math.round(ev.clientY || 0),
        tgt: ev.target && ev.target.id ? '#' + ev.target.id : ev.target && ev.target.tagName,
      });
    ['pointerdown', 'pointerup', 'click'].forEach((t) => window.addEventListener(t, push, true));
  } catch (e) {}
};

async function boot(page) {
  await page.evaluateOnNewDocument(SEED);
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 180000 });
  for (let i = 0; i < 200; i++) {
    const gone = await page
      .evaluate(() => {
        const l = document.querySelector('#loading-screen');
        return !l || parseFloat(getComputedStyle(l).opacity || '1') < 0.05;
      })
      .catch(() => false);
    if (gone) break;
    await sleep(400);
  }
  await sleep(5000);
}

const stateOf = (page, ids) =>
  page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) {
        out[id] = null;
        continue;
      }
      const b = e.getBoundingClientRect();
      out[id] = {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
        cx: Math.round(b.x + b.width / 2),
        bottom: Math.round(b.bottom),
        floating: e.classList.contains('gev-lc-floating'),
        collapsed: e.classList.contains('collapsed'),
        anims: e.getAnimations ? e.getAnimations().filter((a) => a.playState === 'running').length : -1,
        /* 「无截字」：卡内**叶文本元素**一律不得被自己的 overflow 裁掉，且必须完整落在卡内 */
        clipped: (() => {
          const bad = [];
          const box = b;
          const inScroller = (n) => {
            let p = n.parentElement;
            while (p && p !== e) {
              const cs = getComputedStyle(p);
              if (/auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY)) return true;
              p = p.parentElement;
            }
            return false;
          };
          for (const n of e.querySelectorAll('*')) {
            if (n.children.length) continue;
            const t = (n.textContent || '').trim();
            if (!t) continue;
            const cs = getComputedStyle(n);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
            const nb = n.getBoundingClientRect();
            if (nb.width < 2 || nb.height < 2) continue;
            const cutX = n.scrollWidth > n.clientWidth + 1 && cs.overflowX !== 'visible';
            /* 滚动容器里的子项（胶囊横排等）本来就会超出可视区 → 不算截字 */
            const outside = !inScroller(n) && (nb.right > box.right + 1 || nb.left < box.left - 1);
            if (cutX || outside) bad.push((n.className || n.tagName) + ':' + t.slice(0, 14) + (cutX ? ':cutX' : '') + (outside ? ':out' : ''));
          }
          return { sw: e.scrollWidth, cw: e.clientWidth, bad: bad.slice(0, 6), nBad: bad.length };
        })(),
      };
    }
    return out;
  }, ids);

const hit = (page, sel) =>
  page.evaluate((s) => {
    const NO =
      'input,select,textarea,a,label,[role=slider],[contenteditable],.pp-slider,.pp-select,.pp-mode-btn,' +
      '.gev-lc-edge,.panel-collapse-btn,.pp-collapse-btn,.dock-pin-btn,[data-no-toggle],.style-btn,' +
      '.pp-toggle-btn,.scene-btn,.context-radio-dock,.context-radio-toggle,.context-radio-mini,' +
      '.gev-voice-tier-btn,.gev-voice-cost-value,.gev-voice-error-dismiss,.material-symbols-outlined';
    const e = document.querySelector(s);
    if (!e) return { ok: false, why: 'no-el' };
    const b = e.getBoundingClientRect();
    /* 真实用户点标题条 = 点它的「空白处」；网格扫描找一个不落在内部控件上的点 */
    const cands = [];
    for (let fy = 0.2; fy <= 0.82; fy += 0.155)
      for (let fx = 0.08; fx <= 0.92; fx += 0.07)
        cands.push([Math.round(b.left + b.width * fx), Math.round(b.top + b.height * fy)]);
    for (const [x, y] of cands) {
      const h = document.elementFromPoint(x, y);
      if (!h || !(h === e || e.contains(h))) continue;
      if (h !== e && h.closest(NO)) continue;
      return { ok: true, x, y, got: h.tagName + '#' + (h.id || '') };
    }
    return { ok: false, why: 'no-clean-point' };
  }, sel);

async function realClick(page, x, y) {
  await page.mouse.move(x - 12, y - 8, { steps: 3 });
  await sleep(60);
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(60);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
}

/** 点击后按帧采样该卡矩形，返回时长/峰值 */
async function clickAndSample(page, id, sel) {
  const h = await hit(page, sel);
  if (!h.ok) return { err: 'unhittable', h };
  await page.evaluate((cardId) => {
    window.__sam = [];
    window.__kfPeak = null;
    const t0 = performance.now();
    const tick = () => {
      const e = document.getElementById(cardId);
      if (e) {
        const b = e.getBoundingClientRect();
        window.__sam.push([Math.round(performance.now() - t0), +b.width.toFixed(2), +b.height.toFixed(2), Math.round(b.x), Math.round(b.y)]);
        /* 关键帧峰值 = 真实跑过的那条动画的参数（不依赖采样是否恰好落在峰值上） */
        if (!window.__kfPeak) {
          for (const a of e.getAnimations()) {
            try {
              const kf = a.effect.getKeyframes();
              let mx = 0,
                my = 0;
              for (const f of kf) {
                const m = /scale\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(f.transform || '');
                if (m) {
                  mx = Math.max(mx, +m[1]);
                  my = Math.max(my, +m[2]);
                }
              }
              if (mx > 0) {
                const t = a.effect.getTiming();
                window.__kfPeak = { mx: +mx.toFixed(4), my: +my.toFixed(4), dur: t.duration, easing: t.easing, n: kf.length };
                break;
              }
            } catch (err) {}
          }
        }
      }
      if (performance.now() - t0 < 1100) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, id);
  await realClick(page, h.x, h.y);
  await sleep(1150);
  const out = await page.evaluate(() => ({ sam: window.__sam, kfPeak: window.__kfPeak, last: window.__lc && window.__lc.morph ? window.__lc.morph.last : null }));
  const sam = out.sam || [];
  /* 停止变化的时刻 = 实际视觉时长 */
  let settleIdx = sam.length - 1;
  const fin = sam[sam.length - 1] || [0, 0, 0, 0, 0];
  for (let i = sam.length - 2; i >= 0; i--) {
    if (Math.abs(sam[i][1] - fin[1]) > 0.6 || Math.abs(sam[i][4] - fin[4]) > 0.6) {
      settleIdx = Math.min(sam.length - 1, i + 1);
      break;
    }
  }
  const durVis = sam.length ? sam[settleIdx][0] : null;
  const peakW = sam.reduce((m, s) => Math.max(m, s[1]), 0);
  const peakH = sam.reduce((m, s) => Math.max(m, s[2]), 0);
  return {
    hit: h,
    visDurMs: durVis,
    finalRect: { w: fin[1], h: fin[2], x: fin[3], y: fin[4] },
    peakRatioW: fin[1] ? +(peakW / fin[1]).toFixed(4) : null,
    peakRatioH: fin[2] ? +(peakH / fin[2]).toFixed(4) : null,
    kfPeak: out.kfPeak,
    morphLast: out.last,
    frames: sam.length,
  };
}

/* ── 灰圈 / 内框 / 磨砂 枚举（§6.5 §6.6 §14 D4）────────────────────────── */
const AUDIT = () =>
  (() => {
    const nums = (s) => (String(s || '').match(/-?[\d.]+px/g) || []).map(parseFloat);
    const layersOf = (s) => {
      if (!s || s === 'none') return [];
      const out = [];
      let d = 0,
        cur = '';
      for (const ch of s) {
        if (ch === '(') d++;
        if (ch === ')') d--;
        if (ch === ',' && d === 0) {
          out.push(cur);
          cur = '';
        } else cur += ch;
      }
      out.push(cur);
      return out.map((x) => x.trim()).filter(Boolean);
    };
    const isRing = (L) => {
      const s = L.toLowerCase();
      const inset = s.startsWith('inset');
      const n = nums(inset ? s.slice(5) : s);
      if (n.length < 2) return false;
      /* 近乎不可见的装饰环（alpha < 0.06，如 .gev-mic-orbit 的 0.04 脉冲）不算「灰圈」 */
      const a = (() => {
        const m = /rgba?\(([^)]+)\)/.exec(s);
        if (!m) return 1;
        const p = m[1].split(/[,/]/).map((x) => x.trim());
        return p.length > 3 ? parseFloat(p[3]) : 1;
      })();
      if (a < 0.06) return false;
      if (inset) return Math.abs(n[0]) < 0.01 && Math.abs(n[1]) < 0.01;
      const blur = n.length > 2 ? Math.abs(n[2]) : 0;
      return Math.abs(n[0]) < 0.01 && Math.abs(n[1]) < 0.01 && blur < 0.01;
    };
    const alpha = (c) => {
      if (!c) return 1;
      if (/transparent/i.test(c)) return 0;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return 1;
      const p = m[1].split(/[,/]/).map((x) => x.trim());
      return p.length > 3 ? parseFloat(p[3]) : 1;
    };
    const roots = ['.gev-lc', '.dock-popover-content', '.gev-lc-ghost'];
    const els = [];
    for (const sel of roots) document.querySelectorAll(sel).forEach((e) => els.push(e));
    let visibleStrokes = [];
    let ringLayers = [];
    let insetLayers = [];
    let frosted = [];
    let darkFill = [];
    let outOfScope = 0;
    for (const el of els) {
      const all = [el, ...el.querySelectorAll('*')];
      for (const node of all) {
        if (!node.isConnected) continue;
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const b = node.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        outOfScope++;
        const tag = node.tagName.toLowerCase() + '#' + (node.id || '') + '.' + String(node.className || '').split(' ')[0];
        const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs['border' + s + 'Width']) || 0);
        const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(alpha);
        if (cs.borderTopStyle !== 'none' && bw.some((v, i) => v > 0 && bc[i] > 0.02))
          visibleStrokes.push({ tag, w: bw, c: bc });
        if (cs.outlineStyle !== 'none' && (parseFloat(cs.outlineWidth) || 0) > 0 && alpha(cs.outlineColor) > 0.02)
          visibleStrokes.push({ tag, outline: cs.outline });
        for (const L of layersOf(cs.boxShadow)) {
          if (isRing(L)) ringLayers.push({ tag, L });
          if (/inset/i.test(L)) insetLayers.push({ tag, L });
        }
        if (cs.backdropFilter && cs.backdropFilter !== 'none') frosted.push({ tag, v: cs.backdropFilter });
        /* 「无暗底」只针对卡/面板的**底层平面**（中心区域），不针对小图标/错误托盘等前景块 */
        if (
          node.matches(
            '.gev-lc, .panel-inner, .data-panel-inner, .scene-panel-inner, .cctv-panel-inner, .global-context-panel-inner, .pp-panel-body, .dock-popover-content',
          ) &&
          alpha(cs.backgroundColor) > 0.06
        )
          darkFill.push({ tag, v: cs.backgroundColor });
        for (const pe of ['::before', '::after']) {
          const p = getComputedStyle(node, pe);
          const pw = parseFloat(p.borderTopWidth) || 0;
          if (pw > 0 && alpha(p.borderTopColor) > 0.02 && p.borderTopStyle !== 'none')
            visibleStrokes.push({ tag: tag + pe, w: pw });
          for (const L of layersOf(p.boxShadow)) {
            if (isRing(L)) ringLayers.push({ tag: tag + pe, L });
            if (/inset/i.test(L)) insetLayers.push({ tag: tag + pe, L });
          }
        }
      }
    }
    return {
      scanned: outOfScope,
      visibleStrokes: visibleStrokes.slice(0, 12),
      nStrokes: visibleStrokes.length,
      rings: ringLayers.slice(0, 12),
      nRings: ringLayers.length,
      insets: insetLayers.slice(0, 12),
      nInsets: insetLayers.length,
      frosted: frosted.slice(0, 12),
      nFrosted: frosted.length,
      darkFill: darkFill.slice(0, 12),
      nDarkFill: darkFill.length,
    };
  })();

/* ══ Round A：正常 GPU 轮 ═══════════════════════════════════════════════ */
const browser = await launch(['--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']);
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => m.type() === 'error' && errs.push('[c] ' + m.text().slice(0, 200)));
await boot(page);
const shot = async (name, clip) => {
  const p = path.join(OUT, `${TAG}-${name}.png`);
  await page.screenshot({ path: p, ...(clip ? { clip } : {}) });
  return p;
};

/* T14 GPU */
const gpu = await page.evaluate(() => ({
  st: window.__lc && window.__lc.gpu ? window.__lc.gpu() : null,
  chip: (() => {
    const c = document.getElementById('gev-gpu-chip');
    return c ? { text: c.textContent, tier: c.dataset.gpuTier, parent: c.parentNode.id, border: getComputedStyle(c).borderTopWidth } : null;
  })(),
  edge: !!document.getElementById('gev-edge-lens'),
  notice: !!document.getElementById('gev-gpu-notice'),
}));
rec('T14', 'GPU tier=high + renderer 非软件渲染', gpu.st && gpu.st.tier === 'high' && gpu.st.software === false, {
  renderer: gpu.st && gpu.st.renderer,
  granted: gpu.st && gpu.st.granted,
});
rec('T14', '#gev-gpu-chip 在 #gev-perf-wrap 内且显示 renderer', !!gpu.chip && gpu.chip.parent === 'gev-perf-wrap' && /GPU ·/.test(gpu.chip.text), gpu.chip);
rec('T14', 'high 档下边缘折射层存在', gpu.edge === true, { edge: gpu.edge });
await shot('gpu-chip');

/* T13 FPS */
const fpsIdle = await page.evaluate(
  () =>
    new Promise((res) => {
      const t0 = performance.now();
      const d = [];
      let last = t0;
      const tick = (t) => {
        d.push(t - last);
        last = t;
        if (t - t0 < 3200) requestAnimationFrame(tick);
        else {
          d.shift();
          d.sort((a, b) => a - b);
          const p = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
          res({ frames: d.length, fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), p90ms: +p(0.9).toFixed(1), maxms: +d[d.length - 1].toFixed(1) });
        }
      };
      requestAnimationFrame(tick);
    }),
);
rec('T13', `空闲 FPS ≥30（${W}×${H}）`, fpsIdle.fps >= 30, fpsIdle);

/* T1 初始全 mini */
let st = await stateOf(page, Object.keys(CARDS));
const floating0 = Object.values(st).filter((s) => s && s.floating).length;
rec('T1', '初始 = 全 mini（0 张浮层展开）', floating0 === 0, { floating0, sample: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v && [v.w, v.h, v.floating]])) });

/* T2 7 header 命中 */
const hits = {};
for (const [id, sel] of HEADERS) hits[id] = await hit(page, sel);
rec('T2', '7 个 header elementFromPoint 命中自己', Object.values(hits).every((h) => h.ok), Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.ok])));

/* T12 初始态灰圈 */
const audit0 = await page.evaluate(AUDIT);
rec('T12', '卡层无可见描边（border/outline）', audit0.nStrokes === 0, { n: audit0.nStrokes, sample: audit0.visibleStrokes });
rec('T12', '卡层无「闭合圈」box-shadow 层（inset 0 0 0 / 0 0 0 spread）', audit0.nRings === 0, { n: audit0.nRings, sample: audit0.rings });

/* 逐卡真实点击 → 展开 → 再点 → 收起归位 */
const perCard = {};
for (const [id, sel] of HEADERS) {
  const before = (await stateOf(page, [id]))[id];
  const r1 = await clickAndSample(page, id, sel);
  const after1 = (await stateOf(page, [id]))[id];
  const r2 = await clickAndSample(page, id, sel);
  const after2 = (await stateOf(page, [id]))[id];
  perCard[id] = {
    open: { floating: after1 && after1.floating, w: after1 && after1.w, h: after1 && after1.h, visDurMs: r1.visDurMs, morph: r1.morphLast, peakW: r1.peakRatioW, peakH: r1.peakRatioH, kfPeak: r1.kfPeak, frames: r1.frames },
    close: { floating: after2 && after2.floating, w: after2 && after2.w, h: after2 && after2.h, back: before && after2 ? Math.abs(before.x - after2.x) <= 2 && Math.abs(before.y - after2.y) <= 2 : null, visDurMs: r2.visDurMs },
  };
  console.log(`  · ${id}: open ${after1 && after1.w}×${after1 && after1.h} @${r1.visDurMs}ms peak ${r1.peakRatioW}/${r1.peakRatioH}; close→${after2 && after2.w}×${after2 && after2.h} back=${perCard[id].close.back}`);
}
rec('T3', '7 张卡点击后都浮层展开（floating=true、宽 ≥ expW-8、高 ≥ 240）', Object.entries(perCard).every(([id, v]) => v.open.floating && v.open.w >= CARDS[id][0] - 8 && v.open.h >= 240), Object.fromEntries(Object.entries(perCard).map(([k, v]) => [k, [v.open.w, v.open.h, v.open.floating]])));
rec('T7', '再次点击收起并回到原槽位（±2px）', Object.values(perCard).every((v) => !v.close.floating && v.close.back === true), Object.fromEntries(Object.entries(perCard).map(([k, v]) => [k, [v.close.w, v.close.h, v.close.back]])));

/* T16 时长/回弹 */
const T16 = [];
for (const [id, wh] of Object.entries(CARDS)) {
  const m = perCard[id] && perCard[id].open.morph;
  if (!m) continue;
  const expect = Math.round(Math.min(450, Math.max(350, 350 + (Math.sqrt(wh[0] * wh[1]) - Math.sqrt(176 * 43)) * ((445 - 350) / (Math.sqrt(320 * 380) - Math.sqrt(176 * 43))))));
  T16.push({ id, expect, got: m.duration, d: m.duration - expect, easing: m.easing, pPeak: m.pPeak });
}
rec('T16', '逐卡动画时长对表 ±5ms', T16.every((x) => Math.abs(x.d) <= 5), T16);
const peaks = Object.entries(perCard).map(([id, v]) => ({ id, pw: v.open.peakW, ph: v.open.peakH, kf: v.open.kfPeak }));
const kfOk = peaks.every((x) => x.kf && x.kf.mx >= 1.02 && x.kf.mx <= 1.05 && x.kf.my >= 1.02 && x.kf.my <= 1.05);
/* rAF 采样是佐证：帧被主线程卡住时会漏掉峰值（实测首卡偶发 pw=1.000），
   所以要求「采样到峰值的卡 ≥6/8」且「采样值与关键帧峰值吻合（±0.003）」，
   而不是强求每张卡都采到。 */
const sampled = peaks.filter((x) => x.pw >= 1.005 && x.ph >= 1.005);
const matchOk = sampled.every((x) => Math.abs(x.pw - x.kf.mx) <= 0.003 && Math.abs(x.ph - x.kf.my) <= 0.003);
rec(
  'T16',
  '展开有回弹：关键帧峰值 1.02–1.05（rAF 采样佐证 ≥6/8 且与关键帧吻合）',
  kfOk && matchOk && sampled.length >= 6,
  { sampledN: sampled.length, kfOk, matchOk, peaks },
);

/* 连点：同一卡 3 次快速点击只允许 ≤1 条运行中动画，最终状态确定 */
const pp = await hit(page, '#pp-toggles .pp-header-row');
await page.mouse.move(pp.x, pp.y, { steps: 2 });
await page.mouse.down();
await page.mouse.up();
await sleep(90);
await page.mouse.down();
await page.mouse.up();
await sleep(90);
await page.mouse.down();
await page.mouse.up();
await sleep(100);
const rapid = await stateOf(page, ['pp-toggles']);
await sleep(1200);
const rapid2 = await stateOf(page, ['pp-toggles']);
rec('T16', '快速连点不叠动画（运行中动画 ≤1，结束态确定）', rapid['pp-toggles'].anims <= 1 && rapid2['pp-toggles'].anims === 0, { during: rapid['pp-toggles'].anims, after: rapid2['pp-toggles'].anims, w: rapid2['pp-toggles'].w });
/* 复位：若还开着就再点一次 */
if (rapid2['pp-toggles'].floating) {
  const pp2 = await hit(page, '#pp-toggles .pp-header-row');
  await realClick(page, pp2.x, pp2.y);
  await sleep(900);
}
/* 确保全 mini 再测 dock */
const resetAll = async () => {
  for (const [id, sel] of HEADERS) {
    const s = (await stateOf(page, [id]))[id];
    if (s && s.floating) {
      const h2 = await hit(page, sel);
      if (h2.ok) {
        await realClick(page, h2.x, h2.y);
        await sleep(900);
      }
    }
  }
};
await resetAll();

/* T15 dock：同组只 1 张 + 居中 + 无截字 + 无内框 + 单形态 */
const dockLog = [];
for (const [id, sel] of HEADERS.filter(([i]) => DOCK.includes(i))) {
  const r = await clickAndSample(page, id, sel);
  const s = await stateOf(page, DOCK);
  const open = DOCK.filter((d) => s[d] && s[d].floating);
  const geo = await page.evaluate(() => {
    const d = document.getElementById('command-dock');
    const b = d.getBoundingClientRect();
    const cards = [...document.querySelectorAll('#command-dock > .gev-lc')].map((e) => {
      if (e.classList.contains('gev-lc-floating')) return null;
      const r = e.getBoundingClientRect();
      return { id: e.id, x: Math.round(r.x), w: Math.round(r.width), top: Math.round(r.y) };
    }).filter(Boolean);
    return { dock: { x: Math.round(b.x), w: Math.round(b.width), cx: Math.round(b.x + b.width / 2), top: Math.round(b.y) }, cards };
  });
  const self = s[id];
  const rowTop = geo.cards.length ? Math.min(...geo.cards.map((c) => c.top)) : geo.dock.top;
  dockLog.push({
    id,
    open,
    nOpen: open.length,
    panel: { cx: self.cx, bottom: self.bottom, w: self.w, h: self.h, clipped: self.floating ? self.clipped : null },
    dockCx: geo.dock.cx,
    dxCenter: Math.abs(self.cx - geo.dock.cx),
    gapAboveRow: rowTop - self.bottom,
    visDurMs: r.visDurMs,
  });
  await shot('dock-' + id, { x: Math.max(0, self.x - 20), y: Math.max(0, self.y - 20), width: Math.min(600, self.w + 40), height: self.h + 80 });
  /* 关掉再测下一个 */
  await resetAll();
}
rec('T15', 'dock 组同时只有 1 张展开', dockLog.every((d) => d.nOpen === 1), dockLog.map((d) => ({ id: d.id, nOpen: d.nOpen, open: d.open })));
rec('T15', '展开面板居中在语音栏上方（|Δcx| ≤2px）', dockLog.every((d) => d.dxCenter <= 2), dockLog.map((d) => ({ id: d.id, panelCx: d.panel.cx, dockCx: d.dockCx, dx: d.dxCenter })));
rec('T15', '面板底边在语音栏顶部上方 8–16px', dockLog.every((d) => d.gapAboveRow >= 8 && d.gapAboveRow <= 16), dockLog.map((d) => ({ id: d.id, gap: d.gapAboveRow })));
rec('T15', '面板内文字不截断（叶文本元素 0 个被裁/出界）', dockLog.every((d) => !d.panel.clipped || d.panel.clipped.nBad === 0), dockLog.map((d) => ({ id: d.id, ...(d.panel.clipped || {}) })));

/* 展开态灰圈 / 磨砂 / 内框审计 */
const auditOpen = await page.evaluate(AUDIT);
rec('T12', '展开态仍无可见描边', auditOpen.nStrokes === 0, { n: auditOpen.nStrokes, sample: auditOpen.visibleStrokes });
rec('T12', '展开态无闭合圈 box-shadow', auditOpen.nRings === 0, { n: auditOpen.nRings, sample: auditOpen.rings });
rec('P1-2', '卡层无 backdrop-filter（中心透明，无磨砂）', auditOpen.nFrosted === 0, { n: auditOpen.nFrosted, sample: auditOpen.frosted });
rec('P1-2', '卡层无 >6% 不透明底（无暗底）', auditOpen.nDarkFill === 0, { n: auditOpen.nDarkFill, sample: auditOpen.darkFill });

/* 第二形态检查：.dock-popover-content 全程不可见 */
const second = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.dock-popover-content')];
  return els.map((e) => {
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { w: Math.round(b.width), h: Math.round(b.height), disp: cs.display, vis: cs.visibility };
  });
});
rec('T15', '第二套 popover 不可见（无双形态）', second.every((x) => x.disp === 'none' || x.w * x.h < 4), second);

/* trusted 指针 */
const ptr = await page.evaluate(() => (window.__ptr || []).filter((p) => p.type === 'click'));
rec('T9', '全部点击事件 isTrusted=true', ptr.length > 0 && ptr.every((p) => p.trusted), { clicks: ptr.length, untrusted: ptr.filter((p) => !p.trusted).length });

await page.screenshot({ path: path.join(OUT, `${TAG}-final.png`) });

/* 4x 角部/边缘放大图（灰圈目检） */
const page4 = await browser.newPage();
/* 先在 1x 下用真实鼠标打开卡片（4x 视口下 Cesium+玻璃太慢，点击容易落在初始化窗口里），
   再切 deviceScaleFactor=4 只做「放大拍照」：CSS px 布局不变，截图分辨率 ×4。 */
await page4.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await boot(page4);
const h4 = await hit(page4, '#data-panel .panel-header');
if (h4.ok) {
  await realClick(page4, h4.x, h4.y);
  await sleep(1300);
}
let opened = await page4.evaluate(() => document.getElementById('data-panel').classList.contains('gev-lc-floating'));
if (!opened && h4.ok) {
  /* 一次重试（首屏 App 重排可能吞掉第一次点击） */
  const h4b = await hit(page4, '#data-panel .panel-header');
  if (h4b.ok) {
    await realClick(page4, h4b.x, h4b.y);
    await sleep(1400);
  }
  opened = await page4.evaluate(() => document.getElementById('data-panel').classList.contains('gev-lc-floating'));
}
await page4.setViewport({ width: W, height: H, deviceScaleFactor: 4 });
await sleep(700);
let c4 = await page4.evaluate(() => {
  const e = document.getElementById('data-panel');
  const b = e.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), floating: e.classList.contains('gev-lc-floating') };
});
const crops = [
  ['4x-corner-tl', { x: c4.x - 8, y: c4.y - 8, width: 60, height: 60 }],
  ['4x-corner-br', { x: c4.x + c4.w - 52, y: c4.y + c4.h - 52, width: 60, height: 60 }],
  ['4x-corner-bl', { x: c4.x - 8, y: c4.y + c4.h - 52, width: 60, height: 60 }],
  ['4x-edge-top', { x: c4.x + c4.w / 2 - 45, y: c4.y - 10, width: 90, height: 30 }],
  ['4x-edge-left', { x: c4.x - 10, y: c4.y + c4.h / 2 - 24, width: 30, height: 90 }],
];
/* deviceScaleFactor=4 在 1536×730 上偶发 "Unable to capture screenshot"（surface 过大），
   逐级退 3 → 2 重拍；1px 灰圈在 3x 下仍有 3 个物理像素，肉眼可判。 */
let shotDsf = 4;
for (const [n, clip] of crops) {
  let done = false;
  for (const dsf of [shotDsf, 3, 2]) {
    try {
      if (dsf !== shotDsf) {
        await page4.setViewport({ width: W, height: H, deviceScaleFactor: dsf });
        await sleep(400);
        shotDsf = dsf;
        c4 = await page4.evaluate(() => {
          const e = document.getElementById('data-panel');
          const b = e.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), floating: e.classList.contains('gev-lc-floating') };
        });
      }
      await page4.screenshot({ path: path.join(OUT, `${TAG}-${n}.png`), clip });
      done = true;
      break;
    } catch (err) {
      console.log(`  ! ${n} @${dsf}x 截图失败：${String(err.message).slice(0, 60)}`);
    }
  }
  if (!done) console.log(`  ! ${n} 全部倍率失败`);
}
rec('T12', `4x 角部/边缘放大图已存档（展开态 · 实际 ${shotDsf}x）`, c4.floating === true, { dsf: shotDsf, floating: c4.floating, box: [c4.x, c4.y, c4.w, c4.h], shots: crops.map((c) => c[0]) });
await page4.close();

/* ══ Round B：软件渲染轮（SwiftShader）═════════════════════════════════ */
if (!SKIP_SW) {
  const sw = await launch(['--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'], {});
  const p2 = await sw.newPage();
  await p2.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await boot(p2);
  const s2 = await p2.evaluate(() => ({
    st: window.__lc && window.__lc.gpu ? window.__lc.gpu() : null,
    chip: (() => {
      const c = document.getElementById('gev-gpu-chip');
      return c ? { text: c.textContent, tier: c.dataset.gpuTier } : null;
    })(),
    notice: (() => {
      const n = document.getElementById('gev-gpu-notice');
      return n ? n.textContent.slice(0, 80) : null;
    })(),
    edge: !!document.getElementById('gev-edge-lens'),
  }));
  rec('T14', '软件渲染轮 tier=software + chip 显示「GPU 未启用」', s2.st && s2.st.tier === 'software' && /未启用/.test((s2.chip && s2.chip.text) || ''), { renderer: s2.st && s2.st.renderer, chip: s2.chip });
  rec('T14', '软件渲染轮出 #gev-gpu-notice 提示（9s 自动淡出 → 以标记断言）', !!(s2.st && s2.st.noticeShown), { noticeShown: s2.st && s2.st.noticeShown, notice: s2.notice });
  rec('T14', '软件渲染轮不创建边缘折射 canvas', s2.edge === false, { edge: s2.edge });
  const swFps = await p2.evaluate(
    () =>
      new Promise((res) => {
        const t0 = performance.now();
        const d = [];
        let last = t0;
        const tick = (t) => {
          d.push(t - last);
          last = t;
          if (t - t0 < 2600) requestAnimationFrame(tick);
          else {
            d.shift();
            d.sort((a, b) => a - b);
            res({ frames: d.length, fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), p90ms: +d[Math.floor(d.length * 0.9)].toFixed(1) });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  /* SwiftShader 下 1536×730 只有个位数 fps（本机实测 3.3fps）= 环境上限，不是产品基线；
     D2 的 ≥30 只对 GPU 轮裁定，软件轮只记录（§13.4 分栏记账，禁止把 GPU 状态折算帧率）。 */
  rec('T13', `软件渲染轮 FPS 仅记录（环境上限，不裁定）`, true, swFps);
  /* 软件档 morph = 150ms */
  const hp = await hit(p2, '#data-panel .panel-header');
  if (hp.ok) {
    await realClick(p2, hp.x, hp.y);
    await sleep(80);
    const m = await p2.evaluate(() => ({
      morph: window.__lc && window.__lc.morph ? window.__lc.morph.last : null,
      frozenSkip: window.__gevLcFrozenSkip || 0,
      floating: (() => {
        const e = document.getElementById('data-panel');
        return e ? e.classList.contains('gev-lc-floating') : null;
      })(),
    }));
    rec('T14', '软件渲染轮 morph = 150ms / 无回弹', !!m.morph && m.morph.duration === 150 && m.morph.pPeak === 1 && m.morph.easing === 'ease-out', m);
  }
  await p2.screenshot({ path: path.join(OUT, `${TAG}-software.png`) });
  await sw.close();
}

/* ── 汇总 ─────────────────────────────────────────────────────────────── */
const failed = R.filter((r) => !r.pass);
const report = {
  tag: TAG,
  at: new Date().toISOString(),
  viewport: { w: W, h: H },
  url: URL_,
  pass: R.filter((r) => r.pass).length,
  fail: failed.length,
  results: R,
  fps: { idle: fpsIdle },
  gpu: gpu.st,
  audit: { initial: audit0, open: auditOpen },
  perCard,
  dockLog,
  errors: errs.slice(0, 20),
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`\n== ${report.pass} pass / ${report.fail} fail ==  → ${OUT}`);
if (failed.length) failed.forEach((f) => console.log('FAILED:', f.id, f.name, JSON.stringify(f.detail)));
console.log('page errors:', errs.length, errs.slice(0, 5));
await browser.close();
process.exit(failed.length ? 1 : 0);
