/* ============================================================================
   src/lc/morph.js —— 展开/收起动画（果冻，Phase 1 · S4m）
   ----------------------------------------------------------------------------
   架构文档 §15：
     M1 时长 = durationMs(w,h)，两点线性插值，夹在 [350, 450]
        S_SMALL=√(176×43)=86.994 → 350ms；S_LARGE=√(320×380)=348.712 → 445ms
        K = (445-350)/(348.712-86.994) = 0.36300…
     M2 easeOutBack，视觉 overshoot 落 1.02–1.05；只允许一条 WAAPI 驱动几何
     M3 连点：cancel 旧动画，从当前 presentation 值继续（不重播）
     M4 reduced-motion → 150ms、ease-out、无回弹（不再用 dur=0 瞬移）
     M5 帧健康保险丝：morph.js 允许**恰好 1 个** setTimeout（64ms）

   为什么用「采样关键帧 + linear」而不是一条 cubic-bezier：
     现有实现是 FLIP（transform: translate+scale，fill:none），几何由 inline
     left/top/width/height 直接写死；transform 上的缩放才是唯一被动画的量。
     一条 cubic-bezier 的 y 值 overshoot 无法按「目标视觉放大比例」标定，
     而采样关键帧可以把 **视觉峰值** 精确标到 1.035（assertable）。
   ========================================================================== */

const S_SMALL = Math.sqrt(176 * 43); // 86.994
const S_LARGE = Math.sqrt(320 * 380); // 348.712
const K = (445 - 350) / (S_LARGE - S_SMALL); // 0.3630

export const MIN_MS = 350;
export const MAX_MS = 450;
export const REDUCE_MS = 150;
export const TARGET_OVERSHOOT = 1.035; // 视觉峰值 / 目标盒

/** M1：目标盒面积 → 时长（ms），夹在 [350,450]。 */
export function durationMs(w, h) {
  const area = Math.max(1, Number(w) || 0) * Math.max(1, Number(h) || 0);
  const s = Math.sqrt(area);
  const v = 350 + (s - S_SMALL) * K;
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, v)));
}

/** easeOutBack：f(u) = 1 + (c1+1)u³ + c1u² ，u ∈ [-1, 0]；
    峰值 1 + 4c1³ / (27(c1+1)²)。用二分反解 c1，使峰值 = 目标值。 */
