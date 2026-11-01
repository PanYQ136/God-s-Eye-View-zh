/* ============================================================================
   src/lc/gpu.js —— GPU 能力探测 / 分级 / 降级（Phase 1 · S1g）
   ----------------------------------------------------------------------------
   唯一职责（架构文档 §13.2）：
     · 全仓**唯一**允许调用 getExtension('WEBGL_debug_renderer_info') 的模块（R5）
     · 所有 WebGL 上下文都必须经 contextOptions() 拿 powerPreference（R1）
     · renderer 命中软件渲染 → tier='software'，由调用方降级（R2）
     · 页面必须有可见位：#gev-gpu-chip（常驻） + #gev-gpu-notice（一次性提示）（R3）

   钩子：window.__gevGpu = { state, tier, probe, contextOptions }   ← 给 public/*.js 普通脚本
         window.__lc.gpu()                                        ← 给测试/断言
   不许写回用户设置（R4），不许在别处再写第二份软件渲染正则（R5）。

   本文件不得使用 setTimeout（架构 §10 CI 门槛：src/lc/* 只有 morph.js 允许 1 个）。
   一次性提示条用 CSS animation（9s）+ animationend 移除，不用定时器。
   ========================================================================== */

import * as bridge from '../bridge.js';
const SOFT_RE =
  /SwiftShader|llvmpipe|Software|Basic Render|Microsoft Basic|ANGLE\s*\(Software/i;
const REQUESTED = 'high-performance';
const HAS_DOM =
  typeof document !== 'undefined' && typeof window !== 'undefined';
const CHIP_ID = 'gev-gpu-chip';
const NOTICE_ID = 'gev-gpu-notice';
const NOTICE_KEY = 'gev.gpu.notice.shown';

/** 所有 WebGL 上下文统一走这里：请求高性能（R1）。 */
export function contextOptions(extra) {
  return Object.assign(
    {
      powerPreference: REQUESTED,
      failIfMajorPerformanceCaveat: false,
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    },
    extra || {},
  );
}

let _state = {
  ok: false,
  api: 'none',
  renderer: '',
  vendor: '',
  requested: REQUESTED,
  granted: null,
  software: false,
  tier: 'none',
  at: 0,
  noticeShown: false,
};
const _subs = new Set();
let _noticeShown = false;

function readOnce(api) {
  let canvas = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
  } catch (_) {
    return null;
  }
  let gl = null;
  try {
    gl = canvas.getContext(api, contextOptions());
  } catch (_) {
    gl = null;
  }
  if (!gl) return null;
  let renderer = '';
  let vendor = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(
      (dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)) || '',
    );
    vendor = String(
      (dbg
        ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR)) || '',
    );
  } catch (_) {}
  let granted = null;
  try {
    granted = (gl.getContextAttributes() || {}).powerPreference || null;
  } catch (_) {}
  /* 探测画布立刻释放：不占一块 GPU 上下文（§13.3 R1） */
  try {
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (_) {}
  return { api, renderer, vendor, granted };
}

/** 探测一次（默认带缓存；force=true 时重探）。返回 GpuState。 */
export function probe(force) {
  if (!force && _state.at) return _state;
  let r = null;
  try {
    r = readOnce('webgl2');
  } catch (_) {}
  if (!r) {
    try {
      r = readOnce('webgl');
    } catch (_) {}
  }
  const renderer = r ? r.renderer : '';
  const software = !!r && SOFT_RE.test(renderer);
  _state = {
    ok: !!r,
    api: r ? r.api : 'none',
    renderer: renderer || (r ? '未知' : ''),
    vendor: r ? r.vendor : '',
    requested: REQUESTED,
    granted: r ? r.granted : null,
    software,
    tier: !r ? 'none' : software ? 'software' : 'high',
    at: Date.now(),
    noticeShown: _noticeShown,
  };
  paint();
  _subs.forEach((fn) => {
    try {
      fn(_state);
    } catch (_) {}
  });
  return _state;
}

