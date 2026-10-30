/* ============================================================================
   gev-gl-glass.js —— 上帝之眼 · Apple Liquid Glass 折射层（P0 · 参考常量版 2026-10-26）
   ----------------------------------------------------------------------------
   规范：D:\Hermes\docs\上帝之眼-Apple液态玻璃1比1复刻强制规范-20261026.md（v2 全卡玻璃）
   常量：D:\Hermes\docs\上帝之眼-液态玻璃实现方法与参考常量汇总-20261026.md
     · IOR 1.52（物理玻璃）+ 四分之一圆斜面 surfaceHeight(t)=pow(1-(1-t)^4,0.25) + Snell
     · bezel（透镜带）18 CSS px（参考 16–20）；thickness 30；blur 2px（参考 1.5–3，不再 10/16 过糊）
     · 色散：3 条独立光线（R/G/B 采样偏移系数 0.82 / 1.00 / 1.22，基准 dispPx 5 CSS px，
       R/B 采样位移差约 2px），不是 8 个光谱样本加权 → 边缘彩边，中心 0
     · 高光：双侧 45°/-135°（amount .5 / curvature 1.7 / spread 1.59 / smoothness 8）
     · 面填充：白色 0.02–0.08（按背景亮度自适应），不再是 0.10–0.24 深底
     · 9 张卡全部玻璃（用户决策 2026-10-26 15:12），每卡一个 quad，离屏不渲染，动画期降载
   前置：Cesium preserveDrawingBuffer=true（自动置 gev.gfx.pdb 并重载一次）
   ========================================================================== */
