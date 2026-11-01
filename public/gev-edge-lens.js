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

  /* ── Phase8D #15：模块总线垫片 ─────────────────────────────────────────────
     本文件是 classic script，在 `<script>` 解析期执行，早于 defer 的 src/bridge.js。
     所以这里先写兼容面（window.__gevEdge*），并在总线就绪（gev:bridge-ready）时
     **把同一批对象注册进去**（桥采用同一引用，不是复制）——加载顺序不再是契约。
     两个 grab 通道不迁移：它们由验收脚本（scripts/lc/*.mjs）直接写、本文件同帧读，
     是仪器通道而非应用通信面。 */
  var BRIDGE_PENDING = {};
  function bus() {
    return (typeof globalThis !== 'undefined' && globalThis.__gevBridge) || null;
  }
  function publish(name, value, global) {
    window[global] = value;
    if (value != null) BRIDGE_PENDING[name] = { value: value, global: global };
    var B = bus();
    if (B) adoptPending(B);
    return value;
  }
  function adoptPending(B) {
    for (var name in BRIDGE_PENDING) {
      var it = BRIDGE_PENDING[name];
      try { B.register(name, it.value, { global: it.global, owner: 'public/gev-edge-lens.js', replace: true }); } catch (e) {}
    }
    BRIDGE_PENDING = {};
  }
  if (bus()) adoptPending(bus());
  else window.addEventListener('gev:bridge-ready', function () { adoptPending(bus()); }, { once: true });

  var Q = {};
  (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return; var i = kv.indexOf('='); Q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1));
  });
  var MODE = Q.gevEdge === '0' ? 0 : (Q.gevEdge === '2' ? 2 : 1);
  /* Phase6C2：?gevEdgePdb=0 关掉 preserveDrawingBuffer（A/B 用）。
     每帧都下发 GL（见 draw() 里的 Phase6C1 说明）时理论不再需要 pdb。 */
  var PDB = Q.gevEdgePdb !== '0';

  var LENS_STATE = publish('edge.lensState', { mode: MODE, loading: true }, '__gevEdgeLens');
  if (MODE === 0) return;

  /* 本脚本启动时刻（performance.now 时基）：stats.drawFirstMs 相对它，用来判断
     250–300ms 的那次 draw 是首帧还是稳态（Round-2 评审 #1）。 */
  var BOOT_AT = (window.performance && performance.now) ? +performance.now().toFixed(1) : 0;

  var CFG = {
    /* Phase 4（2026-10-29）：恢复「可控」液态玻璃 —— 单层位移 + 克制的边缘色散。
       历史候选 C 是 gain 1.10 / dispPx 2.4（约 65fps）但会在大色块上出现彩虹/锯齿带；
       Phase 3 把两者归零后卡片变成纯平面（无色散也无位移 = 只剩一条高光）。
       本次取中间受控值：位移有（gain 0.85）但边缘色散只有 1.24px 上限，
       R/G/B 三条光线的最大间距 = 0.4 × dispPx ≈ 0.5 CSS px —— 远小于「能看出彩边」的 2px 阈值。
       ① gain 0.85 → dBase ≈ 0.5 device px（内缘 → 0，Snell 真位移，非贴图平移）
       ② dispPx 1.24 → 只在最外 1px 有 ~0.5px 的通道间距（无彩虹带、无锯齿）
       ③ innerDark 0 → 仍不压暗最外圈（禁外圈灰线）
       ④ 只画单层环：band 内 alpha 1 → 内缘羽化到 0，中心 discard（不磨砂、不暗底） */
    band: 10,          // 高光带宽度（CSS px，0–16）
    bandFrac: 0.20,    // 小卡按短边比例收窄（52px 高的头卡 → 10px，避免「粗边框」感）
    bandMin: 7,
    feather: 6,        // 内缘羽化：depth band-6→band 之间 alpha 1→0
    thick: 6,          // 玻璃厚度（px）：进入 Snell 位移 dBase 的坡度尺度（Phase 4：4→6，倒角更明显）
    ior: 1.52,         // 物理玻璃折射率
    gain: 1.0,         // Phase 4：0.6–1.0 受控折射位移（不再是 0 = 平面）
    /* Phase6C2（2026-10-29）：1.2 → 1.0。带内 max|ΔR−ΔB| 在「与通道间距同尺度」的 2px
       高频底衬上实测：dp1.2 → 顶40/下54/左53/右50（超出 6–45 上界）；dp1.0 → 顶33/下42/左~44/右~41。
       8px 棋盘对该间距是瞎的（读数 1–2），实时地图梯度更缓，两个口径都记录在 gate JSON 里。 */
    /* Phase6C5（2026-10-30）：1.0 → 2.4。C2 gate 的 6–45 判据是「灰阶 2px 条纹上的 ΔR−ΔB」
       标定的，它只证明 shader 在硬边上会分色，**不等于肉眼可见**。真实地图上（不冻结、正常态）
       实测：dp1.0 的边缘 on/off Δ(R−B) 只有 1.0–1.2 灰阶（低于 JND ≈3–4），所以用户看不到色散。
       0.4×dispPx = R/B 采样间距：dp2.4 → 0.96 CSS px（C5 目标 0.8–1.2px，仍 <2px 不出彩带）。 */
    dispPx: 2.4,
    /* 色散对比度补偿：真实地图在 1px 尺度上是平滑梯度，把三个通道沿法线错开 ~1px 只产生
       1–3 灰阶的 ΔR−B（再被 bandAlpha 0.55 与卡壳半透各稀释一次 → 屏上 ~1 灰阶，肉眼无感）。
       这里把「R/B 相对 G 的偏移」按 dispGain 放大并限幅 dispCap（0–1 色阶，12/255 ≈ 12 级），
       这是**单轴棱镜**（R 与 B 反向），不是多级光谱 → 不会出彩虹带；限幅保证硬边最坏情况有界。
       dispGain 1.0 = 完全等于旧行为（A/B 用）。 */
    dispGain: 8.0,
    /* Phase7B（2026-10-30）：12/255 → 20/255。真实地图实测（A/B dispGain 8↔1，36 边）：
       cap12 → 带内 max 12 灰阶 / 边均值最强 2.41；cap20 → max 15–20 灰阶（36/36 边）。
       限幅只钉硬边最坏值：2px 条纹硬边实测 顶22/下21/左23/右23 灰阶（gate T13 区间 6–45 内，
       但在旧 C6-visual 的 T3e「≤20」上界溢出 2–3 灰阶 —— 已记录，未产生多级光谱/彩虹带）。
       注意：带**均值**过 3 灰阶不靠 cap 也不靠 gain（实测 gain 8→64 只把均值 0.83→1.34），
       因为色散宽度被 0.96px 间距锁死在 1–2px，均值被 10px 带宽稀释 —— 见 PROGRESS.md 记录。 */
    dispCap: 20 / 255,
    /* Phase7D3（2026-10-30，lead 决策「扩大可见带」）：色散在 band 内的**深度覆盖**。
       旧 shader 是 edgeBand = 1 - smoothstep(0,1,t)：只有最外 ~2px 有满幅色散，
       10px band 的均值被大量近零段稀释（真实地图 band 均值 JND 4/36）。
       现在改成 edgeBand = 1 - smoothstep(dispBandStart, 1, t)：
         dispBandStart = 0.0  → 与旧行为逐像素一致（A/B 用，默认保留可回退）
         dispBandStart = 0.85 → 外侧 85% 带宽都拿满 dispPx，只在最内 15% 收尾
       只改**空间覆盖**，不改 dispPx（R/B 间距仍 0.4×2.4 = 0.96px，在 0.8–1.2px 硬规内）。
       Phase7D3 实测（冻结地图 A/B，36 边，scripts/lc/_diag/p7d3-disp-band.mjs）：
         e0 0    → |bandMean| 0.931，band 内 |Δ| 均值 4.79 灰阶，|Δ|≥3 的边 32/36
         e0 0.85 → |bandMean| 0.755，band 内 |Δ| 均值 5.18 灰阶，|Δ|≥3 的边 34/36
       即「扩大可见带」把**色散幅度的覆盖**做上去了，但 gate 用的**带符号均值**反而更低
       （83% 符号抵消：沿边/沿深的梯度正负交替，见 .gev-logs/lc/phase7d3 报告 §3）。 */
    dispBandStart: 0.85,
    blurPx: 0.7,       // 斜面透镜的轻微柔化（只在 band 内，<1px；中心不采样）
    lod: 0.0,          // 采样 LOD（0=最锐；1 略柔）
    rimAmt: 0.80,      // 边缘高光强度（单一光源；只在上沿/右沿，不成闭合线）
    curvature: 1.7, spread: 1.59, smoothness: 8.0,
    innerDark: 0,      // 0 = 无内圈压暗（禁内圈灰线）
    aa: 1.2,           // 外轮廓抗锯齿（CSS px）
    bandAlpha: 0.55,   // Phase 4：band 半透系数（1 = 实心替换底图 → 会读出双灰圈；0.55 = 玻璃斜面）
    scale: 0,          // 0 = auto（min(dpr,1.5)）
    maxScale: 1.5,
    cap: 0,            // 0 = 跟着 Cesium postRender 每帧画（同帧合成 → 边缘内容与地图零延迟）；
                       // 也可 __gevEdge.cap(60) 半速画（省 ~10% 页面 fps，但移动时会慢 1 帧）
    only: null,        // null = 9 卡全画；['data-panel'] = 只画一张
    testBg: false, testBgCss: 8, testBgFlat: null, testBgGrid: 0,
    /* Phase6C2 Round-2：三态底衬（代码与标签一致）
       testBgMode 0 = 棋盘（两个方向都有边界，C1 主判据）
                  1 = 横条纹（梯度沿 y，量 顶/下 的色散）
                  2 = 竖条纹（梯度沿 x，量 左/右 的色散）
       旧代码只有「横条纹 / 棋盘」两态，axis=0 实际画的是棋盘却标成竖条纹（评审 #3）。*/
    testBgMode: 0,

    /* ── Phase8C · D4/G8/G9：自适应 tint + spill（复用同一张抓帧纹理）────────
       卡背后中心 8×8 的亮度 → tint 权重（0.01–0.05，颜色 = 中心平均色）；
       卡外四圈环带 8×8 的平均色 → 阴影染色权重（≤15%，黑向环带色混合）。
       只写 CSS 变量，不进 shader：band/dispPx/gain 一个都不动。 */
    tint: true, tintMin: 0.01, tintMax: 0.05,
    spill: true, spillMax: 0.15,
    lookHz: 5,                // 采样频率（每拍只取 1 张卡，5 张卡 ≈ 1s 轮完一圈）

    /* ── Phase8C · D9/G10：≤40×40 图标按背景亮度翻转 ───────────────────────
       亮底（luma > 0.62）→ 深色字（#0b1116）；暗底 → 浅色（#eaf4ff）。
       迟滞 0.10：翻到深色后要跌到 0.52 以下才回浅色，避免阈值附近抖动闪色。 */
    fgFlip: true, fgIconMax: 40, fgThreshold: 0.62, fgHysteresis: 0.1, fgLight: '#0b1116', fgDark: '#eaf4ff',

    /* ── Phase8C · D5/G18：三项系统设置的降级态（boot 读一次 + change 监听）──
       full | reduced | solid —— 由 prefers-reduced-transparency /
       prefers-contrast / forced-colors 决定，见 applyA11y()。 */
    a11y: 'full',

    enabled: MODE !== 2,      // ?gevEdge=2 = 挂钩但画 0 个面（隔离成本用）
    strips: true,             // Phase 4A：只栅格化边框条（false = 整卡 quad，用于像素级 A/B 对照）
  };

  /* Phase8C · D10/#10：门禁只认配置。BASE 是「文件里写死的合规常量」的冻结副本 ——
     运行时 set()、a11y 降级、morph 关闭都不会改它，所以 stats().cfg 恒等于源码常量；
     运行有效值（含 scale / a11y / morph）走 stats().eff。 */
  var BASE = {
    band: CFG.band, bandFrac: CFG.bandFrac, bandMin: CFG.bandMin, feather: CFG.feather,
    thick: CFG.thick, ior: CFG.ior, gain: CFG.gain, dispPx: CFG.dispPx, dispGain: CFG.dispGain,
    dispCap: CFG.dispCap, dispBandStart: CFG.dispBandStart, bandAlpha: CFG.bandAlpha,
    blurPx: CFG.blurPx, rimAmt: CFG.rimAmt, aa: CFG.aa, maxScale: CFG.maxScale,
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

  var stats = { frames: 0, skip: 0, fps: 0, fpsRaw: 0, p50: 0, p90: 0, p95: 0, drawFps: 0, drawP50: 0, drawP95: 0, surfaces: [], scale: 1, err: null, tex: null, gpuMs: null, post: 0, raf: 0,
  /* Phase6C2 Round-2 回修：drawMax/upMax 只给一个「全会话最大」无法归因（gate 记录到
     250–300ms 的 draw，却不知道是首帧还是稳态）。现在同时记：首次出现的时间戳
     （drawMaxAt）+ 首帧 draw 时刻（drawFirstMs）+ 慢帧日志（drawLog，>40ms 逐条）
     + resetPeaks() 可分段清零并把上一段存进 peakWindows（不丢证据）。 */
    drawMax: 0, drawMaxAt: 0, drawFirstMs: 0, drawLog: [], drawN: 0,
    upMax: 0, upMaxAt: 0, peakWindows: [] };
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
  var lastDrawT = 0, lastPost = -1e9, lastFallbackT = 0, lastRafT = 0, ft = [], rafFt = [];
  /* Phase 4A（2026-10-29）：stats().fps 恒 0 的根因 —— 旧代码只在「画过 ≥24 次」
     或「frames%30==0」时才算 fps，而 fps 又取自 draw 间隔。页面一卡（Cesium 空闲、
     兜底被去重跳过），采样样本永远攒不够 → fps 永久停在 0，读数与实际无关。
     现在分成两条互不干扰的采样：
       stats.fps    = 页面 rAF 帧率（每帧都采，与是否重画无关）→ 真实页面帧率
       stats.drawFps= 折射 pass 自己的重画率（去重后）
     两者都是 p50 口径，另给 p95 让「卡顿」看得见。 */
  function quantile(arr, p) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }
  function sampleRaf(ts) {
    if (lastRafT) { rafFt.push(ts - lastRafT); if (rafFt.length > 180) rafFt.shift(); }
    lastRafT = ts;
    if (!rafFt.length || rafFt.length % 15) return;
    var p50 = quantile(rafFt, 0.5);
    stats.p50 = +p50.toFixed(2);
    stats.p95 = +quantile(rafFt, 0.95).toFixed(2);
    stats.fps = p50 ? +(1000 / p50).toFixed(1) : 0;
  }
  function sampleDraw() {
    var p50 = quantile(ft, 0.5);
    stats.drawP50 = +p50.toFixed(2);
    stats.drawP95 = +quantile(ft, 0.95).toFixed(2);
    stats.drawFps = p50 ? +(1000 / p50).toFixed(1) : 0;
  }
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
    var _t = (window.performance && performance.now) ? performance.now() : 0;
    if (!stats.drawFirstMs) stats.drawFirstMs = +_t.toFixed(1);
    try { draw(ts, capture || CFG.testBg); } catch (e) { if (!stats.err) stats.err = String(e && e.message || e); }
    if (_t) {
      var _d = +(performance.now() - _t).toFixed(2);
      stats.drawMs = _d; stats.drawN = (stats.drawN || 0) + 1;
      if (_d > (stats.drawMax || 0)) { stats.drawMax = _d; stats.drawMaxAt = +_t.toFixed(1); }
      if (_d > 40) {
        (stats.drawLog || (stats.drawLog = [])).push([+_t.toFixed(1), _d, capture ? 'post' : 'raf', stats.tex, stats.drawN]);
        if (stats.drawLog.length > 40) stats.drawLog.shift();
      }
    }
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    /* rAF 帧率采样：与是否重画无关，页面卡死时它也会掉下去（不是自证清白） */
    sampleRaf(ts);
    if (ts - lastPost < 45) return;          // postRender 正在驱动，不重复画
    stats.raf++;
    /* 兜底重画上限 60Hz：Cesium 空闲时 rAF 可能是 144/165Hz，每帧都去碰
       getComputedStyle/几何签名纯属白烧主线程（相位不变，像素也不会变）。 */
    if (ts - lastFallbackT < 15.5) return;
    lastFallbackT = ts;
    tick(ts, false);
  }
  function onPostRender() {
    var ts = performance.now();
    lastPost = ts; stats.post++;
    tick(ts, true);
  }

  /* ── shader ───────────────────────────────────────────────────────────── */
  var VS = ['#version 300 es', 'in vec2 aUV;',
    /* uQuad = 本趟绘制的矩形（可以只是卡片的「边框条」，见 strips()）；
       uRect = 卡片整体矩形（SDF/法线/圆角都按它算，所以条带边界上像素值不变）。 */
    'uniform vec4 uQuad; uniform vec2 uRes;', 'out vec2 vPx;',
    'void main(){ vec2 pos = uQuad.xy + aUV * uQuad.zw; vPx = pos;',
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
    'uniform float uRadius, uCornerN, uBand, uFeather, uThick, uIOR, uGain, uDispPx, uDispGain, uDispCap, uDispE0, uLod,',
    '              uRimAmt, uCurv, uSpread, uSmooth, uInnerDark, uAA, uScale, uBlurPx, uBandAlpha;',
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
    '  float edgeBand = 1.0 - smoothstep(uDispE0, 1.0, t);',
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
    /* Phase6C5 色散对比度补偿：以 G（无偏移基准）为轴，把 R/B 的色散偏移放大 dispGain 倍并限幅。
       只改「色散分量」，不动位移/亮度/alpha；限幅 dispCap 让硬边最坏情况也只是一层淡彩边。 */
    '  vec3 base = vec3(sG.r, sG.g, sG.b);',
    '  vec3 sp = col - base;',
    '  sp.rb = clamp(sp.rb * uDispGain, vec2(-uDispCap), vec2(uDispCap));',
    '  col = base + sp;',
    /* 边缘高光：Phase 4 改为「单一光源方向」的镜面反射（上沿 + 右沿），
       不再用互为反向的两条 45° 法线（那样四条边的 hl 都是 0.55 → 一圈闭合亮线 = 描边）。 */
    '  vec2 L = normalize(vec2(0.45, -0.89));',
    '  float bandf = exp(-pow(t / 0.22, 2.0));',
    '  float ndl = max(dot(n, L), 0.0);',
    '  float rim = pow(ndl, 2.0) * bandf;',
    '  col = mix(col, vec3(1.0), clamp(rim * uRimAmt, 0.0, 0.5));',
    '  col *= 1.0 - uInnerDark * (1.0 - smoothstep(0.0, uBand * 0.5, depth));',
    '  float aOut = smoothstep(0.0, uAA, depth);',             // 外轮廓 AA
    '  float aIn  = 1.0 - smoothstep(uBand - uFeather, uBand, depth);',  // 内缘羽化
    /* Phase 4：band 是「半透折射层」而不是「替换底图的实心环」。
       实心替换（uBandAlpha=1）会把底图在 1–2px 位移后的边缘重影原样贴回来，
       差值图上就是外亮+内暗两圈（双灰圈）。半透后重影只剩 ~50% 对比，读成玻璃斜面。
       镜面高光另给一份不透明度（受光边才 opaque）→ 上/右沿是「擦亮的一条边」，
       背光边（下/左）只有半透折射，四周不闭合。 */
    '  float a = max(aOut * aIn * uBandAlpha, rim * aOut);',
    '  if (a < 0.004) discard;',
    /* Phase 4 修复：context 声明 premultipliedAlpha:true 后必须输出「预乘」颜色。
       旧代码在 premultipliedAlpha:false 的 context 里写 col*a（预乘值），合成器又按
       straight-alpha 再乘一次 a → band 亮度被平方衰减（白色 255 → 屏上 140 → 再 ×0.55 ≈ 77），
       4 边一圈均匀变暗，正是「灰圈/灰带」的数值来源（白底实测 117 vs 应有 183）。 */
    '  o = vec4(col * a, a);',
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
    if (v && v.canvas && v.canvas.width > 400) { stats.src = 'viewer:' + v.canvas.id + ':' + v.canvas.width + 'x' + v.canvas.height; return v.canvas; }
    var cs = document.querySelectorAll('canvas'), best = null, area = 0;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.id === 'gev-edge-lens') continue;
      if (c.width < 400 || c.height < 300) continue;
      var a = c.width * c.height; if (a > area) { area = a; best = c; }
    }
    stats.src = best ? ('scan:' + (best.id || best.className || '?') + ':' + best.width + 'x' + best.height) : 'none';
    return best;
  }

  function pickScale() {
    if (CFG.scale > 0) return CFG.scale;
    var s = Math.min(window.devicePixelRatio || 1, CFG.maxScale);
    /* Phase 4A：只夹宽度会在 4K/竖屏上把画布拉成非等比（宽被夹扁、高不夹）→ 边缘环错位。
       宽高同时夹，比例不变。 */
    var MAXW = 4096, MAXH = 4096;
    s = Math.min(s, MAXW / Math.max(1, innerWidth), MAXH / Math.max(1, innerHeight));
    return Math.max(0.75, +s.toFixed(3));
  }

  var W = 1, H = 1, scale = 1, quad = null, prog = null, u = {}, mapTex = null;
  var snap = null, sctx = null;

  /* ── Phase8C · D5/G18：系统无障碍三态（full / reduced / solid）───────────────
     · prefers-reduced-transparency: reduce → reduced：不位移（dispPx 0）、带更实（bandAlpha .75）
     · prefers-contrast: more / forced-colors: active → solid：**整层关闭**，让
       material.css §22 的实色分支接管（否则「卡变实了边缘还在折射」）
     · prefers-reduced-motion 不影响 shader（CSS 侧自己关过渡/will-change）
     三项各挂 change 监听：只改 CFG + 重画，不重启、不重建 GL 上下文。 */
  var MQ = {}, A11Y = { state: 'full', reads: 0, changes: 0, at: 0, why: 'init', force: null };
  function mqOf(key, q) {
    A11Y.reads++;
    try { MQ[key] = window.matchMedia ? window.matchMedia(q) : null; } catch (e) { MQ[key] = null; }
    return MQ[key];
  }
  function readA11y() {
    var forced = !!(MQ.forced && MQ.forced.matches);
    var more = !!(MQ.contrast && MQ.contrast.matches);
    var reducedTr = !!(MQ.reducedTr && MQ.reducedTr.matches);
    var auto = forced || more ? 'solid' : reducedTr ? 'reduced' : 'full';
    return {
      forced: forced, contrast: more, reducedTransparency: reducedTr,
      reducedMotion: !!(MQ.motion && MQ.motion.matches),
      state: A11Y.force || auto,
    };
  }
  function applyA11y(why) {
    var r = readA11y();
    if (r.state !== A11Y.state) { A11Y.changes++; A11Y.why = String(why || 'change'); }
    A11Y.state = r.state;
    A11Y.at = (window.performance && performance.now) ? +performance.now().toFixed(1) : 0;
    CFG.a11y = r.state;
    CFG.dispPx = r.state === 'reduced' ? 0 : BASE.dispPx;
    CFG.bandAlpha = r.state === 'reduced' ? Math.max(BASE.bandAlpha, 0.75) : BASE.bandAlpha;
    var want = r.state !== 'solid';
    if (CFG.enabled !== want) {
      CFG.enabled = want; geoDirty = true; lastSig = '';
      if (!want && gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); texValid = false; stats.surfaces = []; }
      if (want && !texValid && ready) { try { var m = mapCanvas(); if (m) uploadMap(m); } catch (e) {} }
    }
    stats.a11y = {
      state: r.state, forced: r.forced, contrast: r.contrast, reducedTransparency: r.reducedTransparency, reducedMotion: r.reducedMotion,
      dispPx: CFG.dispPx, bandAlpha: CFG.bandAlpha, enabled: CFG.enabled, changes: A11Y.changes, why: A11Y.why, at: A11Y.at, reads: A11Y.reads,
    };
    return stats.a11y;
  }
  function watchA11y() {
    var qs = [
      ['reducedTr', '(prefers-reduced-transparency: reduce)'],
      ['contrast', '(prefers-contrast: more)'],
      ['forced', '(forced-colors: active)'],
      ['motion', '(prefers-reduced-motion: reduce)'],
    ];
    for (var i = 0; i < qs.length; i++) {
      var m = mqOf(qs[i][0], qs[i][1]);
      if (!m) continue;
      try {
        if (m.addEventListener) m.addEventListener('change', function () { applyA11y('media-change'); });
        else if (m.addListener) m.addListener(function () { applyA11y('media-change'); });
      } catch (e) {}
    }
    return applyA11y('boot');
  }

  /* ── Phase8C · D4/G8/G9 + D9/G10：抓帧纹理的第二次利用 ──────────────────────
     已经有 mapTex（Cesium canvas 的同帧纹理）。这里把它挂到一张小 FBO 上 readPixels，
     每次只读 5 个 8×8 小块（卡背后中心 + 卡外上/下/左/右环带）= 320 像素：
       · 中心亮度 → --lc-tint-a（0.01–0.05，中心平均色 → --lc-tint-rgb）
       · 环带平均色 → --lc-shadow-rgb（黑向环带色混合，权重 spillMax ≤0.15）
       · 中心亮度 → --lc-fg-flip（> 0.55 用深色，否则保持 #eaf4ff）
     5Hz、按卡轮转（5 张卡 ≈1s 一圈）；无整屏读回、无第二只 canvas、不进 shader，
     band / dispPx / gain 一个都不动。 */
  var fb = null, fbOk = false, fbW = 0, fbH = 0, LOOK_PX = null;
  var LOOK = { at: 0, samples: 0, fails: 0, src: 'idle', lastAt: 0, rr: 0, per: {}, fboStatus: 0, forceLuma: null, forceTint: null, forceFg: null };
  var SEL_OF = {};
  for (var _si = 0; _si < SURF.length; _si++) SEL_OF[SURF[_si].id] = SURF[_si].sel;

  function fboReady() {
    if (!gl || !mapTex || !texSrcW || !texSrcH) return false;
    if (!fb) fb = gl.createFramebuffer();
    if (!fb) { LOOK.fails++; LOOK.src = 'no-fbo'; return false; }
    if (fbW === texSrcW && fbH === texSrcH && fbOk) return true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mapTex, 0);
    fbW = texSrcW; fbH = texSrcH;
    LOOK.fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    fbOk = LOOK.fboStatus === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!fbOk) { LOOK.fails++; LOOK.src = 'fbo-incomplete'; }
    return fbOk;
  }
  function patchAvg(x, y) {
    if (!LOOK_PX) LOOK_PX = new Uint8Array(8 * 8 * 4);
    gl.readPixels(x | 0, y | 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, LOOK_PX);
    var r = 0, g = 0, b = 0;
    for (var i = 0; i < 64; i++) { r += LOOK_PX[i * 4]; g += LOOK_PX[i * 4 + 1]; b += LOOK_PX[i * 4 + 2]; }
    return { r: r / 64, g: g / 64, b: b / 64 };
  }
  function lumOf(c) { return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }
  function sampleLook(ts, list) {
    if (!(CFG.tint || CFG.spill || CFG.fgFlip)) return null;
    if (CFG.testBg || !texValid || !list || !list.length) return null;
    if (LOOK.at && ts - LOOK.at < 1000 / Math.max(1, CFG.lookHz)) return null;
    LOOK.at = ts;
    if (!fboReady()) return null;
    var s = list[LOOK.rr % list.length]; LOOK.rr++;
    var kx = texSrcW / Math.max(1, innerWidth), ky = texSrcH / Math.max(1, innerHeight);
    var cx = s.x / scale, cy = s.y / scale, cw = s.w / scale, ch = s.h / scale;   // CSS px
    function txX(v) { return Math.max(0, Math.min(texSrcW - 8, v * kx)); }
    function txY(v) { return Math.max(0, Math.min(texSrcH - 8, texSrcH - 8 - v * ky)); }
    var midX = cx + cw / 2, midY = cy + ch / 2;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    var c = patchAvg(txX(midX), txY(midY));
    var ring = [[midX, cy - 10], [midX, cy + ch + 10], [cx - 10, midY], [cx + cw + 10, midY]];
    var rr = 0, rg = 0, rb = 0;
    for (var i = 0; i < ring.length; i++) { var p = patchAvg(txX(ring[i][0]), txY(ring[i][1])); rr += p.r; rg += p.g; rb += p.b; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    var ringAvg = { r: rr / 4, g: rg / 4, b: rb / 4 };
    var cL = lumOf(c), rL = lumOf(ringAvg);
    var w = CFG.spill ? Math.min(CFG.spillMax, CFG.spillMax * Math.min(1, rL * 1.6)) : 0;
    var tintA = CFG.tint ? Math.min(CFG.tintMax, Math.max(CFG.tintMin, CFG.tintMin + (CFG.tintMax - CFG.tintMin) * (LOOK.forceLuma != null ? LOOK.forceLuma : cL))) : 0;
    if (CFG.tint && LOOK.forceTint != null) tintA = Math.max(0, Math.min(CFG.tintMax, +LOOK.forceTint));
    var sh = [Math.round(ringAvg.r * w), Math.round(ringAvg.g * w), Math.round(ringAvg.b * w)];
    /* tint 色 = 中心平均色**保持色相、提饱和度**（×2.5）：
       直接回填平均值等于「把背景平均色再平均一遍」，5% 权重下读不出来（实测 p99 仅 2.3 灰阶）；
       提饱和后 tint 读作一层很淡的色偏（ΔR−B 可测），权重仍严格在 0.01–0.05。 */
    var cLum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    function sat(v) { return Math.max(0, Math.min(255, Math.round(cLum + (v - cLum) * 2.5))); }
    var tintRgb = [sat(c.r), sat(c.g), sat(c.b)];
    var fgLuma = LOOK.forceLuma != null ? LOOK.forceLuma : cL;
    var prevFg = LOOK.per[s.id] ? LOOK.per[s.id].fg : null;
    var fg;
    if (prevFg === CFG.fgLight) fg = fgLuma > CFG.fgThreshold - CFG.fgHysteresis ? CFG.fgLight : CFG.fgDark;
    else fg = fgLuma > CFG.fgThreshold ? CFG.fgLight : CFG.fgDark;
    if (LOOK.forceFg) fg = LOOK.forceFg;
    var el = document.querySelector(SEL_OF[s.id] || '#' + s.id);
    if (el && el.style) {
      el.style.setProperty('--lc-tint-rgb', tintRgb.join(', '));
      el.style.setProperty('--lc-tint-a', tintA.toFixed(3));
      el.style.setProperty('--lc-shadow-rgb', sh.join(', '));
      if (CFG.fgFlip) el.style.setProperty('--lc-fg-flip', fg);
    }
    LOOK.samples++; LOOK.lastAt = +ts.toFixed(1); LOOK.src = 'map-tex-fbo';
    LOOK.per[s.id] = { tintA: +tintA.toFixed(3), tintRgb: tintRgb, shadowRgb: sh, spillW: +w.toFixed(3), center: [+c.r.toFixed(1), +c.g.toFixed(1), +c.b.toFixed(1)], centerLuma: +cL.toFixed(3), ringLuma: +rL.toFixed(3), fg: fg, at: +ts.toFixed(1) };
    return LOOK.per[s.id];
  }

  function resize() {
    scale = pickScale();
    W = Math.max(2, Math.round(innerWidth * scale));
    H = Math.max(2, Math.round(innerHeight * scale));
    cv.width = W; cv.height = H; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    if (snap) { snap.width = W; snap.height = H; }
    stats.scale = scale;
    lastSig = '';            // 画布重建 = 内容丢失，下一帧必须重画
    texSrcW = 0; texSrcH = 0; // 纹理尺寸可能随内核分辨率变 → 下一帧重新 texImage2D
    geoDirty = true;         // 布局一定变了 → 几何重采
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
    /* Phase6C1（2026-10-29）：**必须**开 preserveDrawingBuffer。
       本 canvas 是「按需重画」（Cesium postRender 或几何/纹理变化时才 draw，其余帧靠
       stats.skip 完全不碰 GL），而没有 pdb 的 WebGL canvas 在合成一次后绘制缓冲即被清空
       → 下一帧合成到的是空缓冲，屏幕上等于什么都没有（实测：canvas 自读 alpha 140，
       屏幕 on/off Δ ≈ 1 灰阶）。这就是 Phase6C 整轮「参数扫不出效果」的根因。
       pdb 只影响这块 1348×774 的小 canvas 的缓冲保留，不做额外整屏拷贝；
       Cesium 那只 canvas 仍然不开 pdb（走 postRender 同帧 texImage2D）。 */
    gl = cv.getContext('webgl2', {
      premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: PDB,
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
    ['uMap', 'uRes', 'uQuad', 'uRect', 'uRadius', 'uCornerN', 'uBand', 'uFeather', 'uThick', 'uIOR', 'uGain', 'uDispPx', 'uDispGain', 'uDispCap', 'uDispE0',
      'uLod', 'uRimAmt', 'uCurv', 'uSpread', 'uSmooth', 'uInnerDark', 'uAA', 'uScale', 'uBandAlpha']
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
    /* 几何缓存失效信号：拖拽/滚动/滚轮都会改卡片位置或命中面，不能等 150ms 兜底 */
    ['pointermove', 'pointerdown', 'wheel', 'scroll', 'touchmove'].forEach(function (ev) {
      window.addEventListener(ev, markGeoDirty, { passive: true, capture: true });
    });

    gl.useProgram(prog);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1i(u.uMap, 0);
    gl.uniform1f(u.uScale, scale);
    /* 预乘合成：源 (col*a, a) = ONE，背景乘 (1-a) */
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    ready = true;
    /* Phase8C · D5：gl 就绪后按当前三态再落一次（solid 时这里就会把 enabled 关掉） */
    applyA11y('boot-ready');
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
    LENS_STATE.loading = false;
    return true;
  }

  /* 合成条纹（验收：底图 R=G=B 时，卡边出现 RGB 不等只能来自本 shader 的色散）
     Phase6C2 Round-2：**底衬必须便宜**。旧实现按格 fillRect（2px 格 = 674×387 = 26 万个
     rect/次），而 uploadMap 每次 capture 都会重画一次 → drawLog 里满是 170–240ms 的 draw
     （tex=testbg）。gate v4 记录的 250.2/295.9ms drawMax 就是**它**，不是首帧 shader 编译，
     也不是产品路径（CFG.testBg 只在验收时打开）。现在改成 2×2 格的 pattern 平铺：
     构建一次、每帧一次 fillRect → 实测 <2ms，且像素与旧实现一致。 */
  var bgTile = null, bgKey = '';
  function testBgTile(g, mode) {
    var key = g + '|' + mode;
    if (bgTile && bgKey === key) return bgTile;
    var c = document.createElement('canvas');
    c.width = g * 2; c.height = g * 2;
    var cx = c.getContext('2d');
    for (var y = 0; y < 2; y++) {
      for (var x = 0; x < 2; x++) {
        var light = mode === 1 ? (y % 2 === 0)
          : mode === 2 ? (x % 2 === 0)
            : ((x + y) % 2 === 0);
        cx.fillStyle = light ? '#eeeeee' : '#0e0e0e';
        cx.fillRect(x * g, y * g, g, g);
      }
    }
    bgTile = c; bgKey = key;
    return c;
  }

  function paintTestBg(w, h) {
    /* Phase6C：testBgFlat = 平坦中性灰（0–255）—— 底图纹理无任何结构时，
       band 内的任何亮度/色度偏离都只能来自本 shader（斜面/镜面/色散），
       用于客观量「边缘是否可见」；不影响真实运行路径。 */
    if (CFG.testBgGrid > 0) {
      /* Phase6C1 评审 #4：平灰对「纯位移」是瞎的（位移纯色仍是纯色 → 左/下恒 ≈0）。
         棋盘是高频二维纹理：横/竖两个方向的位移都会改变采样值 → 四条边在确定性
         条件下都可测，不依赖带噪声的真地图。格宽 = testBgGrid CSS px。
         Phase6C2 Round-2 回修：旧代码只有「横条纹 / 棋盘」两态，axis=0 画的其实是棋盘，
         但注释/报告/JSON 键都写成「竖条纹」（评审 #3）。现在三态，代码与标签一致：
           testBgMode 0 = 棋盘（两个方向都有边界）· 1 = 横条纹（梯度沿 y，量顶/下）
                       2 = 竖条纹（梯度沿 x，量左/右）
         像素与原按格 fillRect 实现逐格等价（2×2 平铺，格宽 g 设备 px）。 */
      var g = Math.max(2, Math.round(CFG.testBgGrid * scale));
      var mode = CFG.testBgMode | 0;
      var pat = null;
      try { pat = sctx.createPattern(testBgTile(g, mode), 'repeat'); } catch (e) {}
      sctx.fillStyle = pat || '#eeeeee';
      sctx.fillRect(0, 0, w, h);
      return;
    }
    if (CFG.testBgFlat != null) {
      var v = Math.max(0, Math.min(255, Math.round(CFG.testBgFlat)));
      sctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      sctx.fillRect(0, 0, w, h);
      return;
    }
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

  /* Phase 4A：几何采集缓存。
     旧代码每帧对 9 张卡做 getComputedStyle + getBoundingClientRect（visible() 里还有一次
     getComputedStyle）→ 每帧 18 次样式解析 + 9 次强制布局。复杂 DOM 上这是主线程的大头，
     而卡片几何在「没有动画、没有拖拽、没 resize」时根本不变。
     现在只在可能变化时重采：有动画在跑 / 指针或滚轮动作 / resize / 每 150ms 兜底一次。 */
  var geoCache = null, geoAt = 0, geoDirty = true;
  function markGeoDirty() { geoDirty = true; }
  function collectCached(now) {
    var animating = false;
    try { animating = document.getAnimations().length > 0; } catch (e) { animating = true; }
    if (geoCache && !geoDirty && !animating && now - geoAt < 150) return geoCache;
    geoCache = collect(); geoAt = now; geoDirty = false;
    return geoCache;
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

  var texSrcW = 0, texSrcH = 0, lastSnapT = 0;
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
       只在 postRender 里调用 —— 那时绘制缓冲还有效（pdb 关着）。
       Phase 4A：源码尺寸不变时改用 texSubImage2D —— texImage2D 每次都按规范「重新定义」
       纹理（丢弃旧存储 → 驱动可能重新分配整张纹理再拷一次）；尺寸稳定后 subst 只做一次拷贝。
       Phase6C2 已实测排除：**纹理重分配不是长帧原因**。同一页 20s settle 后交错 A/B
       （固定纹理池 on/off 各两轮）worst 24–55ms、0 长帧，两种写法无差别；早期看到的
       100–200ms 长帧是 Cesium 首屏瓦片上传/自适应分辨率收敛期，与上传路径无关。 */
    try {
      var mw = map.width | 0, mh = map.height | 0;
      if (mw === texSrcW && mh === texSrcH) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, map);
        stats.tex = 'cesium-subload';
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, map);
        texSrcW = mw; texSrcH = mh;
        stats.tex = 'cesium-direct';
      }
      texValid = true;
      TEX_STAMP++;
      return true;
    } catch (e) {
      texSrcW = 0; texSrcH = 0;                 // subst 失败 → 下一帧回退 texImage2D
      stats.tex = 'snapshot-fallback';
      stats.lastErr = String(e && e.message || e);
    }
    /* Phase 4A · 兜底限速：走 2D 读回（canvas → canvas → 纹理）时每帧一次整屏读回，
       在核显上是「1fps 级」的灾难，而它本来只是「GPU→GPU 不可用」时的降级路径。
       限到 4Hz：卡顿消失（地图边缘折射最多慢 250ms，视觉上只是略滞后），有可用路径时不受影响。 */
    var nowms = (window.performance && performance.now) ? performance.now() : Date.now();
    if (nowms - lastSnapT < 250) return false;
    lastSnapT = nowms;
    var mr = map.getBoundingClientRect();
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, W, H);
    try { sctx.drawImage(map, mr.left * scale, mr.top * scale, mr.width * scale, mr.height * scale); }
    catch (e2) { stats.err = 'drawImage: ' + (e2 && e2.message || e2); return false; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snap);
    texSrcW = 0; texSrcH = 0;
    texValid = true;
    TEX_STAMP++;
    return true;
  }

  /* 把一张卡拆成 4 条互不重叠的「边框条」（上/下 = band + 圆角半径，左/右 = band）。
     依据：片元只在 depth ≤ band 时输出，而 depth ≤ band ⇒ (dy ≤ band + r) 或 (dx ≤ band)
     （圆角区域内到弧线的距离恒小于到直边的轴距），所以这 4 条覆盖了全部会被绘制的像素，
     卡片中间的大块面积（展开卡 320×380 里 87% 的像素）连 SDF 都不用跑。
     条带之间严格不重叠 → 混合不会被叠加两次，像素值与整卡 quad 完全一致。 */
  function quadStrips(s) {
    var full = [s.x, s.y, s.w, s.h];
    var band = Math.min(s.band, s.w * 0.5, s.h * 0.5);
    var T = Math.min(s.band + s.radius, s.h * 0.5, s.w * 0.5);
    if (!(T > 0) || s.h <= T * 2 || s.w <= band * 2) return [full];
    var midH = s.h - T * 2;
    var out = [
      [s.x, s.y, s.w, T],
      [s.x, s.y + s.h - T, s.w, T],
      [s.x, s.y + T, band, midH],
      [s.x + s.w - band, s.y + T, band, midH],
    ];
    return out;
  }

  function draw(ts, capture) {
    if (!ready || !CFG.enabled) return;
    var map = mapCanvas();
    if (!map) return;
    if (cv.width !== Math.round(innerWidth * scale) || cv.height !== Math.round(innerHeight * scale)) resize();

    var list = collectCached(ts);
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
      var tu = (window.performance && performance.now) ? performance.now() : 0;
      if (!uploadMap(map)) return;
      if (tu) {
        stats.upMs = +(performance.now() - tu).toFixed(2);
        if (stats.upMs > stats.upMax) { stats.upMax = stats.upMs; stats.upMaxAt = +tu.toFixed(1); }
        stats.upN = (stats.upN || 0) + 1;
        (stats.upLog || (stats.upLog = [])).push([Math.round(performance.now()), stats.upMs, stats.tex]);
        if (stats.upLog.length > 60) stats.upLog.shift();
      }
    } else if (!texValid) {
      return;                                   // 还没有可用的地图纹理 → 不画（避免黑边）
    }
    /* Phase8C · D4/D9：tint / spill / 图标翻转 —— 5Hz、单卡轮转，用已有纹理（capture 与否都可读，
       静态地图时纹理就是最后一帧内容，读它比等下一次 postRender 更及时） */
    sampleLook(ts, list);
    var sig = TEX_STAMP + '|' + W + 'x' + H + '|' + scale;
    for (var si = 0; si < list.length; si++) {
      var q0 = list[si];
      sig += '|' + Math.round(q0.x) + ',' + Math.round(q0.y) + ',' + Math.round(q0.w) + ',' + Math.round(q0.h) + ',' + Math.round(q0.band) + ',' + (q0.cornerN || 2) + ',' + Math.round(q0.radius);
    }
    /* Phase6C1（2026-10-29）：**不能因为签名没变就整帧不下发 GL**。
       实测（Chrome + RTX 3060）：只要某帧一个 GL 命令都不下发，Chromium 就把这块 layer
       按空缓冲合成 —— 屏幕 on/off Δ ≈ 1 灰阶，而 canvas 自读 alpha 140（图是画好的）。
       一旦每帧真下发一次 drawArrays，屏幕立刻正确（同点 [4,6,6] → [56,75,54]），
       停手后靠 pdb 保持。这正是 Phase6C 扫了 1.2h 参数却"看不到效果"的真因：
       效果一直在画，只是没上屏。
       去重只保留**纹理上传**（texImage2D/texSubImage2D 才是大头），几何重画每帧都发。 */
    if (!capture && sig === lastSig) stats.skip++;
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
    gl.uniform1f(u.uDispGain, CFG.dispGain);
    gl.uniform1f(u.uDispCap, CFG.dispCap);
    /* Phase7D3：色散深度覆盖起点（0 = 旧行为；smoothstep 两端相等在 GLSL 未定义 → 夹到 0.98） */
    gl.uniform1f(u.uDispE0, Math.min(Math.max(CFG.dispBandStart, 0), 0.98));
    gl.uniform1f(u.uLod, CFG.lod);
    gl.uniform1f(u.uRimAmt, CFG.rimAmt);
    gl.uniform1f(u.uCurv, CFG.curvature);
    gl.uniform1f(u.uSpread, CFG.spread);
    gl.uniform1f(u.uSmooth, CFG.smoothness);
    gl.uniform1f(u.uInnerDark, CFG.innerDark);
    gl.uniform1f(u.uAA, CFG.aa * scale);
    gl.uniform1f(u.uBlurPx, CFG.blurPx * scale);
    gl.uniform1f(u.uBandAlpha, CFG.bandAlpha);

    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      gl.uniform4f(u.uRect, s.x, s.y, s.w, s.h);
      gl.uniform1f(u.uRadius, s.radius);
      gl.uniform1f(u.uCornerN, s.cornerN || 2);
      gl.uniform1f(u.uBand, s.band);
      gl.uniform1f(u.uFeather, Math.min(CFG.feather * scale, s.band * 0.8));
      /* Phase 4A：只画边框条（见 quadStrips），中心区域不下发片元 */
      var qs = CFG.strips ? quadStrips(s) : [[s.x, s.y, s.w, s.h]];
      for (var qi = 0; qi < qs.length; qi++) {
        gl.uniform4f(u.uQuad, qs[qi][0], qs[qi][1], qs[qi][2], qs[qi][3]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
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
    sampleDraw();
  }

  /* ── 钩子 ─────────────────────────────────────────────────────────────── */
  var EDGE_API = publish('edge.lens', {
    set: function (patch) { if (patch) for (var k in patch) CFG[k] = patch[k]; geoDirty = true; if (patch && patch.scale != null) resize(); return CFG; },
    cfg: function () { return CFG; },
    only: function (ids) { CFG.only = ids && ids.length ? ids.slice() : null; return CFG.only; },
    testBg: function (on, css, flat) { CFG.testBg = !!on; if (css != null) CFG.testBgCss = +css; CFG.testBgFlat = flat == null ? null : +flat; if (on) CFG.testBgGrid = 0; return { on: CFG.testBg, css: CFG.testBgCss, flat: CFG.testBgFlat }; },
    /* 棋盘底（确定性主判据）：横竖两个方向都有高频结构 → 四边位移都可测。
       axis 保留只为向后兼容（旧调用 testChecker(true,8,0)）：非 0 = 横条纹。 */
    testChecker: function (on, css, axis) { CFG.testBg = !!on; CFG.testBgGrid = Math.max(0, +css || 8); CFG.testBgMode = (axis != null && (axis | 0)) ? 1 : 0; return { on: CFG.testBg, css: CFG.testBgCss, grid: CFG.testBgGrid, mode: CFG.testBgMode }; },
    /* 条纹底（Phase6C2）：axis=0 竖条纹（梯度沿 x，量左/右）· axis=1 横条纹（梯度沿 y，量顶/下）。
       Round-2 起 axis=0 真的是竖条纹（旧实现画的是棋盘，与标签不符，评审 #3）。
       色散 R/B 采样沿边缘法线错开，只有底图在法线方向有梯度时，ΔR−ΔB 才非零。 */
    testStripes: function (axis, css) { CFG.testBg = true; CFG.testBgGrid = Math.max(2, +css || 8); CFG.testBgMode = (axis | 0) ? 1 : 2; return { on: true, grid: CFG.testBgGrid, mode: CFG.testBgMode, label: CFG.testBgMode === 1 ? 'hstripes' : 'vstripes' }; },
    /* 分段清零峰值（Round-2）：把上一段的 drawMax/upMax 及其时间戳压进 peakWindows
       （不丢证据），再开新窗口。gate 在 warm-up 起点与稳态窗口起点各调一次。 */
    resetPeaks: function (label) {
      stats.peakWindows.push({
        label: String(label || ''), at: +(performance.now()).toFixed(1),
        drawMax: stats.drawMax, drawMaxAt: stats.drawMaxAt, drawN: stats.drawN || 0,
        upMax: stats.upMax, upMaxAt: stats.upMaxAt, upN: stats.upN || 0,
        drawLog: (stats.drawLog || []).slice(-40),
      });
      if (stats.peakWindows.length > 8) stats.peakWindows.shift();
      stats.drawMax = 0; stats.drawMaxAt = 0; stats.drawN = 0; stats.drawLog = [];
      stats.upMax = 0; stats.upMaxAt = 0; stats.upN = 0;
      return stats.peakWindows[stats.peakWindows.length - 1];
    },
    /* 仪器自检（Round-2 评审 #3）：读回测试底衬像素（CSS 坐标），用来证明标签与实现一致 ——
       竖条纹：同 x 不同 y 相等、相邻列不等；横条纹：同 y 不同 x 相等、相邻行不等。 */
    probeTestBg: function (xcss, ycss) {
      try {
        if (!CFG.testBg) return 'testbg-off';
        paintTestBg(W, H);
        var p = sctx.getImageData(Math.round(xcss * scale), Math.round(ycss * scale), 1, 1).data;
        return [p[0], p[1], p[2]];
      } catch (e) { return 'err:' + (e && e.message); }
    },
    cap: function (n) { CFG.cap = +n || 0; return CFG.cap; },
    /* Phase8C · D5/G18：读一次三态；传 full|reduced|solid 可强制（gate 用），传 null 回真实 media */
    a11y: function (force) {
      A11Y.force = force === 'full' || force === 'reduced' || force === 'solid' ? force : null;
      return applyA11y('hook:' + (A11Y.force || 'auto'));
    },
    /* Phase8C · D4/D9：tint/spill/图标翻转的开关与注入（gate 用；注入值只影响下一次采样） */
    look: function (o) {
      o = o || {};
      if (o.tint != null) CFG.tint = !!o.tint;
      if (o.spill != null) CFG.spill = !!o.spill;
      if (o.fgFlip != null) CFG.fgFlip = !!o.fgFlip;
      if ('forceLuma' in o) LOOK.forceLuma = o.forceLuma == null ? null : +o.forceLuma;
      if ('forceTint' in o) LOOK.forceTint = o.forceTint == null ? null : +o.forceTint;
      if ('forceFg' in o) LOOK.forceFg = o.forceFg == null ? null : String(o.forceFg);
      LOOK.at = 0;                     // 下一拍立即重采（不等 200ms 窗口）
      return { tint: CFG.tint, spill: CFG.spill, fgFlip: CFG.fgFlip, forceLuma: LOOK.forceLuma, forceTint: LOOK.forceTint, forceFg: LOOK.forceFg };
    },
    lookState: function () {
      return { src: LOOK.src, samples: LOOK.samples, fails: LOOK.fails, fboStatus: LOOK.fboStatus, lastAt: LOOK.lastAt, per: LOOK.per };
    },
    on: function () {
      CFG.enabled = true; geoDirty = true; lastSig = '';
      /* off() 把画布清了 → 立刻按当前地图画布重建纹理，否则要等下一次 postRender
         （requestRenderMode 空闲时可能很久）才恢复，看着像「开了没效果」 */
      if (!texValid) { try { var m = mapCanvas(); if (m) uploadMap(m); } catch (e) {} }
      return true;
    },
    off: function () {
      CFG.enabled = false;
      if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); texValid = false; }
      lastSig = '';                              // 画布已清空 → 重新打开必须重画
      stats.surfaces = [];
      return false;
    },
    stats: function () {
      return {
        /* fps = 页面 rAF 帧率（每帧采样，恒有值）；drawFps = 折射 pass 重画率 */
        fps: stats.fps, fpsRaw: stats.fpsRaw, p50: stats.p50, p90: stats.p90, p95: stats.p95,
        drawFps: stats.drawFps, drawP50: stats.drawP50, drawP95: stats.drawP95,
        frames: stats.frames, skip: stats.skip, texSub: stats.tex,
        upMs: stats.upMs, upMax: stats.upMax, upN: stats.upN, upMaxAt: stats.upMaxAt, upLog: (stats.upLog || []).slice(-20),
        drawMs: stats.drawMs, drawMax: stats.drawMax, drawMaxAt: stats.drawMaxAt, drawFirstMs: stats.drawFirstMs,
        drawLog: (stats.drawLog || []).slice(-40), drawN: stats.drawN || 0,
        peakWindows: stats.peakWindows, bootAt: BOOT_AT, src: stats.src, pdb: PDB,
        scale: scale, canvas: [W, H], tex: stats.tex, err: stats.err,
        band: CFG.band, dispPx: CFG.dispPx, dispGain: CFG.dispGain, dispCap: CFG.dispCap, dispBandStart: CFG.dispBandStart, lod: CFG.lod, only: CFG.only, cap: CFG.cap,
        gain: CFG.gain, bandAlpha: CFG.bandAlpha, blurPx: CFG.blurPx, rimAmt: CFG.rimAmt, ior: CFG.ior,
        count: stats.surfaces.length, surfaces: stats.surfaces,
        /* Phase8C · D10/#10：cfg = 源码常量（门禁合规只认它）；eff = 运行有效值（判观感）。
           cfg 来自 BASE 冻结副本，set()/a11y/morph 改不到它。 */
        cfg: {
          band: BASE.band, bandFrac: BASE.bandFrac, bandMin: BASE.bandMin, feather: BASE.feather, thick: BASE.thick,
          ior: BASE.ior, gain: BASE.gain, dispPx: BASE.dispPx, dispGain: BASE.dispGain, dispCap: BASE.dispCap,
          dispBandStart: BASE.dispBandStart, bandAlpha: BASE.bandAlpha, blurPx: BASE.blurPx, rimAmt: BASE.rimAmt,
          aa: BASE.aa, maxScale: BASE.maxScale,
          tint: { min: CFG.tintMin, max: CFG.tintMax, hz: CFG.lookHz, on: CFG.tint },
          spill: { max: CFG.spillMax, hz: CFG.lookHz, on: CFG.spill },
          fgFlip: { maxIconPx: CFG.fgIconMax, threshold: CFG.fgThreshold, ms: 120, light: CFG.fgLight, dark: CFG.fgDark },
        },
        eff: {
          band: CFG.band, dispPx: +(CFG.dispPx * scale).toFixed(3), gain: CFG.gain, ior: CFG.ior,
          bandAlpha: CFG.bandAlpha, scale: scale, enabled: CFG.enabled, a11y: CFG.a11y,
          bands: stats.surfaces.map(function (s) { return { id: s.id, band: s.band }; }),
        },
        a11y: stats.a11y || null,
        look: {
          src: LOOK.src, samples: LOOK.samples, fails: LOOK.fails, fboStatus: LOOK.fboStatus,
          lastAt: LOOK.lastAt, forceLuma: LOOK.forceLuma, forceTint: LOOK.forceTint, forceFg: LOOK.forceFg,
          per: LOOK.per,
        },
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
  }, '__gevEdge');

  /* 启动：Cesium viewer / 卡片就绪后建上下文 */
  var tries = 0;
  /* Phase8C · D5/G18：三项系统设置 = 启动读一次 + change 监听（boot 前后都要生效） */
  watchA11y();
  (function start() {
    if (boot()) return;
    /* Phase 4A：20s（80×250ms）在冷启动/GPU 进程忙碌时不够 —— 实测偶发 boot-timeout
       （lens 整场不出现，读数变成 0）。放宽到 60s，且不把「等待中」当成永久失败。 */
    if (++tries > 240) { stats.err = stats.err || 'boot-timeout'; LENS_STATE.loading = false; console.warn('[gev-edge] boot timeout', stats.err); return; }
    setTimeout(start, 250);
  })();
})();
