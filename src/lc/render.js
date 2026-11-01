/* ============================================================================
   src/lc/render.js —— L2 Renderer（单帧应用 Box；只写一次）
   ----------------------------------------------------------------------------
   架构 §3.2 L2：
     apply(map<id,Box>) → 相位属性 + inline 几何（一次）+ WAAPI 编排
     内容层不动（不改 App 内部 DOM 结构、不加底、不加 blur）
   本模块是卡片几何的**唯一写入者**；动画只走 morph.js（同一元素永远 ≤1 条）。
   ========================================================================== */
import * as bridge from '../bridge.js';
import * as Morph from './morph.js';
import { CARDS, CARD_IDS } from './cards.js';
import { PHASE } from './controller.js';

const px = (v) => Math.round(v) + 'px';
const same = (a, b, tol = 1) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
/** snapshot 用 {x,y,w,h}；Morph 用 {left,top,width,height}（FLIP 起点）。 */
const toFlip = (r) => (r ? { left: r.x, top: r.y, width: r.w, height: r.h } : null);

/* ── 玻璃状态（Phase8B：D1·G12 / D2·G6·G7 / #2 / #6 / D3 的 morph 钩子）───────
   唯一驱动者，只写 CSS 变量与 data-* 属性：不改几何、不改文字布局、不加第二层玻璃。
   下游（8C 的 lens shader）读 window.__lc.glass.state() 拿同一份状态，避免两套真相。
   与 tokens.json 的 material 段逐值对应（本文件不读 JSON，值写在这里并单测比对）。 */
export const GLASS = Object.freeze({
  variants: ['regular', 'clear'],
  defaultVariant: 'clear',
  scrim: { threshold: 0.6, alpha: 0.35, auto: false },
  highlight: { base: 0.1, max: 0.25, reachPx: 120 },
  shadow: { hz: 5, min: 0.1, max: 0.3, lerp: 0.5 },
  morphLens: { restoreFrames: 1 },
});

const nowMs = () => {
  try {
    return +performance.now().toFixed(1);
  } catch (_) {
    return Date.now();
  }
};

/**
 * 玻璃状态接口。
 *  · D1：material 枚举 regular | clear；Clear + 背景亮度 > 0.6 → 35% scrim（默认只断言/日志）
 *  · D2/#2：指针 x → --lc-gloss-x（1px 上沿高光弧段随指针，opacity ≤ 0.25）
 *  · D2/G7：5Hz 采样背后平均亮度 → --lc-shadow-a（每拍 50% lerp）
 *  · D3：morphBegin/morphEnd 关/恢复 __gevEdge（结束 1 帧后按进入时的 cfg 恢复）
 *  · #6/D6：文字 scrim 走 material.css §17，这里不管
 */
