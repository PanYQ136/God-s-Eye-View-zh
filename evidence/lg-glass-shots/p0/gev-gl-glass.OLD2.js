/* ============================================================================
   gev-gl-glass.js —— 上帝之眼 · Apple Liquid Glass 折射层（P0 重做版 2026-10-26）
   ----------------------------------------------------------------------------
   规范：D:\Hermes\docs\上帝之眼-Apple液态玻璃1比1复刻强制规范-20261026.md
   本文件只做「功能层」玻璃：顶部工具条 / 左栏 / 右栏 / 底部 dock /（动态）展开卡或地图浮动控件。
   内容层（列表行、视频框、正文）由 CSS 标准材质负责，不是玻璃。

   P0-2 透镜 shader
     · SDF 圆角矩形求外法线：中心法线≈0，边缘最强（非径向放大）
     · 折射沿 SDF 法线：偏移 = 厚度 × rim^1.7 × (refract-1) × gain
     · 边缘透镜带 12 CSS px（10–16 区间），中心完全干净
     · 分通道色散：R/G/B 各自按不同 IOR(0.82/1.00/1.22) 采样背景，边缘 1–2.5px，中心 0
     · 白色 specular rim（0.27）+ 软边界光 + 内侧暗边，无 1px 实体 border
     · 输出 alpha：regular 内部 0.90，clear 0.75（边缘趋 1，最外 1.3px 抗锯齿）
   P0-3 两变体
     · regular：fill 0.10–0.24（按采样亮度自适应），blur 中心 10px / 边缘 16px
     · clear：fill 0.05，背景亮度 L>0.6 叠加 35% 暗化（Apple 官方数值）
   P0-4 动效
     · 展开/收起期间 window.__gevGlassAnim 驱动：透镜带与厚度同步增强（透镜调制，不是 fade）
   P0-5 数量
     · 同屏玻璃 ≤ 5 面；静态 4 面 + 动态 1 面（展开卡优先于地图浮动控件）
   P2 性能
     · 每面一个 quad；离屏/隐藏不渲染；每帧不节流
       （旧版 `t-last<1000/60` 在 60Hz 上会隔帧丢弃 → 玻璃层实际 30fps，是拖影根因）
   前置：Cesium preserveDrawingBuffer=true（自动置 gev.gfx.pdb 并重载一次）。
   ========================================================================== */
