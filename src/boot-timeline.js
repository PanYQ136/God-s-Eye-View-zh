/* ════════════════════════════════════════════════════════════════════════════
   boot-timeline.js —— 冷启动分阶段耗时观测（**只观测，不改行为**）
   ----------------------------------------------------------------------------
   目的：把「导航开始 → 遮罩收起」这一段拆成可复现的阶段，回答「9.9–11.5s
   到底花在哪」。

   口径
     · 所有时间戳 = performance.now()，锚点 = navigationStart（timeOrigin）：
       t=0 就是导航开始，所以任意模块的任意 mark 都直接可比，跨运行也可比。
     · 阶段 = 「检查点按时间排序后的相邻差分」。检查点分两类：
         1) 浏览器自报的 Navigation Timing / Paint Timing（nav、responseStart、
            domInteractive、DCL、load、first-paint、FCP）—— 这一部分不是我们
            自己打的点，用来交叉校验；
         2) 各模块 performance.now() 标记（gate/viewer/scene/chrome）。
     · snapshot() 直接给出 stages / sum / total / coverageError，不藏缺口：
       任何没被阶段覆盖的间隙都算进 unaccounted，误差超过 5% 一眼能看出来。

   对外
     window.__bootTimeline = { mark(name, meta), recordFrame(dt, maskOp),
                               snapshot(), enabled, frames, marks }
     缺失时所有调用方都是空操作（node 单测 / 无 window 环境）。

   调试输出默认关闭：?bootdebug=1 或 localStorage.gev.bootdebug === '1'
   才 console.info 每个 mark；否则完全静默。

   成本：每次 mark 一次数组 push；每帧一次 recordFrame（只做加法，>50ms 才
   入环）。不装 rAF 循环、不改渲染、不改并发、不改视觉。
   ════════════════════════════════════════════════════════════════════════════ */

const HAS_WINDOW = typeof window !== 'undefined';
const PERF = typeof performance !== 'undefined' ? performance : null;
const now = () => (PERF ? PERF.now() : 0);

const MAX_MARKS = 200;
const MAX_FRAMES = 400;
const SLOW_FRAME_MS = 50;

const marks = [];
const longFrames = [];
const longTasks = [];
const counters = { frames: 0, worstFrame: 0, worstFrameAt: 0 };

let debug = false;
try {
  if (HAS_WINDOW) {
    const query = new URLSearchParams(window.location.search);
    debug =
      query.get('bootdebug') === '1' ||
      window.localStorage?.getItem('gev.bootdebug') === '1';
  }
} catch (_) {
  debug = false;
}

/* 资源缓冲：Chrome 默认只保留 250 条 resource timing，dev 形态光模块就 200+ 条，
   瓦片请求会被挤掉 → 观测前先把上限抬到 5000（只影响诊断数据，不影响加载）。 */
try {
  if (PERF && typeof PERF.setResourceTimingBufferSize === 'function')
    PERF.setResourceTimingBufferSize(5000);
} catch (_) {}

/** 打一个时间点（ms，相对 navigationStart）。重名允许，取第一条做检查点。 */
export function mark(name, meta) {
  const t = +now().toFixed(1);
  const entry = { name, t };
  if (meta && typeof meta === 'object') Object.assign(entry, meta);
  marks.push(entry);
  if (marks.length > MAX_MARKS) marks.shift();
  if (debug) {
    try {
      console.info('[bootTimeline]', t, name, meta || '');
    } catch (_) {}
  }
  return t;
}

/** 每帧一次（由 gate 的 tick 转发）。只做常数级加法，>SLOW_FRAME_MS 才留档。 */
export function recordFrame(dt, maskOp) {
  counters.frames += 1;
  if (dt > counters.worstFrame) {
    counters.worstFrame = +dt.toFixed(1);
    counters.worstFrameAt = +now().toFixed(1);
  }
  if (dt > SLOW_FRAME_MS) {
    longFrames.push({
      t: +now().toFixed(1),
      dt: +dt.toFixed(1),
      maskOp: Number.isFinite(maskOp) ? +maskOp.toFixed(3) : null,
    });
    if (longFrames.length > MAX_FRAMES) longFrames.shift();
  }
}

/* 长任务（主线程 >50ms）：冷启动「卡住」的真正证据。只观测，不拦截。 */
try {
  if (HAS_WINDOW && typeof PerformanceObserver === 'function') {
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks.push({
          start: +e.startTime.toFixed(1),
          dur: +e.duration.toFixed(1),
        });
        if (longTasks.length > MAX_FRAMES) longTasks.shift();
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
  }
} catch (_) {}

/* 阶段检查点（顺序无关：snapshot 里按实际时间排序后差分） */
const CHECKPOINTS = [
  'net:responseStart',
  'net:domInteractive',
  'net:dcl',
  'paint:first',
  'paint:fcp',
  'gate:eval',
  'main:entry',
  'viewer:module-eval',
  'viewer:construct:begin',
  'viewer:construct:end',
  'viewer:ready',
  'scene:begin',
  'tileset:fetch:begin',
  'tileset:fetch:end',
  'tileset:added',
  'gate:tileset:added',
  'basemap:setStack:begin',
  'basemap:setStack:end',
  'scene:ready',
  'app:phase:controls',
  'app:phase:data',
  'app:phase:tools',
  'app:ready',
  'chrome:begin',
  'gate:cine:go',
  'gate:cine:done',
  'gate:tileset:firstContent',
  'gate:view:content',
  'gate:view:settled',
  'gate:decide',
  'mask:hide-request',
  'mask:hidden',
  'gate:mask:gone',
  'mask:transitionend',
  'net:load',
];