(function () {
  'use strict';
  if (window.__gevGlLiquid) return;
  window.__gevGlLiquid = true;

  /* ── 参考常量（文档 §五） ───────────────────────────────────────────── */
  var CFG = {
    edge: 18,              // bezel 透镜带 CSS px（参考 16–20）
    thick: 34,             // 玻璃厚度（参考 30–50）
    ior: 1.52,             // 物理玻璃折射率
    gain: 0.9,             // 位移增益（调参用）
    blur: 2.0,             // 背景模糊半径 px（参考 1.5–3）
    etaLo: 1.48, etaHi: 1.56,   // 仅用于色散 A/B 开关（etaLo==etaHi → gate=0，三条光线重合）；不是光谱样本数
    rimAmt: 0.5,           // 高光强度（参考 amount .5）
    curvature: 1.7,        // 高光曲率（参考 1.7）
    spread: 1.59,          // 高光扩散（参考 1.59）
    smoothness: 8.0,       // 高光平滑（参考 8）
    innerDark: 0.14,       // 内侧暗边
    dispPx: 5.0,           // 色散横向位移（CSS px @ 边缘最强）→ R/B 采样位移差 2.0px（规范 §3.3：1–2.5px）
    edgeSharp: 0.65,       // 斜面采样中「锐利地图纹理」占比（0=全模糊，1=全锐；锐才看得见 2px 级彩边）
    pressDur: 170,         // 按下回弹时长 ms（规范 §3.5：120–180ms）
    tint: 0.02,            // 白色 tint ≤2%
    tintCol: [0.98, 0.99, 1.0],
    fillCol: [1.0, 1.0, 1.0],   // 面填充=白色（Apple face 2%）
    fillLo: 0.02, fillHi: 0.08, // 暗/亮背景面填充
    fillClear: 0.02,
    interiorRegular: 0.90,
    interiorClear: 0.75,
    dimClear: 0.35,        // Apple 官方：clear 亮背景 35% 暗化
    brightL: 0.60,
    maxSurfaces: 16,       // 安全上限（9 卡 + 顶部功能条；不再有「同屏 ≤5」）
    maxDPR: 2
  };

  /* ── 玻璃面：9 张卡全部玻璃 + 顶部功能条/chip（每卡一个独立 quad） ─────── */
  var SURF = [
    { id: 'data-panel',          variant: 'regular', radius: 16,  pad: 0, sel: ['#data-panel'] },
    { id: 'scene-panel',         variant: 'regular', radius: 16,  pad: 0, sel: ['#scene-panel'] },
    { id: 'pp-toggles',          variant: 'regular', radius: 16,  pad: 0, sel: ['#pp-toggles'] },
    { id: 'cctv-panel',          variant: 'regular', radius: 16,  pad: 0, sel: ['#cctv-panel'] },
    { id: 'global-context-panel',variant: 'regular', radius: 16,  pad: 0, sel: ['#global-context-panel'] },
    { id: 'location-bar',        variant: 'regular', radius: 16,  pad: 0, sel: ['#location-bar'] },
    { id: 'control-panel',       variant: 'regular', radius: 16,  pad: 0, sel: ['#control-panel'] },
    { id: 'gev-voice-control',   variant: 'regular', radius: 16,  pad: 0, sel: ['#gev-voice-control'] },
    { id: 'gev-gfx-fab',         variant: 'clear',   radius: 999, pad: 0, sel: ['#gev-gfx-fab'] },
    { id: 'topbar',              variant: 'regular', radius: 18,  pad: 0, sel: ['#top-center-actions'] },
    { id: 'locate-chip',         variant: 'clear',   radius: 999, pad: 0, sel: ['#gev-locate-btn'] },
    { id: 'perf-chip',           variant: 'clear',   radius: 999, pad: 0, sel: ['#gev-perf-wrap'] },
    { id: 'lang-chip',           variant: 'clear',   radius: 999, pad: 0, sel: ['#gev-lang-toggle'] }
  ];

  /* ── 告诉 viewer：玻璃层需要 preserveDrawingBuffer（必须在本脚本执行时置位，
        经典脚本在 module 之前执行 → src/app/viewer.js 读得到） ───────────── */
  window.__GEV_GL_PRESERVE = true;
  try { localStorage.setItem('gev.gfx.liquidGlass', '1'); } catch (e) {}

  function bigGLCanvas() {
    var cs = document.querySelectorAll('canvas'), best = null, area = 0;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.id === 'gev-gl-glass') continue;   // 自身合成层不是地图源
      if (!c.getContext || c.width < 800 || c.height < 500) continue;
      var gl = null; try { gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'); } catch (e) {}
      if (!gl) continue; var a = c.width * c.height; if (a > area) { area = a; best = c; }
    }
    return best;
  }
  function mapReadable() {
    var c = bigGLCanvas(); if (!c) return false;
    try {
      var t = document.createElement('canvas'); t.width = 32; t.height = 32;
      var g2 = t.getContext('2d'); g2.drawImage(c, 0, 0, c.width, c.height, 0, 0, 32, 32);  // 整幅缩略，避免只看左上角
      var d = g2.getImageData(0, 0, 32, 32).data, s = 0;
      for (var i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return (s / (d.length / 4 * 3)) > 8;
    } catch (e) { return false; }
  }

  /* ── 着色器 ───────────────────────────────────────────────────────────── */
  var VS_FULL = ['#version 300 es', 'in vec2 aUV; out vec2 vUv;', 'void main(){ vUv=aUV; gl_Position=vec4(aUV*2.0-1.0,0.0,1.0); }'].join('\n');

  var FS_BLUR = [
    '#version 300 es', 'precision highp float;', 'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDir; uniform float uRad;',
    'void main(){',
    '  vec2 t = uTexel * uDir * uRad;',
    '  vec3 s = texture(uTex, vUv).rgb * 0.2270270270;',
    '  s += texture(uTex, vUv + t*1.3846153846).rgb * 0.3162162162;',
    '  s += texture(uTex, vUv - t*1.3846153846).rgb * 0.3162162162;',
    '  s += texture(uTex, vUv + t*3.2307692308).rgb * 0.0702702703;',
    '  s += texture(uTex, vUv - t*3.2307692308).rgb * 0.0702702703;',
    '  o = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var VS_CARD = [
    '#version 300 es', 'in vec2 aUV;',
    'uniform vec4 uRect; uniform vec2 uRes;', 'out vec2 vPx;',
    'void main(){ vec2 pos = uRect.xy + aUV*uRect.zw; vPx = pos;',
    '  gl_Position = vec4(pos.x/uRes.x*2.0-1.0, 1.0-pos.y/uRes.y*2.0, 0.0, 1.0); }'
  ].join('\n');

  /* 核心：
     · 四分之一圆斜面 surfaceHeight(t) + Snell → 边缘折射（中心 dh≈0，完全不偏）
     · 3 条独立光线 R/G/B（偏移系数 0.82/1.00/1.22）→ 边缘分离彩边（R/B 约 2px），中心无
     · 双侧 45°/-135° 高光（amount .5 / curvature 1.7 / spread 1.59 / smoothness 8）
     · 面填充白色 0.02–0.08（按背景亮度自适应）；clear 亮背景 35% 暗化
     · 输出 alpha：regular .90 / clear .75（边缘趋 1） */
  var FS_CARD = [
    '#version 300 es', 'precision highp float;',
    'in vec2 vPx; out vec4 o;',
    'uniform sampler2D uMap, uBg;',
    'uniform vec2 uRes, uMouse;',
    'uniform vec4 uRect;',
    'uniform float uRadius, uDpr, uBezel, uThick, uIOR, uGain, uAnim,',
    '              uRimAmt, uCurv, uSpread, uSmooth, uInterior, uFillLo, uFillHi,',
    '              uInnerDark, uTint, uDim, uEtaLo, uEtaHi, uMouseOn, uTime,',
    '              uDispPx, uPress, uEdgeSharp;',
    'uniform vec3 uTintCol, uFillCol;',
    'float sdRound(vec2 p, vec2 hs, float r){',
    '  vec2 q = abs(p) - hs + vec2(r);',
    '  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'float surfaceHeight(float t){',
    '  float s = 1.0 - t;',
    '  return pow(max(1.0 - s*s*s*s, 0.0), 0.25);',
    '}',
    'vec3 spectrum(float f){',
    // 仅保留为「可见光谱色」参考（当前色散走三条独立光线，不再做光谱加权求和）
    '  float r = smoothstep(0.58, 0.86, f);',
    '  float g = smoothstep(0.30, 0.46, f) * (1.0 - smoothstep(0.54, 0.74, f));',
    '  float b = 1.0 - smoothstep(0.18, 0.44, f);',
    '  return vec3(r, g, b) + vec3(0.03);',
    '}',
    'void main(){',
    '  vec2 hs = uRect.zw * 0.5 * (1.0 - 0.015 * uPress);',   // 按下：SDF 绕中心缩到 0.985（gel 压缩）
    '  vec2 c  = uRect.xy + uRect.zw * 0.5;',
    '  vec2 p  = vPx - c;',
    '  float d = sdRound(p, hs, uRadius);',
    '  if (d > 0.0) discard;',
    '  float depth = -d;',
    '  float e = max(1.0, uDpr);',
    '  float gx = sdRound(p + vec2(e,0.0), hs, uRadius) - sdRound(p - vec2(e,0.0), hs, uRadius);',
    '  float gy = sdRound(p + vec2(0.0,e), hs, uRadius) - sdRound(p - vec2(0.0,e), hs, uRadius);',
    '  vec2 n = normalize(vec2(gx, gy) + vec2(1e-6));',
    '  float bezel = max(uBezel * (1.0 + 0.25 * uAnim + 0.06 * uPress), 0.001);',
    '  float t = clamp(depth / bezel, 0.0, 1.0);',
    '  float h = surfaceHeight(t);',
    '  float dh = (surfaceHeight(min(t + 0.02, 1.0)) - h) / 0.02;',
    '  float thick = uThick * (1.0 + 0.55 * uAnim) * (1.0 + 0.10 * uPress);',
    '  float slope = min(atan(dh * (thick / bezel)), 1.25);',
    '  vec2 uv = vPx / uRes;',
    '  float edgeBand = 1.0 - smoothstep(0.0, 1.0, t);',      // 边缘 1 → 带内 0（中心严格 0）
    // 色散开关/强度：eta 区间为 0（复核 A/B 用 etaLo==etaHi）→ gate=0，三条光线完全重合
    '  float dispGate = clamp((uEtaHi - uEtaLo) / 0.08, 0.0, 1.0);',
    '  float dEdge = uDispPx * uDpr * edgeBand * dispGate;',   // CSS px → 设备 px
    '  vec3 col;',
    '  if (t > 0.985) {',
    '    col = texture(uBg, uv).rgb;',
    '  } else {',
    '    float sRr = sin(slope) / uIOR;',
    '    float thRr = asin(clamp(sRr, -1.0, 1.0));',
    '    float dBase = h * thick * (tan(slope) - tan(thRr)) * uGain;',   // 真 Snell 斜面折射（中心 0）
    '    vec2 dir = -n;',
    // 三条独立光线：R/G/B 各自偏移系数 0.82 / 1.00 / 1.22（规范 §3.3 工程目标值），
    // 每条光线只取自己的通道 → 斜面内 R、B 轮廓真正错开（不是亮度差、不是假彩虹贴图）。
    '    vec2 uvR = uv + dir * (dBase + dEdge * 0.82) / uRes;',
    '    vec2 uvG = uv + dir * (dBase + dEdge * 1.00) / uRes;',
    '    vec2 uvB = uv + dir * (dBase + dEdge * 1.22) / uRes;',
    // 斜面是透镜不是磨砂面：带内按 uEdgeSharp 混入较锐的地图纹理（mip1），2px 级通道错位才落得下可见彩边；
    // 面内（t>0.985 分支）仍用模糊纹理，保持磨砂观感。LOD 固定，避免斜面大导数把 mip 拉糊。
    '    vec3 cR = mix(texture(uBg, uvR).rgb, textureLod(uMap, uvR, 1.0).rgb, uEdgeSharp);',
    '    vec3 cG = mix(texture(uBg, uvG).rgb, textureLod(uMap, uvG, 1.0).rgb, uEdgeSharp);',
    '    vec3 cB = mix(texture(uBg, uvB).rgb, textureLod(uMap, uvB, 1.0).rgb, uEdgeSharp);',
    '    col = vec3(cR.r, cG.g, cB.b);',
    '  }',
    '  vec2 uv0 = uRect.xy / uRes, uv1 = (uRect.xy + uRect.zw) / uRes;',
    '  float L = luma(textureLod(uMap, (uv0+uv1)*0.5, 3.0).rgb) * 0.40;',
    '  L += luma(textureLod(uMap, mix(uv0,uv1,vec2(0.25,0.25)), 3.0).rgb) * 0.20;',
    '  L += luma(textureLod(uMap, mix(uv0,uv1,vec2(0.75,0.25)), 3.0).rgb) * 0.20;',
    '  L += luma(textureLod(uMap, mix(uv0,uv1,vec2(0.5,0.85)), 3.0).rgb) * 0.20;',
    '  float fillA = mix(uFillLo, uFillHi, smoothstep(0.35, 0.80, L));',
    '  col = mix(col, uFillCol, fillA);',
    '  col = mix(col, uTintCol, uTint);',
    '  col = mix(col, col * 0.65, uDim * smoothstep(0.55, 0.70, L));',
    '  col *= 1.0 - uInnerDark * (1.0 - smoothstep(0.0, bezel * 0.45, depth));',
    '  vec2 d1 = normalize(vec2(0.7071, -0.7071));',
    '  float band = exp(-pow(t / max(uSpread * 0.35, 0.01), 2.0) * (uSmooth * 0.25));',
    '  float hl = pow(max(dot(n, d1), 0.0), uCurv) + pow(max(dot(n, -d1), 0.0), uCurv);',
    '  if (uMouseOn > 0.5) {',
    '    vec2 mp = (uMouse - (uRect.xy + hs)) / max(hs.x, 1.0);',
    '    hl *= 1.0 + 0.10 * clamp(dot(normalize(mp + vec2(1e-4)), n), 0.0, 1.0);',
    '  }',
    '  float line = smoothstep(1.8 * uDpr, 0.2 * uDpr, depth) * 0.14;',
    '  float rimK = uRimAmt * (1.0 + 0.35 * uPress);',        // 按下：边缘光增强（§3.5）
    '  col = mix(col, vec3(1.0), clamp(hl * band * rimK + line, 0.0, 0.72));',
    '  float gn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453 + uTime);',
    '  col += (gn - 0.5) * 0.004;',
    '  float aa = smoothstep(0.0, 1.2 * uDpr, depth);',
    // 输出 alpha（§3.3）：内部保持 uInterior（regular 0.90 / clear 0.75），
    // 只有最外 ~2 CSS px 的 AA 过渡才趋 1（轮廓压边，不是「整片不透明拷贝」）。
    '  float edgeA = 1.0 - smoothstep(0.0, 1.8 * uDpr, depth);',
    '  float opac = mix(uInterior, 1.0, edgeA);',
    '  o = vec4(col, opac * aa);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[gev-gl] shader', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  function program(gl, vsSrc, fsSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc), fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[gev-gl] link', gl.getProgramInfoLog(p)); return null; }
    return p;
  }

  /* ── 验收专用：合成条纹背景（只用于量测色散位移，不参与产品路径） ─────────
     开：window.__gevGlTestBg(true) → 背景纹理换成 8 CSS px 周期黑白竖条，
     于是斜面内 R/G/B 三个轮廓的横向错开可以直接用互相关量出来。 */
  var TESTBG = { on: false, css: 8 };
  window.__gevGlTestBg = function (on, css) {
    TESTBG.on = !!on; if (css) TESTBG.css = +css;
    return { on: TESTBG.on, css: TESTBG.css };
  };

  var mouse = { x: 0, y: 0, on: 0 };
  function onMove(ev) { if (ev.clientX == null) return; mouse.x = ev.clientX; mouse.y = ev.clientY; mouse.on = 1; }

  function start() {
    var map = bigGLCanvas();
    if (!map) { setTimeout(start, 700); return; }
    if (!document.querySelector('#data-panel')) { setTimeout(start, 700); return; }
    if (document.getElementById('gev-gl-glass')) return;
    if (!mapReadable()) {
      start._t = (start._t || 0) + 1;
      if (start._t < 24) { setTimeout(start, 1200); return; }
      console.warn('[gev-gl] 地图不可读，回退磨砂（CSS 标准材质）');
      return;
    }

    var cv = document.createElement('canvas');
    cv.id = 'gev-gl-glass';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;';
    document.body.appendChild(cv);
    document.documentElement.classList.add('gev-gl-on');

    var gl = cv.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) { console.warn('[gev-gl] 无 WebGL2'); document.documentElement.classList.remove('gev-gl-on'); cv.remove(); return; }

    var blurProg = program(gl, VS_FULL, FS_BLUR);
    var cardProg = program(gl, VS_CARD, FS_CARD);
    if (!blurProg || !cardProg) return;

    var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    var blurALoc = gl.getAttribLocation(blurProg, 'aUV');
    var cardALoc = gl.getAttribLocation(cardProg, 'aUV');
    var bU = {}, cU = {};
    ['uTex', 'uTexel', 'uDir', 'uRad'].forEach(function (k) { bU[k] = gl.getUniformLocation(blurProg, k); });
    ['uMap', 'uBg', 'uRes', 'uRect', 'uRadius', 'uDpr', 'uBezel', 'uThick', 'uIOR', 'uGain', 'uAnim',
      'uRimAmt', 'uCurv', 'uSpread', 'uSmooth', 'uInterior', 'uFillLo', 'uFillHi',
      'uInnerDark', 'uTint', 'uDim', 'uEtaLo', 'uEtaHi', 'uMouseOn', 'uTime', 'uTintCol', 'uFillCol', 'uMouse',
      'uDispPx', 'uPress', 'uEdgeSharp'
    ].forEach(function (k) { cU[k] = gl.getUniformLocation(cardProg, k); });

    var mapTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, mapTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    function makeTarget(w, h) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { t: t, f: f, w: w, h: h };
    }

    var ds = document.createElement('canvas'), dctx = ds.getContext('2d', { alpha: false });
    function paintTestBg() {          // 验收（见 TESTBG）
      /* css < 0 → 纯白合成底（第四轮自查用）：本机 Cesium 渲染循环被冻结后没有任何帧提交，
         gl.clearColor+clear 只会写 drawing buffer、不会 present（卡外区域 p50 恒为卫星图的 0.131），
         所以「纯白最坏底」改由玻璃自己的采样源构造：ds 直接填 #ffffff，
         再用 __gevGlStats().surfaces[*].lum === 1.000 + __gevGlProbe().dsLum === 1.000 自证。 */
      if (TESTBG.css < 0) {
        dctx.fillStyle = '#ffffff'; dctx.fillRect(0, 0, ds.width, ds.height);
        return;
      }
      var k = ds.width / Math.max(1, W);
      var pw = Math.max(3, Math.round(TESTBG.css * scale * k));
      dctx.fillStyle = '#f2f2f2'; dctx.fillRect(0, 0, ds.width, ds.height);   // 中性灰白：R=G=B
      dctx.fillStyle = '#0c0c0c';
      for (var x = 0; x < ds.width; x += pw * 2) dctx.fillRect(x, 0, pw, ds.height);
    }
    /* 分辨率策略（规范 §5.4 / 复核阻塞项 3）：
       目标档 = min(devicePixelRatio, 2) —— 1536 CSS 宽 @ dsf2 → canvas 3072 设备像素（真 2x，
       18px 斜面与白 rim 不再被上采样成柔带，160fps 也不再取自降级态）。
       只有超宽屏才受 MAXW=4096 设备像素上限约束（2560CSS@2x=5120 → 压到 4096 ≈1.6x）。
       运行期自适应见 adaptScale()：降档后若帧时没改善会恢复并判定「非玻璃瓶颈」；
       连续 N 帧 <8ms 且有冷却期时也会逐级升回目标档（修复「只降不升」）。 */
    var MAXW = 4096;
    function pickScale() {
      var s = Math.min(window.devicePixelRatio || 1, CFG.maxDPR);
      if (innerWidth * s > MAXW) s = MAXW / innerWidth;
      return Math.max(0.5, s);
    }
    var scale = pickScale();
    var FA = null, FB = null, FT = null, W = 1, H = 1, Wb = 1, Hb = 1;

    function resize() {
      W = Math.round(innerWidth * scale); H = Math.round(innerHeight * scale);
      cv.width = W; cv.height = H;
      Wb = Math.max(2, Math.ceil(W * 0.5)); Hb = Math.max(2, Math.ceil(H * 0.5));
      ds.width = Wb; ds.height = Hb;   // 背景纹理半分辨率上传（模糊半径本来只有 2px）
      [FA, FB, FT].forEach(function (o) { if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } });
      FA = makeTarget(Wb, Hb); FB = makeTarget(Wb, Hb); FT = makeTarget(Wb, Hb);
      applyUniforms();
    }

    function applyUniforms() {
      gl.useProgram(cardProg);
      gl.uniform2f(cU.uRes, W, H);
      gl.uniform1f(cU.uDpr, scale);
      gl.uniform1f(cU.uBezel, CFG.edge * scale);
      gl.uniform1f(cU.uThick, CFG.thick * scale);
      gl.uniform1f(cU.uIOR, CFG.ior);
      gl.uniform1f(cU.uGain, CFG.gain);
      gl.uniform1f(cU.uRimAmt, CFG.rimAmt);
      gl.uniform1f(cU.uCurv, CFG.curvature);
      gl.uniform1f(cU.uSpread, CFG.spread);
      gl.uniform1f(cU.uSmooth, CFG.smoothness);
      gl.uniform1f(cU.uInnerDark, CFG.innerDark);
      gl.uniform1f(cU.uTint, CFG.tint);
      gl.uniform1f(cU.uEtaLo, CFG.etaLo);
      gl.uniform1f(cU.uEtaHi, CFG.etaHi);
      gl.uniform1f(cU.uDispPx, CFG.dispPx);
      gl.uniform1f(cU.uEdgeSharp, CFG.edgeSharp);
      gl.uniform3f(cU.uTintCol, CFG.tintCol[0], CFG.tintCol[1], CFG.tintCol[2]);
      gl.uniform3f(cU.uFillCol, CFG.fillCol[0], CFG.fillCol[1], CFG.fillCol[2]);
    }
    applyUniforms();
    resize();   // 初始化画布尺寸 + FBO + uniform（漏掉会导致 W=1/H=1 → 所有玻璃面被离屏裁剪掉）
    window.addEventListener('resize', function () { scale = pickScale(); resize(); });
    document.addEventListener('mousemove', onMove, true);

    /* ── resolution 自适应（复核阻塞项 3：不能「只降不升」） ──────────────
       判据优先用 GPU 计时查询（EXT_disjoint_timer_query_webgl2）测「玻璃层自己」的耗时，
       不把 Cesium 瓦片解码/编译的抖动算到玻璃头上（这是上一版误降档的根因）：
       降：玻璃 GPU 耗时 p50 >8.5ms 连续 3 窗口（无计时扩展时 p50 >40ms 连续 5 窗口）→ -0.25 档；
       验：降档 1.6s 后耗时没改善 → 判定瓶颈不在玻璃，恢复原档并 60s 内不再降；
       升：玻璃 GPU 耗时 <5.5ms、降档满 2s → +0.25 档，逐级回到目标档（真 2x）。
       无计时扩展时退回帧时判据（p50 >40ms 才降、<9ms 才升）——阈值刻意很高，避免 Cesium 瓦片加载误降档。 */
    var tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    var tqRing = [], tqMs = [], tqBad = 0, finishMs = [], finishTick = 0;
    function tqBegin() {
      if (!tq) return null;
      try {
        var q = gl.createQuery ? gl.createQuery() : tq.createQuery();
        tq.beginQuery(tq.TIME_ELAPSED_EXT, q);
        return q;
      } catch (e) { tq = null; return null; }
    }
    function tqEnd(q) {
      if (!q) return;
      tq.endQuery(tq.TIME_ELAPSED_EXT);
      tqRing.push({ q: q, f: stats.frames });
    }
    function tqPoll() {
      if (!tq) return;
      var disj = false;
      try { disj = !!gl.getParameter(tq.GPU_DISJOINT_EXT); } catch (e) {}
      while (tqRing.length && tqRing[0].f < stats.frames - 2) {
        var e = tqRing.shift(), ok = false;
        try { ok = !!tq.getQueryParameter(e.q, tq.QUERY_RESULT_AVAILABLE); } catch (er) {}
        if (ok && !disj) {
          try {
            var ns = tq.getQueryParameter(e.q, tq.QUERY_RESULT);
            tqMs.push(ns / 1e6); if (tqMs.length > 60) tqMs.shift();
            stats.gpuMs = +tqMs.slice().sort(function (a, b) { return a - b; })[Math.floor(tqMs.length / 2)].toFixed(2);
          } catch (er2) {}
        } else if (disj) tqBad++;
        try { (gl.deleteQuery ? gl.deleteQuery(e.q) : tq.deleteQuery(e.q)); } catch (er3) {}
      }
    }

    var scaleTarget = pickScale(), lastDown = -1e9, probeAt = 0, downFrom = scale,
      downCost = 0, noDegradeUntil = 0, warmupUntil = performance.now() + 8000, badStreak = 0, scaleEvents = [];
    function noteScale(ev, from, to) {
      scaleEvents.push({ t: Math.round(performance.now()), ev: ev, from: +from.toFixed(2), to: +to.toFixed(2) });
      if (scaleEvents.length > 24) scaleEvents.shift();
    }
    function glassCost() {                                   // 玻璃自身耗时（ms）
      if (tqMs.length >= 6) return tqMs.slice().sort(function (a, b) { return a - b; })[Math.floor(tqMs.length / 2)];
      if (finishMs.length >= 6) return finishMs.slice().sort(function (a, b) { return a - b; })[Math.floor(finishMs.length / 2)];
      return null;
    }
    function adaptScale(t, p50, p90) {
      scaleTarget = pickScale();
      var gc = glassCost();
      if (probeAt && t - probeAt > 1600) {
        var now = gc != null ? gc : p50;
        if (now > 0.8 * downCost) {                          // 降了也没变快 → 不是玻璃瓶颈
          noteScale('revert-not-glass', scale, downFrom);
          scale = downFrom; resize(); noDegradeUntil = t + 60000;
        } else {
          noDegradeUntil = t + 4000;
        }
        probeAt = 0; lastDown = t;
      }
      if (t < warmupUntil) return;
      var costly = gc != null ? (gc > 8.5) : (p50 > 200);   // 无计时扩展时：只在 <5fps 的灾难态才降（正常场景永不降）
      if (costly && t > noDegradeUntil && scale > 0.75 + 1e-3) {
        if (++badStreak >= (gc != null ? 3 : 8)) {
          downFrom = scale; downCost = gc != null ? gc : p50; probeAt = t; lastDown = t; badStreak = 0;
          noteScale('down(cost=' + (gc != null ? gc.toFixed(1) + 'ms-gpu' : Math.round(p50) + 'ms-p50') + ')',
            scale, Math.max(0.75, scale - 0.25));
          scale = Math.max(0.75, scale - 0.25); resize();
          return;
        }
      } else badStreak = 0;
      var cheap = gc != null ? (gc < 5.5) : (p50 < 9);
      if (cheap && scale < scaleTarget - 1e-3 && t - lastDown > 2000) {
        noteScale('up', scale, Math.min(scaleTarget, scale + 0.25));
        scale = Math.min(scaleTarget, scale + 0.25); resize(); lastDown = t;
      }
    }

    /* ── 按下 flex/energize（规范 §3.5 / §5.1 末条）：玻璃边光增强 + 内容层压缩 1.5% ── */
    var press = { t0: -1e9 };
    function pressEl(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el = null;
      for (var i = 0; i < SURF.length && !el; i++) {
        for (var k = 0; k < SURF[i].sel.length && !el; k++) {
          var hit = t.closest(SURF[i].sel[k]);
          if (hit) el = hit;
        }
      }
      if (!el) return;
      press.t0 = performance.now();
      el.classList.remove('gev-glass-press');
      void el.offsetWidth;                       // 重启动画（连点也回弹）
      el.classList.add('gev-glass-press');
      setTimeout(function () { el.classList.remove('gev-glass-press'); }, CFG.pressDur + 60);
    }
    document.addEventListener('pointerdown', pressEl, true);
    window.__gevGlPress = function () { press.t0 = performance.now(); return true; };
    window.__gevGlScale = {
      get: function () { return scale; },
      target: function () { return scaleTarget; },
      device: function () { return [cv.width, cv.height]; },
      events: function () { return scaleEvents; },
      force: function (s) { scale = Math.max(0.5, Math.min(2, +s || 1)); resize(); lastDown = -1e9; return scale; }
    };

    /* 验收钩子：运行期改常量 / 读回像素 */
    window.__gevGlSet = function (patch) {
      if (!patch) return CFG;
      Object.keys(patch).forEach(function (k) { CFG[k] = patch[k]; });
      applyUniforms();
      return CFG;
    };
    window.__gevGlReadPixel = function (x, y) {
      try {
        var px = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(Math.round(x * scale), Math.round(H - y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2], px[3]];
      } catch (e) { return null; }
    };

    /* ── 亮度采样（CSS 侧对比度用；320ms 一次） ───────────────────────── */
    var lumCv = document.createElement('canvas'); lumCv.width = 4; lumCv.height = 4;
    var lumCtx = lumCv.getContext('2d', { willReadFrequently: true });
    function measureLum(r) {
      try {
        var k = ds.width / Math.max(1, W);
        lumCtx.drawImage(ds, Math.max(0, r.x * k), Math.max(0, r.y * k), Math.max(2, r.w * k), Math.max(2, r.h * k), 0, 0, 4, 4);
        var d = lumCtx.getImageData(0, 0, 4, 4).data, s = 0;
        for (var i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return s / (16 * 255);
      } catch (e) { return 0.35; }
    }

    /* ── 玻璃面收集（离屏裁剪 / 每卡一个 quad） ─────────────────────────── */
    function visible(el) {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 6 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    }
    var lumCache = {};
    function collect() {
      var out = [];
      for (var i = 0; i < SURF.length; i++) {
        var s = SURF[i], u = null;
        for (var k = 0; k < s.sel.length; k++) {
          var els = document.querySelectorAll(s.sel[k]);
          for (var j = 0; j < els.length; j++) {
            var el = els[j];
            if (!visible(el)) continue;
            var r = el.getBoundingClientRect();
            if (!u) u = { l: r.left, t: r.top, r: r.right, b: r.bottom };
            else { u.l = Math.min(u.l, r.left); u.t = Math.min(u.t, r.top); u.r = Math.max(u.r, r.right); u.b = Math.max(u.b, r.bottom); }
          }
        }
        if (!u) continue;
        var pad = s.pad || 0;
        var box = { x: (u.l - pad) * scale, y: (u.t - pad) * scale, w: (u.r - u.l + pad * 2) * scale, h: (u.b - u.t + pad * 2) * scale };
        if (box.w < 8 || box.h < 8) continue;
        if (box.x + box.w <= 0 || box.y + box.h <= 0 || box.x >= W || box.y >= H) continue;   // 离屏不渲染
        var rr = s.radius >= 999 ? Math.min(box.w, box.h) * 0.5 : (s.radius || 16) * scale;
        // 斜面宽度按卡片自身最小边自适应（小胶囊不会被 18px 边缘带吃掉整块）：6–18px
        var cssW = u.r - u.l + pad * 2, cssH = u.b - u.t + pad * 2;
        var bezel = Math.min(CFG.edge, Math.max(6, Math.min(cssW, cssH) * 0.22));
        out.push({
          id: s.id, variant: s.variant, tag: s.tag || s.id, el: el,
          x: box.x, y: box.y, w: box.w, h: box.h, bezel: bezel,
          css: { x: u.l - pad, y: u.t - pad, w: u.r - u.l + pad * 2, h: u.b - u.t + pad * 2 },
          radius: Math.min(rr, Math.min(box.w, box.h) * 0.5),
          lum: lumCache[s.id] || 0
        });
      }
      return out;
    }

    function bindQuad(prog, loc) { gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }

    var stats = { fps: 0, frames: 0, lastFrame: 0, surfaces: [], scale: scale };
    var ft = [], lastT = 0, fc = 0, lumT = 0;

    function frame(t) {
      requestAnimationFrame(frame);           // 不节流：玻璃与卡片同帧更新
      var dt = lastT ? t - lastT : 16.7; lastT = t;
      if (dt > 0) { ft.push(dt); if (ft.length > 90) ft.shift(); }
      if (ft.length >= 30) {
        var sorted = ft.slice().sort(function (a, b) { return a - b; });
        var p50 = sorted[Math.floor(sorted.length * 0.5)];
        var p90 = sorted[Math.floor(sorted.length * 0.9)];
        stats.fps = Math.round(1000 / p50);
        stats.p90 = +p90.toFixed(1);
        stats.avgMs = +(ft.reduce(function (a, b) { return a + b; }, 0) / ft.length).toFixed(2);
        adaptScale(t, p50, p90, stats.avgMs);
      }

      var anim = 0;
      var A = window.__gevGlassAnim;
      if (A && A.dur > 0) {
        var k = (t - A.t0) / A.dur;
        if (k < 0) k = 0;                       // rAF 时间戳早于 performance.now() 时钳 0
        if (k > 1) window.__gevGlassAnim = null; else anim = Math.sin(Math.PI * k);
      }
      var animating = (window.__gevGlassAnimCount || 0) > 0;

      var list = collect();
      if (!list.length) { stats.surfaces = []; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try {
        if (TESTBG.on) paintTestBg(); else dctx.drawImage(map, 0, 0, ds.width, ds.height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ds);
        if ((fc++ % 12) === 0) gl.generateMipmap(gl.TEXTURE_2D);
      } catch (e) { return; }

      /* 单档小半径模糊（参考 blur 1.5–3）：2 遍分离高斯，半分辨率 */
      var tqQ = tqBegin();                       // GPU 计时：从这里到卡片画完，只量玻璃层自己
      var sampleFinish = false;   // gl.finish() 会与 Cesium 的 GPU 队列串行化（实测 164fps→11fps），禁用
      var finT0 = sampleFinish ? performance.now() : 0;
      gl.disable(gl.BLEND);
      bindQuad(blurProg, blurALoc);
      gl.uniform1i(bU.uTex, 0);
      gl.uniform2f(bU.uTexel, 1.0 / Wb, 1.0 / Hb);
      gl.uniform1f(bU.uRad, Math.max(0.6, CFG.blur * scale * 0.5) * (animating ? 0.8 : 1));

      gl.bindFramebuffer(gl.FRAMEBUFFER, FT.f); gl.viewport(0, 0, Wb, Hb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.uniform2f(bU.uDir, 1.0, 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, FA.f); gl.viewport(0, 0, Wb, Hb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, FT.t);
      gl.uniform2f(bU.uDir, 0.0, 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      /* 合成 */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      // alpha 通道必须走 (ONE, ONE_MINUS_SRC_ALPHA)：SRC_ALPHA 会把输出 alpha 平方（0.90→0.81、0.75→0.5625），
      // 导致 §3.3 的「内部 alpha = uInterior」在画布上失真；RGB 仍按预乘叠。
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      bindQuad(cardProg, cardALoc);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, FA.t);
      gl.uniform1i(cU.uMap, 0); gl.uniform1i(cU.uBg, 1);
      gl.uniform1f(cU.uTime, t * 0.001);
      gl.uniform2f(cU.uMouse, mouse.x * scale, mouse.y * scale);
      gl.uniform1f(cU.uMouseOn, mouse.on ? 1 : 0);
      gl.uniform1f(cU.uAnim, anim);
      var pk = (t - press.t0) / CFG.pressDur;
      press.amt = (pk >= 0 && pk < 1) ? Math.sin(Math.PI * pk) : 0;
      gl.uniform1f(cU.uPress, press.amt);

      var doLum = t - lumT > 320;
      if (doLum) lumT = t;
      var readout = [];
      for (var j = 0; j < list.length; j++) {
        var cd = list[j];
        var isClear = cd.variant === 'clear';
        var fLo = isClear ? CFG.fillClear : CFG.fillLo;
        var fHi = isClear ? CFG.fillClear : CFG.fillHi;
        var interior = isClear ? CFG.interiorClear : CFG.interiorRegular;
        var dim = isClear ? 1.0 : 0.0;    // clear 在 shader 内按背景亮度做 35% 暗化
        if (doLum) { cd.lum = measureLum({ x: cd.x, y: cd.y, w: cd.w, h: cd.h }); lumCache[cd.id] = cd.lum; }
        /* 逐卡亮度自适应：每张卡按「自己背后」的亮度决定 scrim 档（不是全屏一个开关），
           否则一张卡压在亮地图上、其余卡在暗处时，那张卡的标题就没有底板可依。 */
        if (cd.el) {
          var want = cd.lum > CFG.brightL ? 'bright' : 'dark';
          if (cd.el.dataset.gevLum !== want) cd.el.dataset.gevLum = want;
        }
        gl.uniform4f(cU.uRect, cd.x, cd.y, cd.w, cd.h);
        gl.uniform1f(cU.uRadius, cd.radius);
        gl.uniform1f(cU.uBezel, (cd.bezel || CFG.edge) * scale);
        gl.uniform1f(cU.uInterior, interior);
        gl.uniform1f(cU.uFillLo, fLo);
        gl.uniform1f(cU.uFillHi, fHi);
        gl.uniform1f(cU.uDim, dim);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        readout.push({
          id: cd.id, tag: cd.tag, variant: cd.variant, lum: +cd.lum.toFixed(3), bezel: +(cd.bezel || CFG.edge).toFixed(1),
          dim: isClear ? CFG.dimClear : 0, interior: interior,
          fill: +(fLo + (fHi - fLo) * Math.min(1, Math.max(0, (cd.lum - 0.35) / 0.45))).toFixed(3),
          rect: [Math.round(cd.css.x), Math.round(cd.css.y), Math.round(cd.css.w), Math.round(cd.css.h)],
          radius: Math.round(cd.radius / scale)
        });
      }
      tqEnd(tqQ);
      /* 验收钩子（只读、不改渲染）：同帧内读回玻璃缓冲区 alpha，
         用于 §3.3「输出 alpha：regular 0.86–0.92 / clear 0.70–0.80」自证。
         用法：page.evaluate(() => window.__gevGlAlphaProbe = [[x,y],...]) → 下一帧读 __gevGlAlphaOut */
      if (window.__gevGlAlphaProbe && window.__gevGlAlphaProbe.length) {
        var abuf = new Uint8Array(4), ares = [];
        for (var q = 0; q < window.__gevGlAlphaProbe.length; q++) {
          var pt = window.__gevGlAlphaProbe[q];
          gl.readPixels(Math.round(pt[0] * scale), Math.round(H - pt[1] * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, abuf);
          ares.push([abuf[3], abuf[0], abuf[1], abuf[2]]);
        }
        window.__gevGlAlphaOut = ares;
        window.__gevGlAlphaOutFrame = stats.frames;
      }
      if (sampleFinish) {                        // 无计时扩展时：每 30 帧 gl.finish() 采样一次玻璃层真实耗时
        gl.finish();
        finishMs.push(performance.now() - finT0);
        if (finishMs.length > 25) finishMs.shift();
        stats.gpuMs = +finishMs.slice().sort(function (a, b) { return a - b; })[Math.floor(finishMs.length / 2)].toFixed(2);
      }
      stats.surfaces = readout;
      stats.frames++;
      stats.lastFrame = Math.round(t);
      tqPoll();

      var bright = readout.some(function (s) { return s.lum > CFG.brightL; });
      document.documentElement.dataset.gevGlassLum = bright ? 'bright' : 'dark';
    }
    requestAnimationFrame(frame);

    window.__gevGlStats = function () {
      return {
        fps: stats.fps, frames: stats.frames, scale: scale,
        scaleTarget: scaleTarget, devicePx: [cv.width, cv.height], dpr: window.devicePixelRatio || 1,
        avgMs: stats.avgMs, p90: stats.p90, gpuMs: stats.gpuMs == null ? null : stats.gpuMs,
        timerQuery: !!tq, scaleEvents: scaleEvents.slice(-8),
        count: stats.surfaces.length, max: CFG.maxSurfaces,
        surfaces: stats.surfaces,
        config: {
          edge: CFG.edge, thick: CFG.thick, ior: CFG.ior, blur: CFG.blur, dispN: 3, dispPx: CFG.dispPx,
          etaLo: CFG.etaLo, etaHi: CFG.etaHi, rimAmt: CFG.rimAmt, curvature: CFG.curvature,
          spread: CFG.spread, smoothness: CFG.smoothness,
          fillLo: CFG.fillLo, fillHi: CFG.fillHi, interiorRegular: CFG.interiorRegular,
          interiorClear: CFG.interiorClear, dimClear: CFG.dimClear, tint: CFG.tint
        }
      };
    };

    /* 诊断：纹理是否真的可读（避免「玻璃是黑的」这类假通过） */
    window.__gevGlProbe = function () {
      var out = { readable: false, dsLum: null, dsMax: null, mapSize: null, dsSize: [ds.width, ds.height] };
      try {
        out.readable = mapReadable();
        var c = document.createElement('canvas'); c.width = 64; c.height = 64;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(ds, 0, 0, 64, 64);
        var d = cx.getImageData(0, 0, 64, 64).data, s = 0, mx = 0;
        for (var i = 0; i < d.length; i += 4) { var l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; if (l > mx) mx = l; }
        out.dsLum = +(s / (64 * 64 * 255)).toFixed(3); out.dsMax = Math.round(mx);
        out.mapSize = map ? [map.width, map.height] : null;
        out.sample = measureLum({ x: 40, y: 80, w: 200, h: 60 });
      } catch (e) { out.err = String(e); }
      return out;
    };
  }

  setTimeout(start, 1200);
})();