export function createGlass({ adapter } = {}) {
  const S = {
    variant: GLASS.defaultVariant,
    scrimMode: GLASS.scrim.auto ? 'auto' : 'off',
    scrim: false,
    luma: null,
    lumaSrc: 'none',
    lumaAt: 0,
    lumaSamples: 0,
    lumaBlack: 0,
    sampling: true,
    shadowA: 0.14,
    gloss: { x: 50, a: GLASS.highlight.base, writes: 0, skipped: 0, cards: {} },
    pointer: { x: -1, y: -1, moves: 0 },
    morph: { active: 0, begins: 0, restores: 0, lastBeginAt: 0, lastRestoreAt: 0, degradeAt: 0, edge: null, why: '' },
    assert: { scrim: 0, scrimAbove: false, lastAt: 0, lastLuma: null },
    log: [],
  };
  let started = false;
  let rafPending = false;
  let restoreRaf = 0;
  let rects = [];
  let rectsAt = 0;
  /* 2026-11-01：上次写入每张卡的高光值。用于「值没变就不写」——
     指针静止时把 9 卡 × 2 个 CSS 变量的逐帧写入降到 0。 */
  const lastGloss = new Map();
  let sampleAcc = 0;
  let lastTick = 0;
  let probe = null;
  let pctx = null;

  function note(kind, extra) {
    S.log.push({ kind, at: nowMs(), ...(extra || {}) });
    if (S.log.length > 40) S.log.shift();
  }

  const cardElements = () =>
    CARD_IDS.map((id) => {
      const el = adapter && typeof adapter.el === 'function' ? adapter.el(id) : null;
      return el ? { id, el } : null;
    }).filter(Boolean);

  /* ── 落盘（CSS 变量 + data-*）────────────────────────────────────────── */
  function skin(el) {
    if (!el || !el.style) return;
    const ds = el.dataset || {};
    if (!ds.lcMaterial) el.dataset.lcMaterial = S.variant;
    el.dataset.lcScrim = S.scrim ? 'on' : 'off';
    el.style.setProperty('--lc-shadow-a', S.shadowA.toFixed(3));
    el.style.setProperty('--lc-gloss-x', S.gloss.x.toFixed(1) + '%');
    el.style.setProperty('--lc-gloss-a', S.gloss.a.toFixed(3));
    if (S.scrim) el.style.setProperty('--lc-scrim-a', String(GLASS.scrim.alpha));
    else el.style.removeProperty('--lc-scrim-a');
  }
  function writeAll() {
    for (const { el } of cardElements()) skin(el);
  }

  function setScrimFlag(on) {
    const v = !!on;
    if (v === S.scrim) return v;
    S.scrim = v;
    writeAll();
    note('scrim-set', { on: v, luma: S.luma, mode: S.scrimMode });
    return v;
  }

  /** 'off' | 'on' | 'auto'（auto = 亮度断言通过后自动叠） */
  function setScrim(mode) {
    const m = ['off', 'on', 'auto'].includes(mode) ? mode : 'off';
    S.scrimMode = m;
    if (m === 'off') setScrimFlag(false);
    else if (m === 'on') setScrimFlag(true);
    else setScrimFlag(S.variant === 'clear' && S.luma != null && S.luma > GLASS.scrim.threshold);
    return m;
  }

  function setMaterial(v) {
    const m = GLASS.variants.includes(v) ? v : GLASS.defaultVariant;
    S.variant = m;
    for (const { el } of cardElements()) el.dataset.lcMaterial = m;
    if (m !== 'clear') setScrimFlag(false);
    else if (S.scrimMode !== 'off') setScrimFlag(S.luma != null && S.luma > GLASS.scrim.threshold);
    note('material-set', { variant: m });
    return m;
  }

  /* ── D2/G7：背后平均亮度（5Hz）→ 阴影 alpha ──────────────────────────── */
  function mapCanvas() {
    try {
      const v = window.__gevViewer;
      if (v && v.scene && v.scene.canvas && v.scene.canvas.width) return v.scene.canvas;
    } catch (_) {}
    try {
      return document.querySelector('#cesiumContainer canvas, canvas.cesium-widget-canvas') || null;
    } catch (_) {
      return null;
    }
  }

  function applyLuma(luma, src) {
    if (!(luma >= 0 && luma <= 1)) return null;
    S.luma = +luma.toFixed(4);
    S.lumaAt = nowMs();
    S.lumaSamples += 1;
    S.lumaSrc = src || 'cesium';
    const target = GLASS.shadow.min + (GLASS.shadow.max - GLASS.shadow.min) * S.luma;
    /* 阴影 alpha 的逼近由 5Hz tick（stepShadow）驱动，这里只更新目标用的 luma */
    /* D1 亮度断言：边沿触发一次日志（默认只断言，不改观感） */
    const above = S.variant === 'clear' && S.luma > GLASS.scrim.threshold;
    if (above !== S.assert.scrimAbove) {
      S.assert.scrimAbove = above;
      S.assert.lastAt = nowMs();
      S.assert.lastLuma = S.luma;
      if (above) {
        S.assert.scrim += 1;
        note('scrim-assert', { luma: S.luma, threshold: GLASS.scrim.threshold, alpha: GLASS.scrim.alpha, mode: S.scrimMode });
        try {
          console.info(
            `[lc:glass] clear-scrim assert luma=${S.luma} > ${GLASS.scrim.threshold} → rgba(0,0,0,${GLASS.scrim.alpha}) (${S.scrimMode === 'off' ? 'log-only' : 'applied:' + S.scrimMode})`,
          );
        } catch (_) {}
        if (S.scrimMode !== 'off') setScrimFlag(true);
      } else if (S.scrimMode !== 'off') {
        setScrimFlag(false);
      }
    }
    writeAll();
    return S.luma;
  }

  function stepShadow() {
    if (S.luma == null) return null;
    const target = GLASS.shadow.min + (GLASS.shadow.max - GLASS.shadow.min) * S.luma;
    const next = Math.abs(target - S.shadowA) < 0.002 ? target : S.shadowA + (target - S.shadowA) * GLASS.shadow.lerp;
    if (next === S.shadowA) return null;
    S.shadowA = next;
    for (const { el } of cardElements()) el.style.setProperty('--lc-shadow-a', S.shadowA.toFixed(3));
    return S.shadowA;
  }

  function sampleLumaNow() {
    const c = mapCanvas();
    if (!c) {
      S.lumaSrc = 'no-canvas';
      return null;
    }
    if (!probe) {
      try {
        probe = document.createElement('canvas');
        probe.width = 8;
        probe.height = 8;
        pctx = probe.getContext('2d', { willReadFrequently: true });
      } catch (_) {
        probe = null;
        return null;
      }
    }
    if (!pctx) return null;
    try {
      pctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, 8, 8);
    } catch (e) {
      S.lumaSrc = 'readback-fail';
      return null;
    }
    let d;
    try {
      d = pctx.getImageData(0, 0, 8, 8).data;
    } catch (_) {
      S.lumaSrc = 'readback-fail';
      return null;
    }
    let sum = 0;
    let n = 0;
    let mx = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y;
      n += 1;
      if (y > mx) mx = y;
    }
    /* 全黑 = 没有 preserveDrawingBuffer 时的空缓冲，不能当「暗底」用 */
    if (mx < 1) {
      S.lumaBlack += 1;
      S.lumaSrc = 'black-readback';
      return null;
    }
    return applyLuma(sum / n / 255, 'cesium');
  }

  function tick(t) {
    if (!started) return;
    try {
      requestAnimationFrame(tick);
    } catch (_) {}
    const tnow = typeof t === 'number' ? t : nowMs();
    if (!lastTick) lastTick = tnow;
    sampleAcc += tnow - lastTick;
    lastTick = tnow;
    if (sampleAcc < 1000 / GLASS.shadow.hz) return;
    sampleAcc = 0;
    stepShadow(); /* 阴影逼近 = 5Hz（阴影动画本身，采样暂停也照跑） */
    if (!S.sampling) return; /* 验证时用 setSampling(false) 暂停真采样，注入亮度才不会被覆盖 */
    if (S.morph.active > 0) return; /* morph 期镜头层关闭、画面在变形，不采样 */
    try {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
    } catch (_) {}
    sampleLumaNow();
  }

  /* ── D2/#2：指针 → 上沿高光弧段 ──────────────────────────────────────── */
  /** 让几何缓存立刻失效（morph / 拖拽 / resize 后卡片的 rect 已变，
      不失效会让高光弧段落在旧位置上）。 */
  function invalidateRects() {
    rectsAt = 0;
  }

  function refreshRects(force) {
    const t = nowMs();
    if (!force && t - rectsAt < 250) return;
    rectsAt = t;
    rects = cardElements()
      .map(({ id, el }) => {
        try {
          const r = el.getBoundingClientRect();
          return { id, el, x: r.left, y: r.top, w: r.width, h: r.height };
        } catch (_) {
          return null;
        }
      })
      .filter((r) => r && r.w > 0);
  }

  function writeGloss() {
    refreshRects(false);
    const { x: pxs, y: pys } = S.pointer;
    let best = null;
    /* 先算完再统一写：避免「读 rect → 写 style → 再读 rect」的读写交替触发同步布局。
       注意 rects 已在 refreshRects 里读完，这里只做纯计算 + 写入。 */
    for (const r of rects) {
      const u = (pxs - r.x) / r.w;
      const gx = Math.min(92, Math.max(8, u * 100));
      const dxOut = Math.max(0, r.x - pxs, pxs - (r.x + r.w));
      const dyOut = Math.max(0, r.y - pys, pys - (r.y + r.h));
      const out = Math.max(dxOut, dyOut);
      const prox = pxs < 0 ? 0 : Math.max(0, 1 - out / GLASS.highlight.reachPx);
      const a = GLASS.highlight.base + (GLASS.highlight.max - GLASS.highlight.base) * prox;
      /* 值没变就不写：视觉完全等价（CSS 变量幂等），省掉无意义的重算与重绘。 */
      const prev = lastGloss.get(r.id);
      if (prev && Math.abs(prev.x - gx) < 0.05 && Math.abs(prev.a - a) < 0.005) {
        S.gloss.skipped += 1;
      } else {
        r.el.style.setProperty('--lc-gloss-x', gx.toFixed(1) + '%');
        r.el.style.setProperty('--lc-gloss-a', a.toFixed(3));
        lastGloss.set(r.id, { x: gx, a });
        S.gloss.writes += 1;
      }
      S.gloss.cards[r.id] = { x: +gx.toFixed(1), a: +a.toFixed(3) };
      if (!best || prox > best.prox) best = { prox, gx, a, id: r.id };
    }
    if (best) {
      S.gloss.x = +best.gx.toFixed(1);
      S.gloss.a = +best.a.toFixed(3);
      S.gloss.card = best.id;
    } else if (pxs < 0) {
      S.gloss.x = 50;
      S.gloss.a = GLASS.highlight.base;
      S.gloss.card = '';
    }
  }

  function setPointer(x, y) {
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    S.pointer.x = nx;
    S.pointer.y = ny;
    S.pointer.moves += 1;
    if (rafPending) return null;
    rafPending = true;
    try {
      requestAnimationFrame(() => {
        rafPending = false;
        writeGloss();
      });
    } catch (_) {
      rafPending = false;
      writeGloss();
    }
    return { x: nx, y: ny };
  }

  function onPointerMove(e) {
    if (!e) return;
    setPointer(e.clientX, e.clientY);
  }

  /* ── D3/G22：morph ↔ lens ───────────────────────────────────────────── */
  function lensDegrade(on, why) {
    const E = bridge.ensure('edge.lens', { global: '__gevEdge', owner: 'public/gev-edge-lens.js' });
    if (!E || typeof E.set !== 'function') {
      S.morph.edge = { skipped: true, why: why || '' };
      return false;
    }
    if (on) {
      let c = {};
      try {
        c = (typeof E.cfg === 'function' && E.cfg()) || {};
      } catch (_) {}
      S.morph.edge = { enabled: c.enabled !== false, rimAmt: c.rimAmt, dispGain: c.dispGain, bandAlpha: c.bandAlpha, band: c.band };
      if (S.morph.edge.enabled) {
        try {
          if (typeof E.off === 'function') E.off();
          else E.set({ enabled: false });
        } catch (_) {}
      }
      S.morph.degradeAt = nowMs();
      note('lens-degrade', { why: why || '', was: S.morph.edge.enabled });
      return true;
    }
    const p = S.morph.edge || {};
    if (p.skipped) return false;
    try {
      /* 只恢复「进入 morph 前本来就是开的」；用户手动 off 的保持关闭 */
      if (p.enabled) {
        if (typeof E.on === 'function') E.on();
        else E.set({ enabled: true });
      }
      const back = { enabled: !!p.enabled };
      if (p.band != null) back.band = p.band;
      if (p.rimAmt != null) back.rimAmt = p.rimAmt;
      if (p.dispGain != null) back.dispGain = p.dispGain;
      if (p.bandAlpha != null) back.bandAlpha = p.bandAlpha;
      E.set(back);
    } catch (_) {}
    S.morph.lastRestoreAt = nowMs();
    note('lens-restore', { ms: Math.round(S.morph.lastRestoreAt - S.morph.degradeAt), enabled: !!p.enabled });
    return true;
  }

  function morphBegin(why) {
    S.morph.active += 1;
    S.morph.begins += 1;
    S.morph.lastBeginAt = nowMs();
    S.morph.why = String(why || '');
    if (S.morph.active === 1) {
      lensDegrade(true, S.morph.why);
      invalidateRects(); /* 卡片即将变形：别让高光继续贴在旧 rect 上 */
    }
    return S.morph.active;
  }

  function morphEnd(why) {
    S.morph.active = Math.max(0, S.morph.active - 1);
    if (S.morph.active > 0) return S.morph.active;
    /* 结束「1 帧后」恢复：让最后一帧变形先出屏，再上玻璃 */
    try {
      if (restoreRaf) cancelAnimationFrame(restoreRaf);
      let frames = 0;
      const step = () => {
        frames += 1;
        if (frames < GLASS.morphLens.restoreFrames) {
          restoreRaf = requestAnimationFrame(step);
          return;
        }
        restoreRaf = 0;
        lensDegrade(false, why || S.morph.why);
        S.morph.restores += 1;
        invalidateRects(); /* 变形已结束：按新几何重算高光 */
      };
      restoreRaf = requestAnimationFrame(step);
    } catch (_) {
      lensDegrade(false, why || S.morph.why);
      S.morph.restores += 1;
    }
    return 0;
  }

  /* ── 生命周期 ───────────────────────────────────────────────────────── */
  function start() {
    if (started) return false;
    started = true;
    try {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      /* 视口变化后卡片几何全变，高光缓存必须立刻失效（否则贴旧位置）。 */
      window.addEventListener('resize', invalidateRects, { passive: true });
    } catch (_) {}
    writeAll();
    try {
      requestAnimationFrame(tick);
    } catch (_) {}
    return true;
  }

  function state() {
    return {
      variant: S.variant,
      variants: GLASS.variants.slice(),
      scrimMode: S.scrimMode,
      scrim: S.scrim,
      scrimAlpha: S.scrim ? GLASS.scrim.alpha : 0,
      luma: S.luma,
      lumaSrc: S.lumaSrc,
      lumaSamples: S.lumaSamples,
      lumaBlack: S.lumaBlack,
      lumaAt: S.lumaAt,
      sampling: S.sampling,
      shadowA: +S.shadowA.toFixed(4),
      gloss: { x: S.gloss.x, a: S.gloss.a, writes: S.gloss.writes, skipped: S.gloss.skipped, card: S.gloss.card || '', cards: { ...S.gloss.cards } },
      pointer: { ...S.pointer },
      morph: { ...S.morph, edge: S.morph.edge ? { ...S.morph.edge } : null },
      assert: { ...S.assert },
      tokens: GLASS,
      started,
    };
  }

  return {
    state,
    skin,
    start,
    setMaterial,
    setScrim,
    setPointer,
    invalidateRects,
    sampleLumaNow,
    /* 验证开关：false = 暂停 5Hz 真采样（注入亮度不被覆盖），true = 恢复 */
    setSampling: (on) => {
      S.sampling = !!on;
      return S.sampling;
    },
    /* 确定性验证入口：直接注入亮度，走完整条「断言 → scrim → 阴影」链路 */
    __setLuma: (v) => applyLuma(Number(v), 'injected'),
    morphBegin,
    morphEnd,
    log: () => S.log.slice(),
    tokens: () => GLASS,
  };
}


