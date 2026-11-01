/* ============================================================================
   ⚠ 回滚副本 —— 不是现役代码，任何页面都不加载它（问题清单 #19 · Phase8E 补齐版本头）
   ----------------------------------------------------------------------------
   文件      : docs/architecture/rollback/gev-edge-lens.phase3.js
   副本内容  : 「Phase3 单层极淡高光」变体（dispPx=0 / innerDark=0 / gain=0 / band=10 /
               rimAmt=0.10）。**不是** f16cd41 里那一版（那版是 band:16 + 三光线色散）。
   建立时间  : 2026-10-29（该版本从未提交，故无 commit 号 —— 只能按下面的数字特征识别）
   对照基线  : commit f16cd41 (2026-10-28) public/gev-edge-lens.js = 29,971 B
               （与本副本差 468 B：band 16→10、色散/压暗归零、注释重写）
   现役文件  : public/gev-edge-lens.js —— 68,844 B / 1,140 行（2026-10-30 23:05）
   替换范围  : 只有 public/gev-edge-lens.js 一份文件。用本副本整份覆盖它：
                 cp docs/architecture/rollback/gev-edge-lens.phase3.js public/gev-edge-lens.js
               index.html 的 <script src="/gev-edge-lens.js"> 与任何 CSS 都不改。
   使用前置  : 先 git commit 或在 .gev-logs 存现役快照；回滚后必须 Ctrl+F5，
               再重跑 scripts/lc/phase6c-gate-v3.mjs（折射/色散 gate）确认指标。
   禁止      : 把本文件当现役实现来读/改；两个方向的实现混用会退化成
               「灰圈 + 彩虹色带」—— 正是 phase3 要解决的问题。
   记录人    : Phase8E（t_5523b364） 2026-10-31
   ============================================================================ */
/* ============================================================================
   gev-edge-lens.js —— 上帝之眼 · 边缘折射环（P2 · 2026-10-27 t_9739e3a7）
   ----------------------------------------------------------------------------
   目标：卡片【边缘 12–16px】做真折射 + R/G/B 色散，中心不做位移、不做暗底。
         中心由 CSS `.gev-lg-warp` 的 backdrop blur(6px) 提供（本文件不动它）。

   结构（三层，自下而上）：
     ① #gev-edge-lens  —— 本文件的全屏 canvas（position:fixed, z-index:4，在卡片之下）
        每张卡一个 quad，fragment 只在「距圆角矩形边界 < uBand」处输出，
        中心 discard（alpha=0）→ 卡片中心完全不受影响。
        shader = SDF 圆角矩形 + 四分之一圆斜面 surfaceHeight(t) + Snell(IOR 1.52)
                 + 3 条独立光线（R/G/B 采样系数 0.82 / 1.00 / 1.22）→ 边缘真色散。
     ② .gev-lc 卡壳 rgba(12,18,26,0.52)：同时压暗「折射环」与「中心底图」，
        环与中心的色偏一致（物理上就是同一块带色玻璃）。
     ③ .gev-lg-warp：backdrop blur(6px) saturate(140%)，CSS 侧 `inset:12px` + 8px 羽化 mask，
        只负责中心磨砂；边缘 0–12px 不模糊（否则 2px 级 R/G/B 位移会被 blur6 抹平）。

   数据来源：Cesium 画布。**不开 preserveDrawingBuffer**（实测它会让地图合成层变黑/多一次整帧拷贝），
   改为挂在 `viewer.scene.postRender` 上：Cesium 刚画完、同一 task 内绘制缓冲仍有效，
   此刻把 Cesium canvas 直接 texImage2D 成纹理 → 零额外拷贝、零 pdb 代价。Cesium 空闲
   （不再渲染）时由 rAF 兜底：只用旧纹理重画几何（卡片动画仍跟手）。

   开关 / 钩子（控制台）：
     window.__gevEdge.set({band:14, dispPx:5, lod:0})   改常量（立即生效）
     window.__gevEdge.only(['data-panel'])               只给指定卡画（1 卡原型）
     window.__gevEdge.stats()                             fps / 面的 rect / 耗时
     window.__gevEdge.testBg(true, 8)                    灰阶条纹底（量色散用）
     window.__gevEdge.cap(30|60)                         限帧
     URL: ?gevEdge=0 完全关闭（连 preserveDrawingBuffer 都不开，等同旧基线）
          ?gevEdge=2 只开 preserveDrawingBuffer、不画环（隔离 pdb 成本）
   ========================================================================== */
