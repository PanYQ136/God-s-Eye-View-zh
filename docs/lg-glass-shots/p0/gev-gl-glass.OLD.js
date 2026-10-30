/* ============================================================================
   gev-gl-glass.js —— 上帝之眼：Apple 风液态玻璃折射层（WebGL2 · Stage 3+）
   ----------------------------------------------------------------------------
   基于「玻璃不像 Apple 的根因」文档做的 P0/P1 增强（作用于全部卡片模块）：
     A. 边缘透镜带 3.5px → 12px（色散/Fresnel/bevel 有可见空间）
     B. 真三通道色散（R/G/B 按不同折射率分离 ~2-3px，中心干净）
     C. 内部真通透：玻璃层内部 alpha 1.0 → ~0.86（地图从玻璃后透出，不再是不透明拷贝）
     D. Fresnel 增强、tint 降低（不再发灰）
     E. 玻璃层 60fps（跟随卡片 60fps 动画，不再一顿一顿、拖影变小）
     F. 展开/收起动画期间降载：跳过双遍模糊与 mipmap（更顺、更少拖影）
   多层(sharp/mid/far)、每卡材质、噪点、鼠标高光、双遍分离高斯、DPR≤3 自适应 沿用。
   前置：Cesium preserveDrawingBuffer=true（自动置 gev.gfx.pdb 并重载一次）。
   回滚：恢复 ~/ego/gev-gl-glass.stage3.js。
   ========================================================================== */