export function backC1(peak) {
  const target = Math.max(1, peak) - 1;
  if (target <= 1e-6) return 0;
  const over = (c) => (4 * c * c * c) / (27 * (c + 1) * (c + 1));
  let lo = 0,
    hi = 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (over(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function easeOutBack(t, c1) {
  const u = t - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}

/**
 * 采样关键帧：transform: translate + scale，offset 均匀，线性插值。
 *
 * **逐轴标定**（2026-10-28 Phase2）：FLIP 的 sx/sy 在收起时可达 1.82 / 7.9（宽高比差异大），
 * 用「两轴平均振幅」反解单一 p_peak，会让宽轴过冲只有 0.7%、高轴 4.6% —— 视觉上是各向异性
 * 抖动，且任一轴都测不到 1.02–1.05。改为每轴各自反解，两轴视觉过冲都精确等于
 * TARGET_OVERSHOOT，位移轴跟随同轴的进度（同一 easeOutBack 族、同一 duration，不产生第二族曲线）。
 */
export function keyframes(dx, dy, sx, sy, opts) {
  const o = opts || {};
  const reduce = !!o.reduce;
  /* 该轴要实现 TARGET_OVERSHOOT 所需的 p 峰值：视觉超出量 = |1-s| × (p-1) */
  const peakFor = (start) => {
    const amp = Math.abs(1 - start);
    if (amp < 1e-4) return 1; // 无缩放 → 不回弹（c1=0，退化为 ease-out 三次）
    return Math.min(1.2, 1 + (TARGET_OVERSHOOT - 1) / amp);
  };
  const pPeakX = reduce ? 1 : peakFor(sx);
  const pPeakY = reduce ? 1 : peakFor(sy);
  const c1 = reduce ? 0 : backC1(pPeakX);
  const c1y = reduce ? 0 : backC1(pPeakY);
  const n = Math.max(12, Math.min(40, Math.round((o.duration || 400) / 12)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    /* reduced-motion 用 ease-out（无回弹） */
    const p = reduce ? 1 - Math.pow(1 - t, 3) : easeOutBack(t, c1);
    const q = reduce ? p : easeOutBack(t, c1y);
    out.push({
      offset: t,
      transform:
        `translate(${(dx * (1 - p)).toFixed(2)}px,${(dy * (1 - q)).toFixed(2)}px) ` +
        `scale(${(sx + (1 - sx) * p).toFixed(4)},${(sy + (1 - sy) * q).toFixed(4)})`,
    });
  }
  return { frames: out, c1, c1y, pPeak: pPeakX, pPeakY, samples: n + 1 };
}

/* 每个元素只允许一条本模块创建的动画（M3/M6） */
const CURRENT = new WeakMap();

export function cancel(el) {
  const a = CURRENT.get(el);
  if (!a) return false;
  try {
    a.cancel();
  } catch (_) {}
  CURRENT.delete(el);
  return true;
}

export function animationsOf(el) {
  const a = CURRENT.get(el);
  return a ? [a] : [];
}

/**
 * 一条动画从 A 盒到 B 盒。
 * @param el       目标元素（inline 几何必须已经是 B 盒）
 * @param first    视觉起点矩形 {left,top,width,height}
 * @param opts     { id, register, onFinish, reducedMotion }
 * @returns Animation | null（位移/缩放差异过小 → 不动画）
 */
export function run(el, first, opts) {
  const o = opts || {};
  if (!el || !first) return null;
  /* 目标盒优先用调用方给的权威几何（inline 刚写好的 st.g / mini 槽位）：
     首张开卡时 getBoundingClientRect 可能还没反映刚写入的 inline 尺寸，
     会把 sx/sy 算成 1（FLIP 退化成不动）—— 实测首卡峰值恒 1.000。 */
  let last;
  if (o.to && o.to.w) {
    last = { left: o.to.x, top: o.to.y, width: o.to.w, height: o.to.h };
  } else {
    try {
      last = el.getBoundingClientRect();
    } catch (_) {
      return null;
    }
  }
  if (!last || !last.width || !last.height) return null;
  const sx = last.width ? first.width / last.width : 1;
  const sy = last.height ? first.height / last.height : 1;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (
    Math.abs(dx) < 0.5 &&
    Math.abs(dy) < 0.5 &&
    Math.abs(sx - 1) < 0.004 &&
    Math.abs(sy - 1) < 0.004
  )
    return null;

  const reduce =
    o.reducedMotion !== undefined
      ? !!o.reducedMotion
      : (() => {
          try {
            /* §6.7：software tier 也走 150ms / 无回弹（不做第二套材质，只切一个开关） */
            if (
              window.__gevGpu &&
              typeof window.__gevGpu.tier === 'function' &&
              window.__gevGpu.tier() === 'software'
            )
              return true;
            return matchMedia('(prefers-reduced-motion: reduce)').matches;
          } catch (_) {
            return false;
          }
        })();

  const dur = reduce
    ? REDUCE_MS
    : o.target && o.target.w
      ? durationMs(o.target.w, o.target.h)
      : durationMs(last.width, last.height);
  cancel(el); // M3：连点先取消旧动画，从当前 presentation 值继续
  const kf = keyframes(dx, dy, sx, sy, { reduce, duration: dur });

  let anim;
  try {
    anim = el.animate(kf.frames, {
      duration: dur,
      easing: 'linear',
      fill: 'none',
    });
  } catch (_) {
    return null;
  }
  if (typeof o.register === 'function') {
    try {
      o.register(anim);
    } catch (_) {}
  }
  CURRENT.set(el, anim);
  try {
    window.__lc = window.__lc || {};
    window.__lc.morph = window.__lc.morph || {};
    window.__lc.morph.last = {
      id: o.id || el.id || '',
      duration: dur,
      reduce,
      easing: reduce ? 'ease-out' : 'easeOutBack',
      c1: kf.c1,
      pPeak: kf.pPeak,
      pPeakY: kf.pPeakY,
      samples: kf.samples,
      from: [
        Math.round(first.left),
        Math.round(first.top),
        Math.round(first.width),
        Math.round(first.height),
      ],
      to: [
        Math.round(last.left),
        Math.round(last.top),
        Math.round(last.width),
        Math.round(last.height),
      ],
      at: Date.now(),
    };
  } catch (_) {}

  const drop = () => {
    if (CURRENT.get(el) === anim) CURRENT.delete(el);
  };
  try {
    anim.addEventListener('finish', drop);
    anim.addEventListener('cancel', drop);
  } catch (_) {}
  if (typeof o.onFinish === 'function') {
    anim.addEventListener('finish', () => {
      try {
        o.onFinish();
      } catch (_) {}
    });
  }

  /* M5 帧健康保险丝（本模块唯一允许的 setTimeout）：
     动画被节流时 currentTime 永远停在 0，finished 永不触发 → 判死、cancel 让 inline
     几何当场生效，并补一次落定回调。
     窗口从 64ms 放宽到 200ms 的实测理由：首张开卡时主线程被布局/样式计算独占
     170–260ms（实测采样：inline 几何 166ms 写入、WAAPI 到 340ms
     才走到 79ms），64ms 判死会把**正常**开卡的果冻动画全部掐掉（T16 峰值恒为 1.000）。
     200ms 仍然远小于「被节流到 1fps」的判定窗口，节流场景照旧取消。 */
  setTimeout(() => {
    let t = 0;
    try {
      t = Number(anim.currentTime) || 0;
    } catch (_) {}
    if (anim.playState === 'running' && t < 32) {
      try {
        anim.cancel();
      } catch (_) {}
      if (typeof o.onFinish === 'function') {
        try {
          o.onFinish();
        } catch (_) {}
      }
    }
  }, 200);

  return anim;
}

export default {
  durationMs,
  keyframes,
  run,
  cancel,
  animationsOf,
  MIN_MS,
  MAX_MS,
  REDUCE_MS,
};

/* 兄弟卡「让位平移」用同一条果冻曲线（M2：一个元素上只允许一族曲线；
   旧实现是 280ms + cubic-bezier(.22,.9,.24,1)，与开卡曲线不同族 → 双曲线抖动）。 */
export const PUSH_EASING = 'cubic-bezier(.34,1.2,.64,1)';
export function pushTiming(w, h) {
  return { duration: durationMs(w || 300, h || 300), easing: PUSH_EASING };
}

/** 让位平移的采样关键帧：translate(from → to) + scale 峰值（P1-3：与开卡同一族曲线）。 */
export const SHIFT_PEAK = 1.02;
function reducedNow(opts) {
  if (opts && opts.reducedMotion !== undefined) return !!opts.reducedMotion;
  try {
    if (
      window.__gevGpu &&
      typeof window.__gevGpu.tier === 'function' &&
      window.__gevGpu.tier() === 'software'
    )
      return true;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return false;
  }
}
export function shiftKeyframes(from, to, opts = {}) {
  const reduce = !!opts.reduce;
  const peak = reduce
    ? 1
    : Math.min(TARGET_OVERSHOOT, Math.max(1.02, opts.peak || SHIFT_PEAK));
  const c1 = reduce ? 0 : backC1(peak);
  const n = Math.max(12, Math.min(40, Math.round((opts.duration || 400) / 12)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = reduce ? 1 - Math.pow(1 - t, 3) : easeOutBack(t, c1);
    const x = from.x + (to.x - from.x) * p;
    const y = from.y + (to.y - from.y) * p;
    /* 回弹峰值：正弦鼓包，t=0.5 处精确等于 peak（可断言，不夸张） */
    const s = reduce ? 1 : 1 + (peak - 1) * Math.sin(Math.PI * t);
    out.push({
      offset: t,
      transform: `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${s.toFixed(4)})`,
    });
  }
  return { frames: out, c1, peak, samples: n + 1 };
}

/**
 * 让位（mini 兄弟平移）动画：与开卡同一条曲线族，逐元素 ≤1 条。
 * @returns {Animation|null}
 */
export function runShift(el, opts = {}) {
  if (!el) return null;
  const from = opts.from || { x: 0, y: 0 };
  const to = opts.to || { x: 0, y: 0 };
  if (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5)
    return null;
  const reduce = reducedNow(opts);
  const dur = reduce
    ? REDUCE_MS
    : durationMs(
        (opts.size && opts.size.w) || 300,
        (opts.size && opts.size.h) || 300,
      );
  cancel(el);
  const kf = shiftKeyframes(from, to, {
    reduce,
    duration: dur,
    peak: opts.peak,
  });
  let anim;
  try {
    anim = el.animate(kf.frames, {
      duration: dur,
      easing: 'linear',
      fill: 'none',
    });
  } catch (_) {
    return null;
  }
  CURRENT.set(el, anim);
  try {
    window.__lc = window.__lc || {};
    window.__lc.morph = window.__lc.morph || {};
    window.__lc.morph.shift = {
      duration: dur,
      peak: kf.peak,
      reduce,
      from,
      to,
      at: Date.now(),
    };
  } catch (_) {}
  const drop = () => {
    if (CURRENT.get(el) === anim) CURRENT.delete(el);
  };
  try {
    anim.addEventListener('finish', drop);
    anim.addEventListener('cancel', drop);
  } catch (_) {}
  return anim;
}