export function createRenderer({ adapter, onAnimEnd, morph = Morph }) {
  const prev = new Map(); // id → {phase, box, push, staged}
  const anims = new Map(); // id → Animation
  const stats = { opens: 0, closes: 0, pushAnims: 0, writes: 0 };
  /* 玻璃状态：与几何解耦（只写 CSS 变量/data-*），本层是它唯一的启动点 */
  const glass = createGlass({ adapter });
  try {
    const LC = bridge.ensure('lc', { global: '__lc', owner: 'src/lc/index.js' });
    LC.glass = glass;
    bridge.register('lc.glass', glass, { owner: 'src/lc/render.js' });
  } catch (_) {}
  glass.start();

  function rec(id) {
    if (!prev.has(id)) prev.set(id, { phase: PHASE.MINI, box: null, push: { x: 0, y: 0 }, staged: false });
    return prev.get(id);
  }

  function writeBox(el, box) {
    el.style.position = 'fixed';
    el.style.left = px(box.x);
    el.style.top = px(box.y);
    el.style.width = px(box.w);
    el.style.height = px(box.h);
    el.style.maxHeight = 'none'; // 防 App 的「可用高度」内联规则把展开卡压扁
    el.style.minHeight = '0';
    el.style.transform = 'none';
    el.style.overflowY = 'auto';
    el.style.zIndex = String(box.z || 60);
    stats.writes += 1;
  }

  function clearBox(el) {
    for (const k of ['position', 'left', 'top', 'width', 'height', 'transform', 'overflowY', 'zIndex', 'willChange']) el.style[k] = '';
    el.style.maxHeight = '';
    el.style.minHeight = '';
  }

  function stopAnim(id) {
    const a = anims.get(id);
    if (a) {
      try {
        a.cancel();
      } catch (_) {}
      anims.delete(id);
    }
    morph.cancel(adapter.el(id));
  }

  /**
   * 一帧：把 layout 结果落到 DOM。
   * @param {object} p {snapshot, result, phases, gens}
   */
  function apply({ snapshot, result, phases, gens }) {
    const cards = snapshot.cards || {};
    for (const id of CARD_IDS) {
      const el = adapter.el(id);
      if (!el) continue;
      const phase = phases[id] || PHASE.MINI;
      const r = rec(id);
      const push = (result.pushes && result.pushes[id]) || { x: 0, y: 0 };
      const box = result.boxes && result.boxes[id];

      el.classList.add('gev-lc');
      glass.skin(el); /* 材质变体/scrim/阴影/高光位（只写变量，不改几何） */
      el.dataset.lcRail = (CARDS[id] && CARDS[id].rail) || '';

      if (phase === PHASE.MINI) {
        if (r.staged) {
          /* ANIM_END 之后 render.finishClose 已经卸过；这里只是兜底 */
          adapter.unstageCard(id);
          r.staged = false;
        }
        el.dataset.lcPhase = PHASE.MINI;
        stopAnim(id);
        clearBox(el);
        /* 让位：mini 卡只改 --lc-push，transform 由 material.css 组合。
           注意顺序：先把 --lc-push 写成**最终值**，再让 transform 从 (旧−新) 动画到 0 ——
           否则 CSS 变量与 WAAPI transform 会叠加成 2×delta（视觉上先弹出去再回来）。 */
        const dPush = { x: push.x - r.push.x, y: push.y - r.push.y };
        el.style.setProperty('--lc-push-x', px(push.x));
        el.style.setProperty('--lc-push-y', px(push.y));
        if (Math.abs(dPush.x) > 0.5 || Math.abs(dPush.y) > 0.5)
          animatePush(el, { x: -dPush.x, y: -dPush.y }, { x: 0, y: 0 }, id, cards[id] && cards[id].mini);
        r.push = { x: push.x, y: push.y };
        r.phase = PHASE.MINI;
        r.box = null;
        continue;
      }

      if (phase === PHASE.CLOSING) {
        const target = box || (cards[id] && cards[id].mini) || r.box;
        if (!target) continue;
        if (!r.staged) {
          /* 从没展开过就收到 closing（异常）→ 直接回 mini */
          r.phase = PHASE.MINI;
          continue;
        }
        if (r.phase !== PHASE.CLOSING) {
          /* 开始关闭：inline 几何先落到 mini 目标，再用 FLIP 把视觉倒推回当前 */
          const from = toFlip((cards[id] && cards[id].visual) || r.box);
          writeBox(el, target);
          el.dataset.lcPhase = PHASE.CLOSING;
          playClose(id, el, from, target, gens[id]);
          stats.closes += 1;
        } else if (box && !same(r.box, box)) {
          writeBox(el, box); // 关途中窗口 resize：直接改目标
        }
        r.phase = PHASE.CLOSING;
        r.box = { ...target };
        continue;
      }

      /* opening / open */
      if (!box) continue;
      const from = toFlip((cards[id] && cards[id].visual) || box);
      if (!r.staged) {
        const mini = (cards[id] && cards[id].mini) || null;
        adapter.stageCard(id, mini);
        r.staged = true;
      }
      const changing = !same(r.box, box, 0.6);
      if (r.phase === PHASE.MINI || r.phase === PHASE.CLOSING || (r.phase !== phase && phase === PHASE.OPENING)) {
        writeBox(el, box);
        el.dataset.lcPhase = PHASE.OPENING;
        if ((CARDS[id] && CARDS[id].rail) === 'dock') el.classList.add('dock-panel');
        playOpen(id, el, from, box, gens[id]);
        stats.opens += 1;
      } else if (changing && !r.dragging) {
        writeBox(el, box);
        el.dataset.lcPhase = phase;
        playOpen(id, el, from, box, gens[id], { retarget: true });
      } else if (changing) {
        writeBox(el, box);
      }
      if (phase === PHASE.OPEN) el.dataset.lcPhase = PHASE.OPEN;
      if ((CARDS[id] && CARDS[id].rail) === 'dock') el.classList.add('dock-panel');
      r.dragging = !!r.dragging;
      r.phase = phase;
      r.box = { ...box };
    }
    /* 让位位移清 0（卡片已不在 mini）*/
    for (const id of CARD_IDS) {
      const r = rec(id);
      if ((phases[id] || PHASE.MINI) !== PHASE.MINI && (r.push.x || r.push.y)) {
        const el = adapter.el(id);
        if (el) {
          el.style.setProperty('--lc-push-x', '0px');
          el.style.setProperty('--lc-push-y', '0px');
        }
        r.push = { x: 0, y: 0 };
      }
    }
  }

  function playOpen(id, el, from, to, gen, opts = {}) {
    stopAnim(id);
    el.style.willChange = 'transform';
    const anim = morph.run(el, from, {
      id,
      to,
      target: { w: to.w, h: to.h },
      onFinish: () => {
        el.style.willChange = '';
        if (typeof onAnimEnd === 'function') onAnimEnd(id, gen);
      },
    });
    if (anim) anims.set(id, anim);
    if (opts.retarget) stats.opens += 0;
  }

  function playClose(id, el, from, to, gen) {
    stopAnim(id);
    el.style.willChange = 'transform';
    const anim = morph.run(el, from, {
      id,
      to,
      target: { w: to.w, h: to.h },
      onFinish: () => {
        el.style.willChange = '';
        if (typeof onAnimEnd === 'function') onAnimEnd(id, gen);
      },
    });
    if (anim) anims.set(id, anim);
  }

  function animatePush(el, fromPush, toPush, id, size) {
    if (!el) return;
    if (Math.abs(fromPush.y - toPush.y) < 0.5 && Math.abs(fromPush.x - toPush.x) < 0.5) return;
    const anim = morph.runShift(el, { from: fromPush, to: toPush, size });
    if (anim) stats.pushAnims += 1;
  }

  function pushesOf() {
    const out = {};
    for (const id of CARD_IDS) {
      const r = rec(id);
      out[id] = { x: r.push.x, y: r.push.y };
    }
    return out;
  }

  /** ANIM_END(closing) 后由宿主同步调用：立即回填槽位（不留给下一帧，避免一帧空壳）。 */
  function finishClose(id) {
    const r = rec(id);
    stopAnim(id);
    if (r.staged) {
      adapter.unstageCard(id);
      r.staged = false;
    }
    r.phase = PHASE.MINI;
    r.box = null;
    r.push = { x: 0, y: 0 };
    const el = adapter.el(id);
    if (el) {
      el.dataset.lcPhase = PHASE.MINI;
      el.style.setProperty('--lc-push-x', '0px');
      el.style.setProperty('--lc-push-y', '0px');
    }
  }

  /** App 把展开卡抢回轨道 → 重新脱层（renderer 拥有「展开卡必须在 stage」这条不变量）。 */
  function assertStaged(phases) {
    let fixed = 0;
    for (const id of CARD_IDS) {
      const r = rec(id);
      const phase = (phases && phases[id]) || r.phase;
      if (phase === PHASE.OPENING || phase === PHASE.OPEN) {
        if (adapter.isStaged(id)) continue;
        adapter.stageCard(id, r.box);
        if (r.box) writeBox(adapter.el(id), r.box);
        fixed += 1;
      }
    }
    return fixed;
  }

  return {
    apply,
    finishClose,
    assertStaged,
    pushesOf,
    glass,
    stats: () => ({ ...stats }),
    record: (id) => ({ ...rec(id) }),
    setDragging: (id, v) => {
      const r = rec(id);
      r.dragging = !!v;
      glass.invalidateRects(); /* 拖动中卡片在移动：缓存必然过期 */
    },
    /** 让高光几何缓存立刻失效（供 resize / 布局变更后调用）。 */
    invalidateRects: () => glass.invalidateRects(),
    /** 只读：当前每张卡的动画数（T16 断言用）。 */
    animations: () => Object.fromEntries([...anims.entries()].map(([k, a]) => [k, a && a.playState])),
  };
}

export default { createRenderer };