(function () {
  'use strict';
  if (window.__gevEdgeLens) return;

  var Q = {};
  (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return; var i = kv.indexOf('='); Q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1));
  });
  var MODE = Q.gevEdge === '0' ? 0 : (Q.gevEdge === '2' ? 2 : 1);

  window.__gevEdgeLens = { mode: MODE, loading: true };
  if (MODE === 0) return;

  var CFG = {
    /* Phase 3（2026-10-29）：边缘层收敛成「单层极淡高光」。
       ① dispPx=0  → 关掉 R/G/B 三光线色散（P0-4 彩虹/锯齿大色带的唯一来源）
       ② innerDark=0 → 关掉最外圈压暗（P0-1 外圈灰线）
       ③ gain=0 / blurPx=0 → 不再位移采样，只画高光；因此不会出现「外圈+内圈」双线
       ④ band=10 / rimAmt=0.10 → 一条极淡上沿高光，与 material.css 的 1px 高光同源 */
    band: 10,          // 高光带宽度（CSS px，0–16）
    bandFrac: 0.20,    // 小卡按短边比例收窄（52px 高的头卡 → 10px，避免「粗边框」感）
    bandMin: 7,
    feather: 6,        // 内缘羽化：depth band-6→band 之间 alpha 1→0
    thick: 4,          // 玻璃厚度（已不参与位移，仅用于法线坡度）
    ior: 1.52,         // 物理玻璃折射率
    gain: 0,           // 0 = 不做折射位移（只留高光）
    dispPx: 0,         // 0 = 无色散（禁彩色带）
    blurPx: 0,         // 0 = 不模糊采样（不位移，无需模糊）
    lod: 0.0,          // 采样 LOD（0=最锐；1 略柔）
    rimAmt: 0.10,      // 边缘高光（单层，真实法线高光）
    curvature: 1.7, spread: 1.59, smoothness: 8.0,
    innerDark: 0,      // 0 = 无内圈压暗（禁内圈灰线）
    aa: 1.2,           // 外轮廓抗锯齿（CSS px）
    scale: 0,          // 0 = auto（min(dpr,1.5)）
    maxScale: 1.5,
    cap: 0,            // 0 = 跟着 Cesium postRender 每帧画（同帧合成 → 边缘内容与地图零延迟）；
                       // 也可 __gevEdge.cap(60) 半速画（省 ~10% 页面 fps，但移动时会慢 1 帧）
    only: null,        // null = 9 卡全画；['data-panel'] = 只画一张
    testBg: false, testBgCss: 8,
    enabled: MODE !== 2,      // ?gevEdge=2 = 挂钩但画 0 个面（隔离成本用）
  };

  /* 玻璃面：9 张卡（与 src/lc/cards.js 的卡片表一致，去掉顶部功能条） */
  var SURF = [
    { id: 'data-panel',           sel: '#data-panel',            radius: 16 },
    { id: 'scene-panel',          sel: '#scene-panel',           radius: 16 },
    { id: 'pp-toggles',           sel: '#pp-toggles',            radius: 16 },
    { id: 'cctv-panel',           sel: '#cctv-panel',            radius: 16 },
    { id: 'global-context-panel', sel: '#global-context-panel',  radius: 16 },
    { id: 'location-bar',         sel: '#location-bar',          radius: 16 },
    { id: 'control-panel',        sel: '#control-panel',         radius: 16 },
    { id: 'gev-voice-control',    sel: '#gev-voice-control',     radius: 16 },
    { id: 'gev-gfx-fab',          sel: '#gev-gfx-fab',           radius: 999 },
  ];

  var stats = { frames: 0, skip: 0, fps: 0, fpsRaw: 0, p50: 0, p90: 0, surfaces: [], scale: 1, err: null, tex: null, gpuMs: null, post: 0, raf: 0 };
  var ready = false, cv = null, gl = null, texValid = false;
  /* ── 空闲去重（t_834a621c · 2026-10-28）──────────────────────────────────
     Cesium 在 requestRenderMode 下空闲时 postRender 不再触发（实测 1.5s 内 0 次），
     而本文件的 rAF 兜底仍在每帧 clear + drawArrays → 整张全屏 canvas 每帧变脏 →
     合成器每帧都要重合成一次全屏层。审计机（Intel UHD）上「只要有动画在跑」的
     整窗上限就是 ~40fps（20×20 的红方块与全屏渐变同速），所以这条冗余重绘直接
     吃掉帧率，却一个像素都没变。
     现在按「纹理版本 + 面几何」签名去重：签名没变就完全不动 GL（画布保留上一帧，
     屏幕像素一致），有变化（地图重绘 / 卡片动画 / 布局变化 / 缩放）才重画。 */
  var TEX_STAMP = 0, lastSig = '';

  /* ── 帧驱动 ──────────────────────────────────────────────────────────────
     主驱动 = Cesium scene.postRender（刚画完、缓冲有效 → 可 texImage2D）
     兜底   = 自己的 rAF（Cesium 空闲时用旧纹理只重画几何；卡片动画不脱节） ── */
  var lastDrawT = 0, lastPost = -1e9, ft = [];
  function gate(ts) {
    /* 4ms 去重：Cesium 在一帧里可能触发两次 postRender（实测环速率 161/s > 页面 87fps），
       同帧重复的 texImage2D 上传纯属浪费。4ms 既能去重，又不影响 144Hz。 */
    if (lastDrawT && ts - lastDrawT < 4) return true;
    return !!CFG.cap && ts - lastDrawT < 1000 / CFG.cap - 1.2;
  }
  function tick(ts, capture) {
    if (gate(ts)) return;
    if (lastDrawT) { ft.push(ts - lastDrawT); if (ft.length > 120) ft.shift(); }
    lastDrawT = ts;
    if (ft.length >= 24) {
      var s = ft.slice().sort(function (a, b) { return a - b; });
      stats.p50 = +s[Math.floor(s.length * 0.5)].toFixed(2);
      stats.p90 = +s[Math.floor(s.length * 0.9)].toFixed(2);
      stats.fps = +(1000 / stats.p50).toFixed(1);
    }
    try { draw(ts, capture || CFG.testBg); } catch (e) { if (!stats.err) stats.err = String(e && e.message || e); }
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    if (ts - lastPost < 45) return;          // postRender 正在驱动，不重复画
    stats.raf++;
    tick(ts, false);
  }
  function onPostRender() {
    var ts = performance.now();
    lastPost = ts; stats.post++;
    tick(ts, true);
  }

  /* ── shader ───────────────────────────────────────────────────────────── */
  var VS = ['#version 300 es', 'in vec2 aUV;',
    'uniform vec4 uRect; uniform vec2 uRes;', 'out vec2 vPx;',
    'void main(){ vec2 pos = uRect.xy + aUV * uRect.zw; vPx = pos;',
    '  gl_Position = vec4(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0, 0.0, 1.0); }'].join('\n');

  /* 只画边缘环：
     · SDF 圆角矩形 → depth（0 在轮廓、向内增大）
     · surfaceHeight(t) = pow(1-(1-t)^4, 0.25) 四分之一圆倒角，Snell 折射 → 真位移
     · 3 条独立光线 R/G/B（0.82 / 1.00 / 1.22）→ 边缘彩边、中心 0
     · 输出 alpha：带内 1（折射像替换底图），内缘羽化到 0，中心 discard */
  var FS = [
    '#version 300 es', 'precision highp float;',
    'in vec2 vPx; out vec4 o;',
    'uniform sampler2D uMap;',
    'uniform vec2 uRes;',
    'uniform vec4 uRect;',
    'uniform float uRadius, uCornerN, uBand, uFeather, uThick, uIOR, uGain, uDispPx, uLod,',
    '              uRimAmt, uCurv, uSpread, uSmooth, uInnerDark, uAA, uScale, uBlurPx;',
    'float sdRound(vec2 p, vec2 hs, float r){',
    '  vec2 q = abs(p) - hs + vec2(r);',
    '  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    /* 角形：uCornerN<=2.01 → 普通圆弧（原行为，一像素不变）；
       >2.01 → 超椭圆角 |qx/r|^n + |qy/r|^n = 1（CSS corner-shape: squircle，实测 n=4），
       与卡壳的 CSS 轮廓同一条曲线，边缘环才能贴住 squircle 的角。
       距离用一阶归一化（(f-1)/|∇f|）拿到近似真距离，环宽/斜面在角上仍按 px 计。 */
    'float sdShape(vec2 p, vec2 hs, float r, float n){',
    '  vec2 q = abs(p) - hs + vec2(r);',
    '  float dRound = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;',
    '  if (n <= 2.01 || r <= 0.0 || q.x <= 0.0 || q.y <= 0.0) return dRound;',
    '  float ax = q.x / r, ay = q.y / r;',
    '  float S = pow(ax, n) + pow(ay, n);',
    '  float f = pow(S, 1.0 / n);',
    '  float g = pow(S, 1.0 / n - 1.0);',
    '  float gx = g * pow(ax, n - 1.0) / r, gy = g * pow(ay, n - 1.0) / r;',
    '  return (f - 1.0) / max(sqrt(gx * gx + gy * gy), 1e-6);',
    '}',
    'float surfaceHeight(float t){',
    '  float s = 1.0 - t;',
    '  return pow(max(1.0 - s * s * s * s, 0.0), 0.25);',
    '}',
    /* 5 抽样小模糊：斜面是透镜（3:25 的 blur≈2px），全锐会读成「贴片/相框」 */
    'vec3 tap(sampler2D t, vec2 uv, vec2 d){ return texture(t, uv + d).rgb; }',
    'vec3 blur3(sampler2D t, vec2 uv, vec2 px){',
    '  vec3 s = texture(t, uv).rgb * 0.36;',
    '  s += tap(t, uv, vec2(px.x, 0.0)) * 0.16;',
    '  s += tap(t, uv, vec2(-px.x, 0.0)) * 0.16;',
    '  s += tap(t, uv, vec2(0.0, px.y)) * 0.16;',
    '  s += tap(t, uv, vec2(0.0, -px.y)) * 0.16;',
    '  return s;',
    '}',
    'void main(){',
    '  vec2 hs = uRect.zw * 0.5;',
    '  vec2 c  = uRect.xy + hs;',
    '  vec2 p  = vPx - c;',
    '  float d = sdShape(p, hs, uRadius, uCornerN);',
    '  if (d > 0.0) discard;',
    '  float depth = -d;',
    '  if (depth > uBand) discard;',                          // 中心不画（CSS blur 负责）
    '  float t = clamp(depth / uBand, 0.0, 1.0);',
    '  float h = surfaceHeight(t);',
    '  float dh = (surfaceHeight(min(t + 0.02, 1.0)) - h) / 0.02;',
    '  float slope = atan(abs(dh) * (uThick / max(uBand, 1.0)));',
    '  float thR = asin(clamp(sin(slope) / uIOR, -1.0, 1.0));',
    '  float dBase = h * uThick * (tan(slope) - tan(thR)) * uGain;',   // 真 Snell（内缘 → 0）
    '  vec2 n = normalize(vec2(',
    '      sdShape(p + vec2(1.0, 0.0), hs, uRadius, uCornerN) - sdShape(p - vec2(1.0, 0.0), hs, uRadius, uCornerN),',
    '      sdShape(p + vec2(0.0, 1.0), hs, uRadius, uCornerN) - sdShape(p - vec2(0.0, 1.0), hs, uRadius, uCornerN)) + 1e-6);',
    '  vec2 dir = -n;',                                       // 向内取样（倒角把外景折进来）
    '  float edgeBand = 1.0 - smoothstep(0.0, 1.0, t);',
    '  float dEdge = uDispPx * edgeBand;',
    '  vec2 uv = vPx / uRes;',
    '  vec2 uvR = uv + dir * (dBase + dEdge * 0.82) / uRes;',
    '  vec2 uvG = uv + dir * (dBase + dEdge * 1.00) / uRes;',
    '  vec2 uvB = uv + dir * (dBase + dEdge * 1.22) / uRes;',
    '  vec2 bpx = vec2(uBlurPx) / uRes;',
    '  vec3 sR = blur3(uMap, uvR, bpx);',
    '  vec3 sG = blur3(uMap, uvG, bpx);',
    '  vec3 sB = blur3(uMap, uvB, bpx);',
    '  vec3 col = vec3(sR.r, sG.g, sB.b);',
    /* 边缘高光（真实法线，双侧 45°/-135°）：只在最外 ~4px，量很小，不是假彩边 */
    '  vec2 d1 = normalize(vec2(0.7071, -0.7071));',
    '  float bandf = exp(-pow(t / 0.22, 2.0));',
    '  float hl = pow(max(dot(n, d1), 0.0), uCurv) + pow(max(dot(n, -d1), 0.0), uCurv);',
    '  float line = smoothstep(1.5 * uScale, 0.2 * uScale, depth) * 0.05;',
    '  col = mix(col, vec3(1.0), clamp(hl * bandf * uRimAmt + line, 0.0, 0.4));',
    '  col *= 1.0 - uInnerDark * (1.0 - smoothstep(0.0, uBand * 0.5, depth));',
    '  float aOut = smoothstep(0.0, uAA, depth);',             // 外轮廓 AA
    '  float aIn  = 1.0 - smoothstep(uBand - uFeather, uBand, depth);',  // 内缘羽化
    '  float a = aOut * aIn;',
    '  if (a < 0.004) discard;',
    '  o = vec4(col, a);',
    '}'
  ].join('\n');

  function compile(g, type, src) {
    var s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) { stats.err = 'shader: ' + g.getShaderInfoLog(s); console.warn('[gev-edge]', stats.err); return null; }
    return s;
  }
  function program(g, vs, fs) {
    var a = compile(g, g.VERTEX_SHADER, vs), b = compile(g, g.FRAGMENT_SHADER, fs);
    if (!a || !b) return null;
    var p = g.createProgram(); g.attachShader(p, a); g.attachShader(p, b); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) { stats.err = 'link: ' + g.getProgramInfoLog(p); return null; }
    return p;
  }

  /* ── 地图源 ───────────────────────────────────────────────────────────── */
  function mapCanvas() {
    var v = window.__gevViewer;
    if (v && v.canvas && v.canvas.width > 400) return v.canvas;
    var cs = document.querySelectorAll('canvas'), best = null, area = 0;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.id === 'gev-edge-lens') continue;
      if (c.width < 400 || c.height < 300) continue;
      var a = c.width * c.height; if (a > area) { area = a; best = c; }
    }
    return best;
  }

  function pickScale() {
    if (CFG.scale > 0) return CFG.scale;
    var s = Math.min(window.devicePixelRatio || 1, CFG.maxScale);
    var MAXW = 4096;
    if (innerWidth * s > MAXW) s = MAXW / innerWidth;
    return Math.max(0.75, +s.toFixed(3));
  }

  var W = 1, H = 1, scale = 1, quad = null, prog = null, u = {}, mapTex = null;
  var snap = null, sctx = null;

  function resize() {
    scale = pickScale();
    W = Math.max(2, Math.round(innerWidth * scale));
    H = Math.max(2, Math.round(innerHeight * scale));
    cv.width = W; cv.height = H; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    if (snap) { snap.width = W; snap.height = H; }
    stats.scale = scale;
    lastSig = '';            // 画布重建 = 内容丢失，下一帧必须重画
  }

  function boot() {
    /* Phase 1 · S1g（§13.3 R2）：software tier 下**不创建**这块全屏 canvas
       （省一次全屏合成/读回）。判定只来自 src/lc/gpu.js（R5），这里不写第二份正则。 */
    try {
      if (window.__gevGpu && typeof window.__gevGpu.tier === 'function' && window.__gevGpu.tier() === 'software') {
        stats.err = 'software-tier';
        stats.disabled = true;
        document.documentElement.classList.remove('gev-edge-on');
        console.info('[gev-edge] off · GPU tier=software（降级：不创建边缘折射 canvas）');
        return true;
      }
    } catch (e) {}
    var map = mapCanvas();
    var viewer = window.__gevViewer;
    if (!map || !viewer || !viewer.scene || !viewer.scene.postRender) return false;
    if (!document.getElementById('data-panel')) return false;

    cv = document.createElement('canvas');
    cv.id = 'gev-edge-lens';
    cv.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:4;opacity:0;transition:opacity .25s linear;';
    document.body.appendChild(cv);
    gl = cv.getContext('webgl2', {
      premultipliedAlpha: false, alpha: true, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) { stats.err = 'no-webgl2'; return false; }
    prog = program(gl, VS, FS);
    if (!prog) return false;

    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uMap', 'uRes', 'uRect', 'uRadius', 'uCornerN', 'uBand', 'uFeather', 'uThick', 'uIOR', 'uGain', 'uDispPx',
      'uLod', 'uRimAmt', 'uCurv', 'uSpread', 'uSmooth', 'uInnerDark', 'uAA', 'uScale']
      .forEach(function (k) { u[k] = gl.getUniformLocation(prog, k); });

    mapTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, mapTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    snap = document.createElement('canvas');
    sctx = snap.getContext('2d', { alpha: false });
    resize();
    window.addEventListener('resize', resize);

    gl.useProgram(prog);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1i(u.uMap, 0);
    gl.uniform1f(u.uScale, scale);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    ready = true;
    stats.tex = 'cesium-direct';
    /* 主驱动：Cesium postRender（同一 task 内缓冲有效） */
    viewer.scene.postRender.addEventListener(onPostRender);
    requestAnimationFrame(loop);
    /* 首帧真的画出来后再露出（避免闪一下空层） */
    var reveal = setInterval(function () {
      if (!stats.frames) return;
      clearInterval(reveal);
      cv.style.opacity = '1';
      document.documentElement.classList.add('gev-edge-on');
      console.info('[gev-edge] on · band=' + CFG.band + 'px · scale=' + scale + ' · tex=' + stats.tex +
        ' · post=' + stats.post);
    }, 120);
    window.__gevEdgeLens.loading = false;
    return true;
  }

  /* 合成条纹（验收：底图 R=G=B 时，卡边出现 RGB 不等只能来自本 shader 的色散） */
  function paintTestBg(w, h) {
    if (CFG.testBgCss < 0) { sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, w, h); return; }
    var pw = Math.max(2, Math.round(CFG.testBgCss * scale));
    sctx.fillStyle = '#eeeeee'; sctx.fillRect(0, 0, w, h);
    sctx.fillStyle = '#0e0e0e';
    for (var x = 0; x < w; x += pw * 2) sctx.fillRect(x, 0, pw, h);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 6 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  }

  /* computed corner-shape → 超椭圆几何指数 n：
       'superellipse(p)' → n = 2^p（Chrome 的参数化；实测 p=1→n=2.02 圆、p=2→n=4.09 squircle、p=3→n=8.32）
       'round' / 不支持 / 解析失败 → 2（圆）                                     */
  function cornerExponent(cs) {
    var v = '';
    try { v = (cs.cornerShape || cs.getPropertyValue('corner-shape') || '').trim(); } catch (e) { return 2; }
    if (!v) return 2;
    var m = /superellipse\(\s*(-?[\d.]+)\s*\)/i.exec(v);
    if (m) {
      var p = parseFloat(m[1]);
      if (!isFinite(p) || p <= 0) return 2;
      if (p > 8) p = 8;
      return Math.min(64, Math.pow(2, p));
    }
    if (/round/i.test(v)) return 2;
    if (/squircle/i.test(v)) return 4;
    return 2;
  }

  function collect() {
    var out = [];
    for (var i = 0; i < SURF.length; i++) {
      var s = SURF[i];
      if (CFG.only && CFG.only.indexOf(s.id) < 0) continue;
      var el = document.querySelector(s.sel);
      if (!visible(el)) continue;
      var r = el.getBoundingClientRect();
      var x = r.left * scale, y = r.top * scale, w = r.width * scale, h = r.height * scale;
      if (x + w <= 0 || y + h <= 0 || x >= W || y >= H) continue;
      var rad = s.radius >= 999 ? Math.min(w, h) * 0.5 : Math.min(s.radius * scale, Math.min(w, h) * 0.5);
      /* 角形指数：读卡壳真实 computed corner-shape（corner-shape: squircle → 超椭圆 n=4）。
         不支持该属性 / 值仍是圆 → 2（sdShape 走原来的圆角分支，像素级不变）。 */
      var cornerN = s.radius >= 999 ? 2 : cornerExponent(getComputedStyle(el));
      /* 小胶囊（42px FAB / 45–52px 头卡）不能整块被 16px 环吃掉：
         按短边 bandFrac 收窄（下限 bandMin），否则折叠态卡片会变成「粗彩框」 */
      var band = Math.max(CFG.bandMin * scale, Math.min(CFG.band * scale, Math.min(w, h) * CFG.bandFrac));
      band = Math.min(band, Math.min(w, h) * 0.42);
      out.push({ id: s.id, x: x, y: y, w: w, h: h, radius: rad, cornerN: cornerN, band: band, css: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    }
    return out;
  }

  function uploadMap(map) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mapTex);
    if (CFG.testBg) {
      paintTestBg(W, H);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snap);
      stats.tex = 'testbg';
      texValid = true;
      TEX_STAMP++;
      return true;
    }
    /* 首选：直接把 Cesium canvas 传成纹理（GPU→GPU，不经 2D 中转）。
       只在 postRender 里调用 —— 那时绘制缓冲还有效（pdb 关着）。 */
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, map);
      stats.tex = 'cesium-direct';
      texValid = true;
      TEX_STAMP++;
      return true;
    } catch (e) {
      stats.tex = 'snapshot-fallback';
      stats.lastErr = String(e && e.message || e);
    }
    var mr = map.getBoundingClientRect();
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, W, H);
    try { sctx.drawImage(map, mr.left * scale, mr.top * scale, mr.width * scale, mr.height * scale); }
    catch (e2) { stats.err = 'drawImage: ' + (e2 && e2.message || e2); return false; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snap);
    texValid = true;
    TEX_STAMP++;
    return true;
  }

  function draw(ts, capture) {
    if (!ready || !CFG.enabled) return;
    var map = mapCanvas();
    if (!map) return;
    if (cv.width !== Math.round(innerWidth * scale) || cv.height !== Math.round(innerHeight * scale)) resize();

    var list = collect();
    if (!list.length) {
      if (!lastSig) return;          // 已经空过一轮：不再每帧 clear 一张全屏画布
      lastSig = '';
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); stats.surfaces = [];
      stats.frames++;
      return;
    }
    /* 去重：纹理版本 + 每个面的几何（含 band/角形指数）都没变 → 这一帧屏幕上
       不会有任何差别，直接返回；不 clear、不 drawArrays，画布保持上一帧内容。
       capture=true 表示 Cesium 刚重绘（postRender），纹理必须重新上传并重画。 */
    if (capture) {
      if (!uploadMap(map)) return;
    } else if (!texValid) {
      return;                                   // 还没有可用的地图纹理 → 不画（避免黑边）
    }
    var sig = TEX_STAMP + '|' + W + 'x' + H + '|' + scale;
    for (var si = 0; si < list.length; si++) {
      var q0 = list[si];
      sig += '|' + Math.round(q0.x) + ',' + Math.round(q0.y) + ',' + Math.round(q0.w) + ',' + Math.round(q0.h) + ',' + Math.round(q0.band) + ',' + (q0.cornerN || 2) + ',' + Math.round(q0.radius);
    }
    if (!capture && sig === lastSig) { stats.skip++; return; }
    lastSig = sig;
    stats.frames++;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    var loc = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uThick, CFG.thick * scale);
    gl.uniform1f(u.uIOR, CFG.ior);
    gl.uniform1f(u.uGain, CFG.gain);
    gl.uniform1f(u.uDispPx, CFG.dispPx * scale);
    gl.uniform1f(u.uLod, CFG.lod);
    gl.uniform1f(u.uRimAmt, CFG.rimAmt);
    gl.uniform1f(u.uCurv, CFG.curvature);
    gl.uniform1f(u.uSpread, CFG.spread);
    gl.uniform1f(u.uSmooth, CFG.smoothness);
    gl.uniform1f(u.uInnerDark, CFG.innerDark);
    gl.uniform1f(u.uAA, CFG.aa * scale);
    gl.uniform1f(u.uBlurPx, CFG.blurPx * scale);

    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      gl.uniform4f(u.uRect, s.x, s.y, s.w, s.h);
      gl.uniform1f(u.uRadius, s.radius);
      gl.uniform1f(u.uCornerN, s.cornerN || 2);
      gl.uniform1f(u.uBand, s.band);
      gl.uniform1f(u.uFeather, Math.min(CFG.feather * scale, s.band * 0.8));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      out.push({ id: s.id, rect: s.css, band: +(s.band / scale).toFixed(1), cornerN: s.cornerN });
    }
    stats.surfaces = out;
    /* 验收取样：同帧内 readPixels 一条横带（必须在 draw 内读，画布外缓冲已失效） */
    if (window.__gevEdgeGrab) {
      var g = window.__gevEdgeGrab;
      try {
        var px = new Uint8Array(g.w * 4);
        gl.readPixels(Math.round(g.x * scale), Math.round(H - g.y * scale), Math.round(g.w), 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var row = [];
        for (var k = 0; k < g.w; k++) row.push([px[k * 4], px[k * 4 + 1], px[k * 4 + 2], px[k * 4 + 3]]);
        window.__gevEdgeGrabOut = { req: g, row: row, frame: stats.frames };
      } catch (e) { window.__gevEdgeGrabOut = { err: String(e && e.message || e) }; }
      window.__gevEdgeGrab = null;
    }
    if (stats.frames % 30 === 0) {
      var s2 = ft.slice().sort(function (a, b) { return a - b; });
      stats.p50 = +s2[Math.floor(s2.length * 0.5)].toFixed(2);
      stats.p90 = +s2[Math.floor(s2.length * 0.9)].toFixed(2);
      stats.fps = +(1000 / stats.p50).toFixed(1);
    }
  }

  /* ── 钩子 ─────────────────────────────────────────────────────────────── */
  window.__gevEdge = {
    set: function (patch) { if (patch) for (var k in patch) CFG[k] = patch[k]; if (patch && patch.scale != null) resize(); return CFG; },
    cfg: function () { return CFG; },
    only: function (ids) { CFG.only = ids && ids.length ? ids.slice() : null; return CFG.only; },
    testBg: function (on, css) { CFG.testBg = !!on; if (css != null) CFG.testBgCss = +css; return { on: CFG.testBg, css: CFG.testBgCss }; },
    cap: function (n) { CFG.cap = +n || 0; return CFG.cap; },
    on: function () { CFG.enabled = true; return true; },
    off: function () {
      CFG.enabled = false;
      if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); texValid = false; }
      lastSig = '';                              // 画布已清空 → 重新打开必须重画
      stats.surfaces = [];
      return false;
    },
    stats: function () {
      return {
        fps: stats.fps, fpsRaw: stats.fpsRaw, p50: stats.p50, p90: stats.p90, frames: stats.frames,
        skip: stats.skip,
        scale: scale, canvas: [W, H], tex: stats.tex, err: stats.err,
        band: CFG.band, dispPx: CFG.dispPx, lod: CFG.lod, only: CFG.only, cap: CFG.cap,
        count: stats.surfaces.length, surfaces: stats.surfaces,
        /* R5：renderer 判定只走 src/lc/gpu.js（唯一允许读 WEBGL_debug_renderer_info 的模块） */
        renderer: (function () {
          try {
            if (window.__gevGpu && typeof window.__gevGpu.probe === 'function') {
              var s = window.__gevGpu.probe();
              return (s && s.renderer) || null;
            }
            return gl.getParameter(gl.RENDERER);
          } catch (er) { return null; }
        })(),
      };
    },
    readPixels: function (list) {
      var out = [];
      try {
        for (var i = 0; i < list.length; i++) {
          var px = new Uint8Array(4);
          gl.readPixels(Math.round(list[i][0] * scale), Math.round(H - list[i][1] * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          out.push([px[0], px[1], px[2], px[3]]);
        }
      } catch (e) { return 'err:' + (e && e.message); }
      return out;
    },
  };

  /* 启动：Cesium viewer / 卡片就绪后建上下文 */
  var tries = 0;
  (function start() {
    if (boot()) return;
    if (++tries > 80) { stats.err = stats.err || 'boot-timeout'; window.__gevEdgeLens.loading = false; console.warn('[gev-edge] boot timeout', stats.err); return; }
    setTimeout(start, 250);
  })();
})();