(function () {
  'use strict';
  if (window.__gevGlLiquid) return;
  window.__gevGlLiquid = true;

  /* ── 工程目标值（规范 §3.3；Apple 未公开的逼近值，非官方数字） ─────────── */
  var CFG = {
    edge: 12,             // 透镜带宽 CSS px（10–16）
    thick: 22,            // 玻璃厚度
    refract: 1.35,        // 折射率（1.3–1.4）
    gain: 1.10,           // 位移总增益（把「厚度×折射」折成屏幕像素）
    dispPx: 2.4,          // 色散基准（边缘 1–2.5px）
    dispCoeff: [0.82, 1.0, 1.22],
    blurCenter: 10,       // 中心模糊
    blurEdge: 16,         // 边缘模糊
    rimWhite: 0.27,       // 白色 specular rim（0.24–0.30）
    innerDark: 0.20,
    tint: 0.02,           // 染色 ≤2%
    tintCol: [0.95, 0.975, 1.0],
    fillCol: [0.035, 0.05, 0.075],
    fillLo: 0.10, fillHi: 0.24,   // regular 暗/亮背景 fill
    fillClear: 0.05,
    interiorRegular: 0.90,
    interiorClear: 0.75,
    dimClear: 0.35,       // Apple 官方：clear 亮背景 35% 暗化
    brightL: 0.60,
    maxSurfaces: 16,      // 安全上限（不再有「同屏 ≤5」限制：9 卡 + 顶部功能条）
    maxDPR: 2
  };

  /* ── 玻璃面定义：9 张卡片全部玻璃（用户决策 2026-10-26 15:12）+ 顶部功能条 ─────
     · 每张卡一个独立 quad（不合并成 rail 大矩形），透镜/色散/rim 逐卡按自身尺寸算
     · 不再有「同屏 ≤5」限制；性能靠离屏裁剪 + 每卡 quad + 动画降载保证 60fps
     · variant：regular = 面板卡（亮背景提 fill/对比）；clear = 地图上的圆形 FAB（亮背景叠 35% dim） */
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

  /* ── 保留 Cesium 绘制缓冲（读回地图纹理） ─────────────────────────────── */
  try {
    var g = JSON.parse(localStorage.getItem('gev.gfx') || '{}') || {};
    if (g.pdb !== true) {
      g.pdb = true; localStorage.setItem('gev.gfx', JSON.stringify(g));
      if (!sessionStorage.getItem('gev.gl.armed')) { sessionStorage.setItem('gev.gl.armed', '1'); location.reload(); return; }
    }
  } catch (e) {}

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
      var g2 = t.getContext('2d'); g2.drawImage(c, 0, 0, 32, 32);
      var d = g2.getImageData(0, 0, 32, 32).data, s = 0;
      for (var i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return (s / (d.length / 4 * 3)) > 16;
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

  var FS_CARD = [
    '#version 300 es', 'precision highp float;',
    'in vec2 vPx; out vec4 o;',
    'uniform sampler2D uMap, uB10, uB16;',
    'uniform vec2 uRes, uMouse;',
    'uniform vec4 uRect;',
    'uniform float uRadius, uDpr, uEdge, uThick, uRefract, uGain, uDisp, uRimW,',
    '              uInnerDark, uInterior, uFillLo, uFillHi, uDim, uTint, uAnim, uMouseOn, uTime;',
    'uniform vec3 uTintCol, uFillCol;',
    'float sdRound(vec2 p, vec2 hs, float r){',
    '  vec2 q = abs(p) - hs + vec2(r);',
    '  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'void main(){',
    '  vec2 hs = uRect.zw * 0.5;',
    '  vec2 c  = uRect.xy + hs;',
    '  vec2 p  = vPx - c;',
    '  float d = sdRound(p, hs, uRadius);',
    '  if (d > 0.0) discard;',
    '  float depth = -d;',
    '  float e = max(1.0, uDpr);',
    '  float gx = sdRound(p + vec2(e,0.0), hs, uRadius) - sdRound(p - vec2(e,0.0), hs, uRadius);',
    '  float gy = sdRound(p + vec2(0.0,e), hs, uRadius) - sdRound(p - vec2(0.0,e), hs, uRadius);',
    '  vec2 n = normalize(vec2(gx, gy) + vec2(1e-6));',
    '  float band = uEdge * (1.0 + 0.35 * uAnim);',
    '  float rim  = 1.0 - smoothstep(0.0, band, depth);',
    '  float rimN = pow(rim, 1.7);',
    '  vec2 uv0 = uRect.xy / uRes, uv1 = (uRect.xy + uRect.zw) / uRes;',
    '  float L = luma(textureLod(uMap, (uv0+uv1)*0.5, 5.0).rgb) * 0.40;',
    '  L += luma(textureLod(uMap, mix(uv0,uv1,vec2(0.28,0.28)), 5.0).rgb) * 0.15;',
    '  L += luma(textureLod(uMap, mix(uv0,uv1,vec2(0.72,0.28)), 5.0).rgb) * 0.15;',
    '  L += luma(textureLod(uMap, mix(uv0,uv1,vec2(0.28,0.72)), 5.0).rgb) * 0.15;',
    '  L += luma(textureLod(uMap, mix(uv0,uv1,vec2(0.72,0.72)), 5.0).rgb) * 0.15;',
    '  float thick = uThick * (1.0 + 0.70 * uAnim);',
    '  vec2 offPx = n * (thick * rimN * (uRefract - 1.0) * uGain);',
    '  vec2 uv  = vPx / uRes;',
    '  vec2 ruv = uv + offPx / uRes;',
    '  vec3 col = mix(texture(uB10, ruv).rgb, texture(uB16, ruv).rgb, rim);',
    '  if (rim > 0.02) {',
    '    vec2 dd = n * (uDisp * rim * (1.0 + 0.5*uAnim)) / uRes;',
    '    vec3 dc;',
    '    dc.r = texture(uB16, ruv + dd * 0.82).r;',
    '    dc.g = texture(uB16, ruv + dd * 1.00).g;',
    '    dc.b = texture(uB16, ruv + dd * 1.22).b;',
    '    col = mix(col, dc, smoothstep(0.0, 0.35, rim));',
    '  }',
    '  col = mix(col, uTintCol, uTint);',
    '  float l0 = luma(col);',
    '  col = mix(vec3(l0), col, 1.14);',
    '  float fillA = mix(uFillLo, uFillHi, smoothstep(0.35, 0.80, L));',
    '  col = mix(col, uFillCol, fillA);',
    '  col = mix(col, uFillCol * 0.65, uDim * smoothstep(0.55, 0.70, L));',
    '  col *= 1.0 - uInnerDark * (1.0 - smoothstep(0.0, band * 0.55, depth));',
    '  vec2 Ld = normalize(vec2(-0.42, -0.91));',
    '  if (uMouseOn > 0.5) {',
    '    vec2 mp = (uMouse - (uRect.xy + hs)) / max(hs.x, 1.0);',
    '    Ld = normalize(Ld + mp * 0.22);',
    '  }',
    '  float ndl = dot(n, Ld);',
    '  float spec = pow(max(ndl, 0.0), 1.8) * smoothstep(0.0, 0.30, rim) * uRimW;',
    '  float softLine = exp(-depth / (2.2 * uDpr)) * 0.16;',          // 边缘内侧柔光
    '  float hardLine = smoothstep(2.4 * uDpr, 0.2 * uDpr, depth) * 0.22;', // 最外 2px 白 rim（替代 1px 实线 border）
    '  col = mix(col, vec3(1.0), clamp(spec + softLine + hardLine, 0.0, 0.62));',
    '  float gn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453 + uTime);',
    '  col += (gn - 0.5) * 0.006;',
    '  float aa = smoothstep(0.0, 1.3 * uDpr, depth);',
    '  float opac = mix(uInterior, 1.0, smoothstep(0.0, band * 0.8, depth));',
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

  var mouse = { x: 0, y: 0, on: 0 };
  function onMove(ev) { if (ev.clientX == null) return; mouse.x = ev.clientX; mouse.y = ev.clientY; mouse.on = 1; }

  function start() {
    var map = bigGLCanvas();
    if (!map) { setTimeout(start, 700); return; }
    if (!document.querySelector(SURF[0].sel[0])) { setTimeout(start, 700); return; }
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
    ['uMap', 'uB10', 'uB16', 'uRes', 'uRect', 'uRadius', 'uDpr', 'uEdge', 'uThick', 'uRefract', 'uGain',
      'uDisp', 'uRimW', 'uInnerDark', 'uInterior', 'uFillLo', 'uFillHi', 'uDim', 'uTint', 'uAnim',
      'uMouseOn', 'uTime', 'uTintCol', 'uFillCol', 'uMouse'].forEach(function (k) { cU[k] = gl.getUniformLocation(cardProg, k); });

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
    var scale = Math.min(window.devicePixelRatio || 1, CFG.maxDPR);
    var FA = null, FB = null, FT = null, W = 1, H = 1, Wb = 1, Hb = 1;

    function resize() {
      W = Math.round(innerWidth * scale); H = Math.round(innerHeight * scale);
      cv.width = W; cv.height = H;
      Wb = Math.max(2, Math.ceil(W * 0.5)); Hb = Math.max(2, Math.ceil(H * 0.5));
      // 背景纹理按半分辨率上传（模糊本身就在半分辨率做，视觉无损，拷贝/上传量降到 1/4）
      ds.width = Wb; ds.height = Hb;
      [FA, FB, FT].forEach(function (o) { if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } });
      FA = makeTarget(Wb, Hb); FB = makeTarget(Wb, Hb); FT = makeTarget(Wb, Hb);
      applyUniforms();
    }

    function applyUniforms() {
      gl.useProgram(cardProg);
      gl.uniform2f(cU.uRes, W, H);
      gl.uniform1f(cU.uDpr, scale);
      gl.uniform1f(cU.uEdge, CFG.edge * scale);
      gl.uniform1f(cU.uThick, CFG.thick * scale);
      gl.uniform1f(cU.uRefract, CFG.refract);
      gl.uniform1f(cU.uGain, CFG.gain);
      gl.uniform1f(cU.uDisp, CFG.dispPx * scale);
      gl.uniform1f(cU.uRimW, CFG.rimWhite);
      gl.uniform1f(cU.uInnerDark, CFG.innerDark);
      gl.uniform1f(cU.uTint, CFG.tint);
      gl.uniform3f(cU.uTintCol, CFG.tintCol[0], CFG.tintCol[1], CFG.tintCol[2]);
      gl.uniform3f(cU.uFillCol, CFG.fillCol[0], CFG.fillCol[1], CFG.fillCol[2]);
    }
    applyUniforms();
    /* 验收用调试钩子：运行期改参数（P0 验收：透镜/色散开-关像素差对比，证明「边缘带 + 中心干净」） */
    window.__gevGlSet = function (patch) {
      if (!patch) return CFG;
      Object.keys(patch).forEach(function (k) { CFG[k] = patch[k]; });
      applyUniforms();
      return CFG;
    };
    /* 读回合成层像素（仅在验收时开启 preserveDrawingBuffer 才可用，否则返回 null） */
    window.__gevGlReadPixel = function (x, y) {
      try {
        var px = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(Math.round(x * scale), Math.round(H - y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2], px[3]];
      } catch (e) { return null; }
    };
    resize();
    window.addEventListener('resize', function () { scale = Math.min(window.devicePixelRatio || 1, CFG.maxDPR); resize(); });
    document.addEventListener('mousemove', onMove, true);

    /* ── 亮度采样（CSS 侧对比度/统计用；每 320ms 一次，1x1 读回） ───────── */
    var lumCv = document.createElement('canvas'); lumCv.width = 4; lumCv.height = 4;
    var lumCtx = lumCv.getContext('2d', { willReadFrequently: true });
    function measureLum(r) {
      try {
        // r 是设备像素坐标（W×H），ds 是半分辨率 → 换算到 ds 坐标
        var k = ds.width / Math.max(1, W);
        lumCtx.drawImage(ds, Math.max(0, r.x * k), Math.max(0, r.y * k), Math.max(2, r.w * k), Math.max(2, r.h * k), 0, 0, 4, 4);
        var d = lumCtx.getImageData(0, 0, 4, 4).data, s = 0;
        for (var i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return s / (16 * 255);
      } catch (e) { return 0.35; }
    }

    /* ── 玻璃面收集 ─────────────────────────────────────────────────────── */
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
        // 离屏裁剪：完全在视口外的面不产生 quad
        if (box.x + box.w <= 0 || box.y + box.h <= 0 || box.x >= W || box.y >= H) continue;
        var rr = s.radius >= 999 ? Math.min(box.w, box.h) * 0.5 : (s.radius || 16) * scale;
        out.push({
          id: s.id, variant: s.variant, tag: s.tag || s.id,
          x: box.x, y: box.y, w: box.w, h: box.h,
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
        stats.fps = Math.round(1000 / sorted[Math.floor(sorted.length * 0.5)]);
        var avg = ft.reduce(function (a, b) { return a + b; }, 0) / ft.length;
        if (avg > 22 && scale > 1) { scale = Math.max(1, scale - 0.25); resize(); }
      }

      var anim = 0;
      var A = window.__gevGlassAnim;
      if (A && A.dur > 0) {
        // rAF 时间戳可能早于 performance.now()（帧起点）→ 负值钳到 0，不能判为「已结束」
        var k = (t - A.t0) / A.dur;
        if (k < 0) k = 0;
        if (k > 1) window.__gevGlassAnim = null; else anim = Math.sin(Math.PI * k);
      }
      var animating = (window.__gevGlassAnimCount || 0) > 0;

      var list = collect();
      if (!list.length) { stats.surfaces = []; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try {
        dctx.drawImage(map, 0, 0, ds.width, ds.height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ds);
        if ((fc++ % 4) === 0) gl.generateMipmap(gl.TEXTURE_2D);
      } catch (e) { return; }

      /* 两档模糊：中心 10px / 边缘 16px（半分辨率双遍分离高斯）
         动画期间降载：只做中心档、半径降 25%，两档纹理共用 → 仍与卡片同帧，不掉帧 */
      gl.disable(gl.BLEND);
      bindQuad(blurProg, blurALoc);
      gl.uniform1i(bU.uTex, 0);
      gl.uniform2f(bU.uTexel, 1.0 / Wb, 1.0 / Hb);
      gl.uniform2f(bU.uDir, 1.0, 0.0);

      gl.bindFramebuffer(gl.FRAMEBUFFER, FT.f); gl.viewport(0, 0, Wb, Hb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.uniform1f(bU.uRad, CFG.blurCenter * scale * 0.5 * 0.55 * (animating ? 0.75 : 1));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, FA.f); gl.viewport(0, 0, Wb, Hb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, FT.t);
      gl.uniform2f(bU.uDir, 0.0, 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!animating) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, FT.f); gl.viewport(0, 0, Wb, Hb);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
        gl.uniform2f(bU.uDir, 1.0, 0.0);
        gl.uniform1f(bU.uRad, CFG.blurEdge * scale * 0.5 * 0.55);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, FB.f); gl.viewport(0, 0, Wb, Hb);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, FT.t);
        gl.uniform2f(bU.uDir, 0.0, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      /* 合成 */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      bindQuad(cardProg, cardALoc);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, FA.t);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, animating ? FA.t : FB.t);
      gl.uniform1i(cU.uMap, 0); gl.uniform1i(cU.uB10, 1); gl.uniform1i(cU.uB16, 2);
      gl.uniform1f(cU.uTime, t * 0.001);
      gl.uniform2f(cU.uMouse, mouse.x * scale, mouse.y * scale);
      gl.uniform1f(cU.uMouseOn, mouse.on ? 1 : 0);
      gl.uniform1f(cU.uAnim, anim);

      var doLum = t - lumT > 320;
      if (doLum) lumT = t;
      var readout = [];
      for (var j = 0; j < list.length; j++) {
        var cd = list[j];
        var isClear = cd.variant === 'clear';
        var fLo = isClear ? CFG.fillClear : CFG.fillLo;
        var fHi = isClear ? CFG.fillClear : CFG.fillHi;
        var interior = isClear ? CFG.interiorClear : CFG.interiorRegular;
        var dim = isClear ? CFG.dimClear : 0.0;
        if (doLum) { cd.lum = measureLum({ x: cd.x, y: cd.y, w: cd.w, h: cd.h }); lumCache[cd.id] = cd.lum; }
        gl.uniform4f(cU.uRect, cd.x, cd.y, cd.w, cd.h);
        gl.uniform1f(cU.uRadius, cd.radius);
        gl.uniform1f(cU.uInterior, interior);
        gl.uniform1f(cU.uFillLo, fLo);
        gl.uniform1f(cU.uFillHi, fHi);
        gl.uniform1f(cU.uDim, dim);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        readout.push({
          id: cd.id, tag: cd.tag, variant: cd.variant, lum: +cd.lum.toFixed(3), dim: dim, interior: interior,
          fill: +(fLo + (fHi - fLo) * Math.min(1, Math.max(0, (cd.lum - 0.35) / 0.45))).toFixed(3),
          rect: [Math.round(cd.css.x), Math.round(cd.css.y), Math.round(cd.css.w), Math.round(cd.css.h)],
          radius: Math.round(cd.radius / scale)
        });
      }
      stats.surfaces = readout;
      stats.frames++;
      stats.lastFrame = Math.round(t);

      var bright = readout.some(function (s) { return s.lum > CFG.brightL; });
      document.documentElement.dataset.gevGlassLum = bright ? 'bright' : 'dark';
    }
    requestAnimationFrame(frame);

    window.__gevGlStats = function () {
      return {
        fps: stats.fps, frames: stats.frames, scale: scale,
        count: stats.surfaces.length, max: CFG.maxSurfaces,
        surfaces: stats.surfaces,
        config: {
          edge: CFG.edge, thick: CFG.thick, refract: CFG.refract, dispPx: CFG.dispPx, dispCoeff: CFG.dispCoeff,
          blurCenter: CFG.blurCenter, blurEdge: CFG.blurEdge, rimWhite: CFG.rimWhite,
          interiorRegular: CFG.interiorRegular, interiorClear: CFG.interiorClear, dimClear: CFG.dimClear, tint: CFG.tint
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