(function () {
  'use strict';
  if (window.__gevGlStage3b) return; window.__gevGlStage3b = true;

  var STATIC_SEL = ['#pp-toggles', '#cctv-panel', '#global-context-panel', '#data-panel', '#scene-panel', '#gev-voice-control'];
  var DYN = [{ panel: 'location-bar' }, { panel: 'control-panel' }];
  var MAXC = 48;

  // Apple 风参数（CSS px，按 DPR 换算）
  var P = {
    thick: 14, refract: 1.15,
    edge: 12,        // 边缘透镜带宽
    blurR: 1.6,
    tint: 0.015, tintCol: [0.72, 0.86, 1.0],
    disp: 2.5,       // 色散偏移基准（device px，Apple 1.5–2.5px 克制彩边）
    interior: 0.86   // 玻璃内部不透明度（<1 = 真通透）
  };

  var DEFAULT_MAT = { thick: 1.0, tint: 1.0, fres: 1.0, hue: [0.72, 0.86, 1.0] };
  var MAT = {
    'data-panel':           { thick: 1.00, tint: 1.00, fres: 1.00, hue: [0.72, 0.86, 1.00] },
    'scene-panel':          { thick: 1.05, tint: 1.05, fres: 0.95, hue: [0.75, 0.86, 0.98] },
    'pp-toggles':           { thick: 0.85, tint: 0.85, fres: 1.15, hue: [0.70, 0.85, 1.00] },
    'cctv-panel':           { thick: 1.15, tint: 1.10, fres: 0.95, hue: [0.72, 0.85, 1.00] },
    'global-context-panel': { thick: 1.00, tint: 1.00, fres: 1.00, hue: [0.73, 0.86, 1.00] },
    'gev-voice-control':    { thick: 0.90, tint: 0.90, fres: 1.10, hue: [0.70, 0.85, 1.00] },
    'location-bar':         { thick: 0.80, tint: 0.85, fres: 1.10, hue: [0.72, 0.86, 1.00] },
    'control-panel':        { thick: 1.00, tint: 1.00, fres: 1.00, hue: [0.72, 0.86, 1.00] }
  };

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
      var c = cs[i]; if (!c.getContext || c.width < 800 || c.height < 500) continue;
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
    '#version 300 es', 'in vec2 aUV;', 'uniform vec4 uRect; uniform vec2 uRes;', 'out vec2 vPx;',
    'void main(){ vec2 pos = uRect.xy + aUV*uRect.zw; vPx=pos;',
    '  gl_Position = vec4(pos.x/uRes.x*2.0-1.0, 1.0-pos.y/uRes.y*2.0, 0.0, 1.0); }'
  ].join('\n');

  var FS_CARD = [
    '#version 300 es', 'precision highp float;',
    'in vec2 vPx; out vec4 o;',
    'uniform sampler2D uMap; uniform sampler2D uBlurT;',
    'uniform vec2 uRes; uniform vec4 uRect; uniform vec4 uRad;',
    'uniform float uThick,uEdge,uRefract,uTint,uBlurR,uDpr,uTime,uFarLod,uDispPx,uInterior;',
    'uniform vec3 uTintCol; uniform vec4 uMat; uniform vec2 uMouse; uniform float uMouseOn;',
    'float sd(vec2 pp,vec2 hs,float rr){ vec2 q=abs(pp)-hs+rr; return length(max(q,0.0))+min(max(q.x,q.y),0.0)-rr; }',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'void main(){',
    '  vec2 c=uRect.xy+uRect.zw*0.5; vec2 hs=uRect.zw*0.5; vec2 p=vPx-c;',
    '  float rr=(p.x>0.0)?((p.y<0.0)?uRad.y:uRad.z):((p.y<0.0)?uRad.x:uRad.w);',
    '  float d=sd(p,hs,rr); if(d>0.0) discard;',
    '  float depth=-d; float e=1.0*uDpr;',
    '  float dx=sd(p+vec2(e,0.0),hs,rr)-sd(p-vec2(e,0.0),hs,rr);',
    '  float dy=sd(p+vec2(0.0,e),hs,rr)-sd(p-vec2(0.0,e),hs,rr);',
    '  vec2 n=normalize(vec2(dx,dy)+1e-6);',
    '  float rim=1.0-smoothstep(0.0,uEdge,depth);',   // 0 中心 → 1 边缘（12px 透镜带）
    '  float th=uThick*uMat.x;',
    '  vec2 uv=vPx/uRes; vec2 ruv=uv + n*(th/uRes)*rim*uRefract;',
    // 多层：sharp(LOD0) / mid(双遍) / far(mip)
    '  vec3 sharp=textureLod(uMap,ruv,0.0).rgb;',
    '  vec3 mid=texture(uBlurT,ruv).rgb;',
    '  vec3 far=textureLod(uMap,ruv,uFarLod).rgb;',
    '  vec3 layers=mix(mid,far,smoothstep(0.0,1.0,rim));',
    '  float bmix=mix(0.10,0.85,rim);',
    '  vec3 col=mix(sharp,layers,bmix);',
    // Fresnel（掠射边缘反射）
    '  float fres=pow(clamp(rim,0.0,1.0),2.2)*uMat.z;',
    '  col=mix(col, vec3(0.60,0.80,1.0), clamp(fres*0.7, 0.0, 0.72));',
    // bevel 内高光/内阴影
    '  vec2 L=normalize(vec2(-0.6,-1.0)); float ndl=dot(n,L);',
    '  float hi=smoothstep(0.05,1.0,ndl)*rim; float sh=smoothstep(0.05,1.0,-ndl)*rim;',
    '  col+=vec3(0.92,0.98,1.0)*hi*0.18; col*=1.0-sh*0.20;',
    '  float crest=smoothstep(0.0,0.08,rim)*(1.0-smoothstep(0.08,0.26,rim));',
    '  col+=vec3(0.90,0.97,1.0)*crest*0.14;',
    // 鼠标高光
    '  if(uMouseOn>0.5){ vec2 mp=(vPx-uMouse)/uDpr; float mh=exp(-dot(mp,mp)/(2.0*110.0*110.0));',
    '    col+=vec3(0.92,0.97,1.0)*mh*0.16*(0.5+0.5*rim); }',
    // 噪点
    '  float gn=hash(gl_FragCoord.xy+fract(uTime)*vec2(37.0,17.0)); col+=(gn-0.5)*0.010;',
    // 染色（更淡）
    '  col=mix(col, uTintCol, uTint*uMat.y);',
    // 边缘去饱和：绿地不再把整圈染绿
    '  float rimD=smoothstep(0.0,1.0,rim);',
    '  float lum=dot(col, vec3(0.299,0.587,0.114));',
    '  col=mix(col, vec3(lum), rimD*0.50);',
    // 中性冷白玻璃边（Apple 风冷光，而非主题青）
    '  col=mix(col, vec3(0.82,0.90,1.0), rimD*0.24);',
    // 色散：差分式色差（只取地图梯度的 R/G/B 偏移量，高对比边缘才出彩边、均匀区不出、不整圈绿）
    '  if(rim>0.02){',
    '    vec2 b = n * (uDispPx * rim) / uRes;',
    '    float fr = smoothstep(0.0,0.5,rim);',
    '    float sR = textureLod(uMap, ruv + b*1.00, 0.0).r;',
    '    float sG = textureLod(uMap, ruv + b*0.15, 0.0).g;',
    '    float sB = textureLod(uMap, ruv - b*1.00, 0.0).b;',
    '    col.r += (sR - sharp.r) * fr * 1.5;',
    '    col.g += (sG - sharp.g) * fr * 0.55;',
    '    col.b += (sB - sharp.b) * fr * 1.5;',
    '  }',
    // 真通透：内部 alpha ~0.86，边缘趋于 1，最外 1.2px 抗锯齿
    '  float aa=smoothstep(0.0, 1.2*uDpr, depth);',
    '  float opac=mix(uInterior, 1.0, smoothstep(0.0, uEdge, depth));',
    '  float alpha=opac*aa;',
    '  o=vec4(col, alpha);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[gev-gl3] shader', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  function program(gl, vsSrc, fsSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc), fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[gev-gl3] link', gl.getProgramInfoLog(p)); return null; }
    return p;
  }
  function parseRad(v, mn) {
    if (!v) return 0; var f = parseFloat(v) || 0;
    if (v.indexOf('%') >= 0) f = mn * (f / 100);
    return Math.max(0, Math.min(f, mn * 0.5));
  }
  function radiiOf(el, w, h) {
    var cs = getComputedStyle(el), m = Math.min(w, h);
    return [parseRad(cs.borderTopLeftRadius, m), parseRad(cs.borderTopRightRadius, m), parseRad(cs.borderBottomRightRadius, m), parseRad(cs.borderBottomLeftRadius, m)];
  }

  var mouse = { x: 0, y: 0, on: 0 };
  function onMove(ev) { if (ev.clientX == null) return; mouse.x = ev.clientX; mouse.y = ev.clientY; mouse.on = 1; }

  function start() {
    var map = bigGLCanvas();
    if (!map) { setTimeout(start, 800); return; }
    if (!STATIC_SEL.some(function (s) { return document.querySelector(s); })) { setTimeout(start, 800); return; }
    if (document.getElementById('gev-gl-glass')) return;
    if (!mapReadable()) {
      start._t = (start._t || 0) + 1;
      if (start._t < 24) { setTimeout(start, 1500); return; }
      console.warn('[gev-gl3] 地图不可读，回退磨砂');
      return;
    }

    var cv = document.createElement('canvas');
    cv.id = 'gev-gl-glass';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;';
    document.body.appendChild(cv);
    document.documentElement.classList.add('gev-gl-on');

    var gl = cv.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) { console.warn('[gev-gl3] 无 WebGL2，回退磨砂'); document.documentElement.classList.remove('gev-gl-on'); cv.remove(); return; }

    var blurProg = program(gl, VS_FULL, FS_BLUR);
    var compProg = program(gl, VS_CARD, FS_CARD);
    if (!blurProg || !compProg) return;

    var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    var blurALoc = gl.getAttribLocation(blurProg, 'aUV');
    var cardALoc = gl.getAttribLocation(compProg, 'aUV');
    var bU = {}, cU = {};
    ['uTex', 'uTexel', 'uDir', 'uRad'].forEach(function (k) { bU[k] = gl.getUniformLocation(blurProg, k); });
    ['uMap', 'uBlurT', 'uRes', 'uRect', 'uRad', 'uThick', 'uEdge', 'uRefract', 'uTint', 'uBlurR', 'uDpr', 'uTime', 'uFarLod', 'uDispPx', 'uInterior', 'uTintCol', 'uMat', 'uMouse', 'uMouseOn']
      .forEach(function (k) { cU[k] = gl.getUniformLocation(compProg, k); });

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
    var baseScale = Math.min(window.devicePixelRatio || 1, 3);
    var scale = baseScale;
    var FA = null, FB = null, W = 1, H = 1, Wb = 1, Hb = 1;

    function resize() {
      W = Math.round(innerWidth * scale); H = Math.round(innerHeight * scale);
      cv.width = W; cv.height = H; ds.width = W; ds.height = H;
      Wb = Math.max(2, Math.ceil(W * 0.4)); Hb = Math.max(2, Math.ceil(H * 0.4));
      if (FA) { gl.deleteTexture(FA.t); gl.deleteFramebuffer(FA.f); }
      if (FB) { gl.deleteTexture(FB.t); gl.deleteFramebuffer(FB.f); }
      FA = makeTarget(Wb, Hb); FB = makeTarget(Wb, Hb);
      var dpr = scale;
      var farLod = Math.max(1.0, Math.min(6.0, Math.log2(Math.min(W, H) / 90)));
      gl.useProgram(compProg);
      gl.uniform2f(cU.uRes, W, H);
      gl.uniform1f(cU.uDpr, dpr);
      gl.uniform1f(cU.uThick, P.thick * dpr);
      gl.uniform1f(cU.uEdge, P.edge * dpr);
      gl.uniform1f(cU.uRefract, P.refract);
      gl.uniform1f(cU.uTint, P.tint);
      gl.uniform1f(cU.uBlurR, P.blurR);
      gl.uniform1f(cU.uFarLod, farLod);
      gl.uniform1f(cU.uDispPx, P.disp * dpr);
      gl.uniform1f(cU.uInterior, P.interior);
      gl.useProgram(blurProg);
      gl.uniform1f(bU.uRad, P.blurR);
    }
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('mousemove', onMove, true);

    var list = [];
    function addEl(el) {
      if (!el || list.length >= MAXC) return;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return;
      var cs = getComputedStyle(el);
      list.push({ l: r.left, t: r.top, w: r.width, h: r.height, rad: radiiOf(el, r.width, r.height),
        z: (parseFloat(cs.zIndex) || 0), order: list.length, mat: (MAT[el.id] || DEFAULT_MAT) });
    }

    function bindQuad(prog, loc) { gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }

    var ft = [], last = 0, fc = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (t - last < 1000 / 60) return;   // 60fps（跟随卡片动画）
      var dt = t - last; last = t;
      var anim = (window.__gevGlassAnimCount || 0) > 0;   // 展开/收起动画期间降载

      ft.push(dt);
      if (ft.length >= 45) {
        var avg = ft.reduce(function (a, b) { return a + b; }, 0) / ft.length; ft = [];
        if (avg > 46 && scale > 1.5) { scale = Math.max(1.5, scale - 0.25); resize(); }
      }

      list = [];
      for (var i = 0; i < STATIC_SEL.length; i++) {
        var els = document.querySelectorAll(STATIC_SEL[i]);
        for (var k = 0; k < els.length; k++) addEl(els[k]);
      }
      for (var d2 = 0; d2 < DYN.length; d2++) {
        var panel = document.getElementById(DYN[d2].panel);
        if (panel && panel.classList.contains('gev-lc-floating')) addEl(panel);
      }
      list.sort(function (a, b) { return (a.z - b.z) || (a.order - b.order); });

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try { dctx.drawImage(map, 0, 0, ds.width, ds.height); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ds); if (!anim && (fc++ % 3) === 0) gl.generateMipmap(gl.TEXTURE_2D); } catch (e) { return; }

      // 动画期间跳过双遍模糊（更顺、更少拖影），静止时正常
      if (!anim) {
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, FA.f); gl.viewport(0, 0, Wb, Hb);
        bindQuad(blurProg, blurALoc);
        gl.uniform1i(bU.uTex, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
        gl.uniform2f(bU.uTexel, 1.0 / W, 1.0 / H); gl.uniform2f(bU.uDir, 1.0, 0.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, FB.f); gl.viewport(0, 0, Wb, Hb);
        bindQuad(blurProg, blurALoc);
        gl.uniform1i(bU.uTex, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, FA.t);
        gl.uniform2f(bU.uTexel, 1.0 / Wb, 1.0 / Hb); gl.uniform2f(bU.uDir, 0.0, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      bindQuad(compProg, cardALoc);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, FB.t);
      gl.uniform1i(cU.uMap, 0); gl.uniform1i(cU.uBlurT, 1);
      gl.uniform1f(cU.uTime, t * 0.001);
      gl.uniform2f(cU.uMouse, mouse.x * scale, mouse.y * scale);
      gl.uniform1f(cU.uMouseOn, mouse.on ? 1 : 0);

      for (var j = 0; j < list.length; j++) {
        var cd = list[j], m = cd.mat;
        gl.uniform4f(cU.uRect, cd.l * scale, cd.t * scale, cd.w * scale, cd.h * scale);
        gl.uniform4f(cU.uRad, cd.rad[0] * scale, cd.rad[1] * scale, cd.rad[2] * scale, cd.rad[3] * scale);
        gl.uniform4f(cU.uMat, m.thick, m.tint, m.fres, 0.0);
        gl.uniform3f(cU.uTintCol, m.hue[0], m.hue[1], m.hue[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    requestAnimationFrame(frame);
  }

  setTimeout(start, 1500);
})();