export function tier() {
  return probe().tier;
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  _subs.add(fn);
  try {
    fn(probe());
  } catch (_) {}
  return () => _subs.delete(fn);
}

/* ── 可见位（R3）────────────────────────────────────────────────────────── */

function shortRenderer(s) {
  const t = String(s || '');
  /* ANGLE 包装里第一段常只是厂商名（如 "NVIDIA"），取逗号分段里最长的那段更像型号 */
  let out = t;
  const m = /ANGLE\s*\(([^)]*)\)/.exec(t);
  if (m) {
    const segs = m[1]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    segs.sort((a, b) => b.length - a.length);
    out = segs[0] || t;
  }
  out = out
    .replace(/\((?:0x)?[0-9a-f]{4,}\)/gi, '')
    /* Chrome 的 renderer 串会在长度上限处截断，PCI id 常只剩 "(0x0000252"：
       去掉这种没有右括号的尾巴，否则 chip 上会挂着半截十六进制。 */
    .replace(/\s*\((?:0x)?[0-9a-f]{2,}\)?$/i, '')
    .replace(/\bvs_5_0\b|\bps_5_0\b|\bD3D11\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!out) out = t;
  /* Phase 3：状态带右侧已留出 400px+ 的专属槽位，28 字符会把
     「NVIDIA GeForce RTX 3060 Laptop GPU」（34 字符）截成 "...Lap…"。
     放宽到 40 字符，超长型号仍走省略号 + title 里给完整 renderer。 */
  return out.length > 40 ? out.slice(0, 39) + '…' : out;
}

function chipText(s) {
  if (s.tier === 'none') return 'GPU 未启用';
  if (s.tier === 'software') return 'GPU 未启用';
  const low = s.granted === 'low-power';
  return 'GPU · ' + shortRenderer(s.renderer) + (low ? '（低功耗）' : '');
}

function ensureCss() {
  if (document.getElementById('gev-gpu-css')) return;
  const st = document.createElement('style');
  st.id = 'gev-gpu-css';
  /* 灰圈=0（§6.6）：chip / notice 都不用 border / outline / inset 描边，只用底色+字色 */
  /* Phase8D #13：运行时注入的样式表也要进层 */
  st.textContent =
    '@layer components {\n' +
    [
      `#${CHIP_ID}{border:0;outline:0;box-shadow:none;background:rgba(8,20,30,.72);color:#8fe3ff;padding:6px 10px;border-radius:16px;font:12px/1.2 system-ui,"Segoe UI",sans-serif;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;}`,
      `#${CHIP_ID}[data-gpu-tier="software"],#${CHIP_ID}[data-gpu-tier="none"]{background:rgba(58,20,10,.78);color:#ffc9a8;}`,
      `#${NOTICE_ID}{position:fixed;left:50%;bottom:200px;transform:translateX(-50%);z-index:2147483000;border:0;outline:0;box-shadow:0 8px 28px rgba(0,0,0,.35);background:rgba(24,12,8,.86);color:#ffe2cf;padding:10px 16px;border-radius:14px;font:13px/1.45 system-ui,"Segoe UI",sans-serif;max-width:min(520px,78vw);backdrop-filter:none;cursor:pointer;animation:gev-gpu-notice 9s linear forwards;}`,
      `#${NOTICE_ID} b{color:#fff;font-weight:600;}`,
      `@keyframes gev-gpu-notice{0%{opacity:0}4%{opacity:1}88%{opacity:1}100%{opacity:0}}`,
    ].join('\n') +
    '\n}';
  document.head.appendChild(st);
}