const lookup = (name) => {
  for (const m of marks) {
    if (m.name === name || m.name.startsWith(name + '(')) return m;
  }
  return null;
};

const navTiming = () => {
  try {
    const nav = PERF.getEntriesByType('navigation')[0];
    return nav || null;
  } catch (_) {
    return null;
  }
};

const paintTiming = () => {
  const out = {};
  try {
    for (const p of PERF.getEntriesByType('paint'))
      out[p.name] = +p.startTime.toFixed(1);
  } catch (_) {}
  return out;
};

const resourceSummary = () => {
  let entries = [];
  try {
    entries = PERF.getEntriesByType('resource');
  } catch (_) {
    return null;
  }
  const groups = {};
  let bytes = 0;
  let lastEnd = 0;
  const rows = [];
  for (const e of entries) {
    const size = e.transferSize || 0;
    bytes += size;
    if (e.responseEnd > lastEnd) lastEnd = e.responseEnd;
    const name = e.name;
    let g = 'other';
    if (/cesium/i.test(name)) g = 'cesium';
    else if (name.endsWith('.css')) g = 'css';
    else if (/\.(png|jpg|jpeg|webp|svg|gif|ico)$/i.test(name)) g = 'image';
    else if (/\.(json|geojsonl|bin|b3dm|glb|txt)$/i.test(name)) g = 'data';
    else if (/\.m?js(\?|$)/.test(name)) g = 'js';
    groups[g] ||= { n: 0, ms: 0, bytes: 0 };
    groups[g].n += 1;
    groups[g].ms += e.duration || 0;
    groups[g].bytes += size;
    rows.push({
      name: name.replace(/^https?:\/\/[^/]+/, '').slice(0, 90),
      start: +(e.startTime || 0).toFixed(1),
      end: +(e.responseEnd || 0).toFixed(1),
      dur: +(e.duration || 0).toFixed(1),
      bytes: size,
      group: g,
    });
  }
  for (const g of Object.keys(groups)) {
    groups[g].ms = +groups[g].ms.toFixed(1);
    groups[g].mb = +(groups[g].bytes / 1048576).toFixed(2);
  }
  rows.sort((a, b) => b.dur - a.dur);
  return {
    count: entries.length,
    bytes,
    mb: +(bytes / 1048576).toFixed(2),
    lastResponseEnd: +lastEnd.toFixed(1),
    groups,
    slowest: rows.slice(0, 15),
    latest: rows
      .slice()
      .sort((a, b) => b.end - a.end)
      .slice(0, 15),
  };
};

/** 全部 checkpoint + 阶段差分 + 覆盖误差。 */
export function snapshot() {
  const nav = navTiming();
  const paint = paintTiming();
  const found = [];
  const missing = [];

  const push = (name, t, src) => {
    if (Number.isFinite(t) && t >= 0)
      found.push({ name, t: +t.toFixed(1), src });
  };

  push('nav', 0, 'anchor');
  if (nav) {
    push('net:responseStart', nav.responseStart, 'navTiming');
    push('net:domInteractive', nav.domInteractive, 'navTiming');
    push('net:dcl', nav.domContentLoadedEventEnd, 'navTiming');
    if (nav.loadEventEnd > 0) push('net:load', nav.loadEventEnd, 'navTiming');
  }
  if (Number.isFinite(paint['first-paint']))
    push('paint:first', paint['first-paint'], 'paintTiming');
  if (Number.isFinite(paint['first-contentful-paint']))
    push('paint:fcp', paint['first-contentful-paint'], 'paintTiming');

  for (const name of CHECKPOINTS) {
    const m = lookup(name);
    if (m) push(name, m.t, 'mark');
    else missing.push(name);
  }

  found.sort((a, b) => a.t - b.t);
  const stages = [];
  for (let i = 1; i < found.length; i++) {
    const ms = +(found[i].t - found[i - 1].t).toFixed(1);
    if (ms < 0) continue;
    stages.push({ from: found[i - 1].name, to: found[i].name, ms });
  }
  const total = found.length ? found[found.length - 1].t : 0;
  const sum = +stages.reduce((a, s) => a + s.ms, 0).toFixed(1);
  const coverageError =
    total > 0 ? +(((total - sum) / total) * 100).toFixed(2) : null;
  const longest = stages.slice().sort((a, b) => b.ms - a.ms);

  return {
    v: 1,
    anchor: 'navigationStart',
    total,
    sum,
    coverageErrorPct: coverageError,
    checkpoints: found,
    stages,
    topStages: longest.slice(0, 6),
    missing,
    frames: counters.frames,
    worstFrame: counters.worstFrame,
    worstFrameAt: counters.worstFrameAt,
    longFrames: longFrames.slice(),
    longTasks: longTasks
      .slice()
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 12),
    resources: resourceSummary(),
    marks: marks.slice(),
    debug,
  };
}

const api = {
  v: 1,
  mark,
  recordFrame,
  snapshot,
  get enabled() {
    return debug;
  },
};

if (HAS_WINDOW) {
  window.__bootTimeline = api;
}

export default api;