function paintChip() {
  ensureCss();
  const wrap = document.getElementById('gev-perf-wrap');
  let chip = document.getElementById(CHIP_ID);
  if (!chip) {
    chip = document.createElement('div');
    chip.id = CHIP_ID;
    chip.setAttribute('role', 'status');
    (wrap || document.body).appendChild(chip);
  } else if (wrap && chip.parentNode !== wrap) {
    /* gev-perf.js 晚于本模块建 #gev-perf-wrap → 建好后把 chip 挪进同一 wrap（R3） */
    wrap.appendChild(chip);
  }
  chip.dataset.gpuTier = _state.tier;
  chip.textContent = chipText(_state);
  chip.title =
    'renderer: ' +
    (_state.renderer || '—') +
    '\nrequested: ' +
    _state.requested +
    '\ngranted: ' +
    String(_state.granted) +
    '\ntier: ' +
    _state.tier +
    '\napi: ' +
    _state.api;
}

function showNotice() {
  if (_state.tier === 'none' || _state.tier === 'software') {
    ensureCss();
    if (document.getElementById(NOTICE_ID)) return;
    let shown = false;
    try {
      shown = sessionStorage.getItem(NOTICE_KEY) === '1';
    } catch (_) {}
    if (shown) return;
    try {
      sessionStorage.setItem(NOTICE_KEY, '1');
    } catch (_) {}
    const n = document.createElement('div');
    n.id = NOTICE_ID;
    n.setAttribute('role', 'status');
    /* 用 DOM 节点而非 innerHTML：renderer 是驱动字符串（外部来源），
       即使可信也不拼进 HTML，避免任何注入面。 */
    const b = document.createElement('b');
    b.textContent = 'GPU 未启用';
    n.appendChild(b);
    n.appendChild(
      document.createTextNode(
        ' —— 当前是软件渲染（' +
          shortRenderer(_state.renderer || '无 WebGL') +
          '）。已自动降级：关闭边缘折射、动画缩短、帧率目标下调。',
      ),
    );
    n.appendChild(document.createElement('br'));
    n.appendChild(
      document.createTextNode(
        '开启「浏览器设置 → 系统 → 使用图形加速」并重启浏览器可恢复。',
      ),
    );
    const drop = () => {
      try {
        n.remove();
      } catch (_) {}
    };
    n.addEventListener('animationend', drop);
    n.addEventListener('click', drop);
    document.body.appendChild(n);
    /* 断言用：提示条有 9s 自动淡出，测试读取时可能已经移除 → 用标记留痕（T14） */
    _noticeShown = true;
    _state.noticeShown = true;
    try {
      bridge.ensure('lc', {
        global: '__lc',
        owner: 'src/lc/index.js',
      }).assert.notice = true;
    } catch (_) {}
  }
}

function paint() {
  if (!HAS_DOM) return; /* node / 单测环境：只出状态，不碰 DOM */
  paintChip();
  showNotice();
}

/** 把 chip 挂进 #gev-perf-wrap（gev-perf.js 建好 wrap 之后调用）。 */
export function mountChip() {
  paintChip();
}

/* 首次探测 + 上下文丢失 / 页面可见性变化时重探（§13.5） */
function boot() {
  probe();
  try {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) probe(true);
    });
    window.addEventListener(
      'webglcontextlost',
      () => {
        probe(true);
      },
      true,
    );
  } catch (_) {}
  const api = {
    state: () => _state,
    tier,
    probe,
    contextOptions,
    mountChip,
    subscribe,
  };
  try {
    /* Phase8D #15：__gevGpu 只是兼容面；模块内一律走桥 */
    bridge.register('gpu', api, { global: '__gevGpu', owner: 'src/lc/gpu.js' });
    const LC = bridge.ensure('lc', {
      global: '__lc',
      owner: 'src/lc/index.js',
    });
    LC.gpu = () => _state;
    LC.assert = LC.assert || {};
    LC.assert.gpu = _state.tier;
    subscribe((s) => {
      try {
        LC.assert.gpu = s.tier;
      } catch (_) {}
    });
  } catch (_) {}
  return api;
}

boot();

export default { probe, tier, subscribe, contextOptions, mountChip };
