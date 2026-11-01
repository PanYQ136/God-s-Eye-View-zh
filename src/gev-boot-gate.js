/* ════════════════════════════════════════════════════════════════════════════
   gev-boot-gate.js —— 冷启动「就绪门」（Phase6C3 · lead 决策 B+D）
   ----------------------------------------------------------------------------
   归因（Phase6C3 已证）：冷启动的 109–188ms 长帧 + ready 前后 939ms/1255.9ms
   两次长帧，全部在 Cesium 侧（ShaderProgram 首次 link + 同帧多条瓦片 JSON
   解析），与折射层无关。

   ── Phase7A（base-first）：就绪门拆成两个互不相关的事件 ────────────────────
     · base-ready      = 底图（base imagery）在最终视角中心 640×420 清晰可见。
                          **只有它**决定收遮罩 / 放行交互。B5 保留：base 影像
                          也算「清晰」（std ≥18 且 8bit 唯一色 ≥800，连续 700ms）。
     · photoreal-ready = 3D Tiles 在后台加载完成并升级到 photoreal 栈
                          （scene.upgradeToPhotoreal() → 'gev:photoreal-ready'）。
                          本模块**只记录时间戳**，它不参与 base-ready / 收遮罩判定。
     为什么拆（依据 docs/Phase7A-架构审查-启动依赖与首屏关键路径-20261030.md）：
     3D Tiles 是 B 类（后台画质），不是「可交互」的前提。旧门把两者绑在一起时，
     tileset 一旦晚到或不到，遮罩要么等 tileset（实测 +2.5–3.5s），要么在 no-cine
     分支空等到 DEADLINE_MS=26s。解耦后遮罩只等 A 类（底图 + 卡片可用）。
     埋点：snapshot().ready.{base,photoreal} + marks 里的 base:ready /
     photoreal:ready（相对本模块求值的 ms，同时按 navigationStart 锚点转发给
     __bootTimeline）；每次启动各打一行 console.info。

   B（遮罩）—— 加载遮罩不再「App 一恢复完就收」，而是由本模块决定何时收：
     ① 相机在首帧就放行（不再等 tileset）→ 落位时最终视角的底图 imagery
        立即开始请求，遮罩等内容判据（③）成立才收；
     ② 开场镜头（gev-autolocate 的 gev-cine）跑完，相机落到最终视角；
     ③ **最终视角真的有影像**（Phase6C3-R4 回修）：画布中心 **640×420** 的
        readPixels 探针（8bit 唯一色数 / 亮度 std）连续 SETTLE_MS 通过。
        Phase7A 起 3D Tiles 的 tilesLoaded 不再是判据（它在交互后才进场景）。
        探针口径与 gate B5 的可见判据一致 —— R3 的
        256×160 / 4bit / std≥6 / uniq≥24 对「模糊低清 vs 清晰影像」不敏感
        （评审 Round-3：FAIL 帧与 PASS 帧读数逐位相同 21.69/76），遮罩会在粗
        LOD 上收起，用户第一眼是模糊地图。全局 numberOfTilesWithContentReady
        也不作判据 —— 它含落位前太空视角的瓦片，实测 8–10 块时画面仍是一片纯色。
     #loading-screen 是 position:fixed / inset:0 / 不透明层，覆盖期内的一切
     长帧用户都看不见 —— gate 用 longFrames[].maskOp 断言这一点。

   D（预热/让帧）—— 遮罩收起前必须已完成首批瓦片的解析 + program link（上面的
     ①③）；首批解析的分摊方式是「把整段 burst 挪到遮罩期内并等它流干」，因为
     Cesium 的瓦片 JSON 解析在主线程同步跑、没有 worker 钩子可以直接下放。
     相机落位（jumpTo）那一刻**立刻恢复** RequestScheduler 并发，让最终视角的
     底图在遮罩内流干；恢复后的 burst 仍落在遮罩后面（B2 断言）。

   网络卡死 / 镜头跑不完时：同样等「画面真的有影像」，等不到就**不放行**（不提前露白），
   由 DEADLINE_MS 兜底收起，reason = 'no-cine' / 'timeout'（这两种情况 gate 的 B1 会
   FAIL，正好暴露）。Phase7A：'no-cine' 早退不再以 tileset 存在为条件（旧写法在
   base-first 下永远不成立，只能干等 26s）。
   Phase6C4：原 14000ms 的 POST_CINE_GRACE_MS「等不到也放行」已退役（归零），
   遮罩收起前的额外等待只剩可见性探针需要的 SETTLE_MS = 700ms（settle+grace 合计 700）。

   诊断（gate 读这个）：
     window.__gevBoot = { state, reason, snapshot(), whenReadyToHide(ms),
                          whenBaseReady(ms), whenPhotorealReady(ms),
                          whenCineMayStart(ms), whenInteractive(ms) }
     whenBaseReady ≡ whenReadyToHide（base-ready 就是「可以收遮罩」的那一刻）；
     whenPhotorealReady 只在 B 类后台升级完成时 resolve，**与交互无关**。
     snapshot().longFrames  = 未交互阶段所有 >50ms 帧 {at, dt, maskOp}
     snapshot().viewProbeLog = 画布内容探针采样 {atRel, std, uniq, mean, ok}
     snapshot().marks       = 关键时间点（首帧/镜头放行/镜头完成/内容/决定/base-ready/photoreal-ready）
     snapshot().ready       = { base, interactive, photoreal, baseOnlyAt } 时间戳

   可还原：删 index.html 里那一行 <script> 即可 —— startupChrome / lc / autolocate
   都对 window.__gevBoot 缺失做了降级，行为回到「恢复完就收遮罩」。
   ════════════════════════════════════════════════════════════════════════════ */
import * as bridge from './bridge.js';
import * as timeline from './boot-timeline.js';
import { startCesium } from './cesium-boot.js';

(() => {
  'use strict';
  if (typeof window === 'undefined' || bridge.get('boot')) return;

  /* 观测（boot-timeline）：本模块求值 = 模块图里 cesium 已下载/求值完之后，
     所以 gate:eval 本身就标出了「HTML+CSS+模块图」这一段的结束。 */
  timeline.mark('gate:eval');

  const T0 = performance.now();
  const rel = () => +(performance.now() - T0).toFixed(1);

  const DEADLINE_MS = 26000; // 首帧起，遮罩硬上限（慢网络下最终视角瓦片可能 20s+ 才出图；startupChrome 的兜底是 26s）
  /* ── 遮罩收起前的「额外等待」预算：settle + grace = 700ms ──────────────────
     settle 700ms 是可见性探针本身需要的（连续 700ms 中心 640×420 达 B5，
     见下面 PROBE_*）；这是**唯一**保留的确定时长，不再叠第二段等待。
     grace 原为 14000ms「等不到影像也放行」——那条路径收起时画面是纯色
     （Round-3 的病），且 B1 本来就判 FAIL：既不省时也不正确，归零退役。
     无内容时不再提前放行，交给 DEADLINE_MS 的 timeout 兜底（reason='timeout'，
     B1 照样 FAIL，但用户不会先看到一块纯色）。 */
  const SETTLE_MS = 900; // Phase7A-D：700 → 900（+ tilesLoaded 判据，见 settle 分支）。
  // 底图细化时有 1–2 帧「父瓦片已丢、子瓦片未到」的空 globe，
  // 700ms 的稳定窗口可能正好收在这个空窗里（实测 reveal 中心 std 2.58）。
  const POST_CINE_GRACE_MS = 0; // 已退役（原 14000）；SETTLE_MS + 0 = 700ms
  const POST_CINE_WAIT_BUDGET_MS = SETTLE_MS + POST_CINE_GRACE_MS; // = 700，给 gate/报告核对
  /* Phase7A：FRAMES_BEFORE_CINE / CINE_MAX_WAIT_MS 已删除 —— 相机在首帧就放行，
     「等 tileset 进场景再放行相机」的第二条通路不存在了（架构审查 B-2：它是
     把 3D Tiles 重新绑回首屏的回归陷阱）。 */
  const LONG_FRAME_MS = 50; // 记录阈值（判据用 100ms）
  /* Phase7A：并发上限的施加点从「boot」改到「交互后的 photoreal 后台加载」，
     见 armPhotorealWatch()。 */

  /* ── D：冷启动期限制瓦片请求并发，让「多条瓦片 JSON 解析落进同一帧」不再发生 ──
     Cesium 默认 maximumRequestsPerServer=18 / maximumRequests=50，一次 burst 能
     把 4–6 条瓦片解析（每条 20–37ms）叠进同一帧 = 100–190ms 长帧。冷启动期把并发
     压到 2/4，同帧最多 2 条解析，长帧仍全部落在遮罩后面（B2 断言）。
     Phase6C4 再往下试了 1/2（dev 冷启动 A/B，n=7 vs 7，同机 RTX 3060）：
       · 最终清晰度不变：B5 reveal+100ms 中心 std 31.8–32.4 / uniq 5.2–6.2 万，两臂同区间；
       · 但瓦片阶梯 tileset:added→view:content 均值 +1174ms（9593 vs 8420，置换检验 p=0.10，
         中位 +1229ms），遮罩期 worst 长帧也没变小（2.6–3.6s vs 2.2–2.8s，都在遮罩下）。
     机制上说得通：Google 3D Tiles 全部同源，per-server=1 会把同级兄弟瓦片严格串行。
     结论：无收益且有变慢风险 → 保持 2/4（这才是「不牺牲清晰度也不牺牲时间」的最低档）。
     回修（Round-2 评审 ②）：并发必须**在相机落位（jumpTo）那一刻就恢复**——
     否则最终视角的底图请求被限流饿死（实测落位后 4.5s 只到 10 块内容、17 个 pending），
     遮罩收起时画面一片纯色。恢复后的 burst 仍然发生在遮罩后面（B2 断言覆盖），
     这正是 B 方案要的「把长帧藏进 loading」，而不是「把长帧挪到 reveal 之后」。
     这不是降画质：分辨率/SSE/玻璃参数一律未动，只是限制同帧工作量。 */
  /* Phase7A3：本模块现在先于 Cesium 求值（<head>），**不能再**在模块作用域
     读 `Cesium.RequestScheduler` —— prod 里那个 classic 全局此刻还不存在
     （建置期 externalGlobals 会把 `import * as Cesium from 'cesium'` 变成全局引用，
     在模块求值期就 ReferenceError）。改成按需读取：用到它的三处
     （applySchedCap / restoreSchedCap / snapshot）都发生在交互之后，Cesium 早已就绪。 */
  const schedRef = () => {
    try {
      const C = window.Cesium;
      return (C && C.RequestScheduler) || null;
    } catch (_) {
      return null;
    }
  };
  /* 遮罩期并发上限。2/4 = 实测最低的「不掉清晰度也不掉时间」档；
     1/2 的 A/B 见上面注释（更慢、无收益）。 */
  const SCHED_CAP = { per: 2, all: 4 };
  /* 原值在**第一次压并发之前**抓（那时 Cesium 的默认 18/50 还没被改过）。 */
  const SCHED_ORIG = { per: null, all: null };
  const captureSchedOrig = () => {
    const S = schedRef();
    if (!S || SCHED_ORIG.per != null) return S;
    SCHED_ORIG.per = S.maximumRequestsPerServer;
    SCHED_ORIG.all = S.maximumRequests;
    return S;
  };
  const applySchedCap = () => {
    try {
      const S = captureSchedOrig();
      if (!S) return;
      S.maximumRequestsPerServer = SCHED_CAP.per;
      S.maximumRequests = SCHED_CAP.all;
    } catch (_) {}
  };
  const restoreSchedCap = () => {
    try {
      const S = schedRef();
      if (!S || SCHED_ORIG.per == null) return;
      S.maximumRequestsPerServer = SCHED_ORIG.per;
      S.maximumRequests = SCHED_ORIG.all;
    } catch (_) {}
  };
  /* Phase7A（base-first）：冷启动期不再有 Tiles 解析 burst（Tiles 挪到交互之后），
     所以**不再在 boot 阶段压并发** —— 压着只会饿死底图 imagery/terrain。
     cap 改为「交互之后、后台 photoreal 加载期间」生效。

     Phase7D2（item4 长帧）：**恢复时机不能挂在 photoreal-ready 上**。
     `gev:photoreal-ready` 只是「首批瓦片进场景」（实测 ready 时 content=6），
     之后还有 100+ 块瓦片按默认 18/50 并发到场（实测 content 6→148，sel 6→45）。
     每块瓦片 20–37ms 的解析/上传叠进同一帧，就是 100ms–2s 的 A 族长帧
     （`getProgramParameter(LINK_STATUS)` 同步等 148/355/1141/2033ms 的实测见
     scripts/lc/_diag/p7d2-shader-stack.mjs）。所以并发上限要**跟着瓦片队列走**：
     pending+processing 连续 2 次轮询（400ms 间隔）为 0 才恢复；12s 兜底，
     25s 硬超时（保留旧的安全网）。这不是把长帧挪走：瓦片照常加载、画质不变，
     只是不让同一帧里塞进一批解析。 */
  const countTilesBusy = () => {
    try {
      const v = window.__gevViewer;
      const prims = v && v.scene && v.scene.primitives;
      if (!prims) return 0;
      let busy = 0;
      for (let i = 0; i < prims.length; i++) {
        const s = prims.get(i) && prims.get(i).statistics;
        if (!s) continue;
        busy +=
          (s.numberOfPendingRequests || 0) + (s.numberOfTilesProcessing || 0);
      }
      return busy;
    } catch (_) {
      return 0;
    }
  };
  let photorealWatchArmed = false;
  const armPhotorealWatch = () => {
    if (photorealWatchArmed) return;
    photorealWatchArmed = true;
    applySchedCap();
    mark('sched:cap(photoreal)');
    let released = false;
    const release = (why) => {
      if (released) return;
      released = true;
      restoreSchedCap();
      mark('sched:restored(' + why + ')');
      /* 兜底：photoreal 已完成但事件没被上面的监听器接住（例如本模块求值前
         就已 dispatch，理论上不会发生——升级要等交互）。只记录，不判定。 */
      if (why === 'photoreal') markPhotorealReady('sched-done');
    };
    /* 队列安静下来才恢复并发：连续 2 次 0 / 最多等 12s。 */
    const armQuietRestore = (why, maxMs) => {
      const t0 = performance.now();
      let quiet = 0;
      const poll = () => {
        if (released) return;
        const busy = countTilesBusy();
        if (busy === 0) quiet += 1;
        else quiet = 0;
        if (quiet >= 2 || performance.now() - t0 > maxMs) {
          release(why);
          return;
        }
        setTimeout(poll, 400);
      };
      poll();
    };
    try {
      window.addEventListener(
        'gev:photoreal-ready',
        () => armQuietRestore('photoreal', 12000),
        { once: true },
      );
    } catch (_) {}
    /* photoreal 一直没来（无凭据/网络不通）→ 15s 后按队列安静度恢复，
       25s 硬超时保证不会永久压着并发。 */
    setTimeout(() => armQuietRestore('timeout', 10000), 15000);
    setTimeout(() => release('hard-timeout'), 25000);
  };

  const marks = [];
  const longFrames = [];
  const state = {
    version: 1,
    state: 'boot',
    reason: null,
    startedAt: null,
    cineMayStartAt: null,
    cineDoneAt: null,
    settledAt: null,
    viewContentAt: null,
    schedRestoredAt: null,
    probeAtReveal: null,
    probeAtDecide: null,
    decideAt: null,
    /* ── Phase7A 拆开的两把「ready」──────────────────────────────────────
       baseOnlyAt        : 场景里没有 tileset、内容判据只可能来自底图 imagery
       baseReadyAt       : base-ready 时刻（= 遮罩可以收，whenBaseReady resolve）
       interactiveAt     : 遮罩淡出到不可见（= 用户真的能点，whenInteractive）
       photorealReadyAt  : 3D Tiles 后台升级完成（gev:photoreal-ready）
       base-ready 与 photoreal-ready 之间没有先后依赖：B 类晚到不影响交互。 */
    baseOnlyAt: null,
    baseReadyAt: null,
    /* Phase7A-D：输入放行（卡片可点）与遮罩视觉收起拆成两件事。
       inputReleasedAt = 遮罩不再拦截输入的那一刻（卡片层已挂载 + 画面非纯色）；
       interactiveAt   = 遮罩视觉上完全消失（B5 清晰 + settle，whenInteractive）。
       lead 决策 D：验收「可交互 ≤5s」看 inputReleasedAt，B5 另设 ≤8s 视觉门。 */
    inputReleasedAt: null,
    interactiveAt: null,
    photorealReadyAt: null,
    frames: 0,
  };

  const mark = (name, extra) => {
    const t = rel();
    marks.push({ name, t, ...(extra || {}) });
    if (marks.length > 120) marks.shift();
    /* 观测：同一批关键点按「相对 navigationStart」转发给 __bootTimeline，
       gate 自己的 rel() 口径（相对本模块求值）保持不变。 */
    timeline.mark('gate:' + name, extra);
    return t;
  };

  /* ── photoreal-ready（B 类后台事件）─────────────────────────────────────
     base-first 下 3D Tiles 在交互之后才 add：scene.upgradeToPhotoreal() 完成时
     同时 dispatch 'gev:photoreal-ready' 并置 globalThis.__gevPhotoreal.ready。
     这里两路都收（事件为主，armPhotorealWatch 的 done() 兜底已就绪的情况），
     只记录时间戳 —— 它**不参与**任何收遮罩 / 交互判定。
     不额外起轮询定时器（AGENTS：不重复定时器）。 */
  const markPhotorealReady = (how) => {
    if (state.photorealReadyAt != null) return;
    state.photorealReadyAt = mark('photoreal:ready', { via: how });
    console.info(
      '[boot] photoreal-ready @ ' +
        state.photorealReadyAt +
        'ms (后台 3D Tiles 完成，不影响交互)',
    );
    fire('photorealReady', true);
  };
  try {
    window.addEventListener(
      'gev:photoreal-ready',
      () => markPhotorealReady('event'),
      { once: true },
    );
  } catch (_) {}

  const maskEl = () => document.getElementById('loading-screen');
  /* Phase7A-D：遮罩放行/撤除之后，观感必须立刻是**当前**这一帧的影像。
     viewer 跑在 requestRenderMode 下：瓦片细化期间偶尔会渲染出一帧空 globe，
     若那一帧是最后一次渲染，页面就一直停在空帧（实测 reveal 截图中心 std 2.58 / 257 色，
     2/6 跑复现；同一跑里手动 requestRender 后立刻恢复 std 33）。这里在放行/撤除的
     头 1.2s 里主动催 10 次渲染，保证后续瓦片落地都会被画出来。 */
  const nudgeRenders = (times) => {
    try {
      const v = window.__gevViewer;
      if (!v || !v.scene || typeof v.scene.requestRender !== 'function') return;
      v.scene.requestRender();
    } catch (_) {}
    if (times > 1) setTimeout(() => nudgeRenders(times - 1), 120);
  };
  const maskOpacity = () => {
    const el = maskEl();
    if (!el) return 0;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    const o = parseFloat(cs.opacity);
    return Number.isFinite(o) ? o : 0;
  };

  /* ── Phase7A3：输入放行的**同步**入口 ───────────────────────────────────
     卡片层（src/lc）现在跑在 Cesium 求值之前，mount 的一刻就直接调本函数，
     不再等 rAF 轮询（轮询要卡片挂载后下一帧才发现，且 Cesium 求值一开始就会把
     主线程占住 3s，rAF 唤醒被推迟 —— 实测这样量出来的「卡片可点」会虚高 2–3s）。
     这里同时把遮罩退化成「顶部状态胶囊 + 只盖地图画的暗纱」：
       · #loading-screen → pointer-events:none（不挡卡片 rail）
       · #cesiumContainer → .boot-refining（暗纱只盖 canvas，见 controls.css）
     startupChrome 的 releaseInput 后续会再走一遍（幂等）。 */
  const releaseInputDom = () => {
    try {
      const el = maskEl();
      if (
        el &&
        !el.classList.contains('hidden') &&
        !el.classList.contains('input-released')
      )
        el.classList.add('input-released');
      const c = document.getElementById('cesiumContainer');
      if (c && !c.classList.contains('boot-refining'))
        c.classList.add('boot-refining');
    } catch (_) {}
  };
  const releaseInputNow = (via) => {
    if (state.inputReleasedAt != null) return state.inputReleasedAt;
    releaseInputDom();
    state.inputReleasedAt = mark('mask:input-released', { via });
    state.state = 'input-released';
    console.info(
      '[boot] input-released @ ' + state.inputReleasedAt + 'ms (' + via + ')',
    );
    fire('inputRelease', true);
    nudgeRenders(10);
    /* Cesium 求值是主线程 3s 级阻塞：放行后先留一段可点击窗口（harness 与真人
       都会在放行后 0–1s 内点卡），再注入求值。见 scheduleCesium()。 */
    scheduleCesium();
    return state.inputReleasedAt;
  };
  /* ── Cesium 求值时机（Phase7A3 的第二个开关）───────────────────────────
     head 里只剩 `<link rel="preload" as="script">`（预下载），真正注入在
     「输入已放行」之后 900ms：这段时间主线程是空的，卡片点击/展开动画能当场跑完；
     之后才让 5.73MB 的 classic 脚本求值（约 3s）+ 应用图动态 import。
     兜底：LC 若没起来（或极慢），4s 后无条件注入，绝不让应用永不启动。 */
  let cesiumTimer = null;
  const scheduleCesium = (delay = 900) => {
    if (cesiumTimer != null) return;
    if (typeof window !== 'undefined' && window.Cesium) return;
    cesiumTimer = setTimeout(() => {
      cesiumTimer = -1;
      try {
        timeline.mark('cesium:start');
      } catch (_) {}
      startCesium('gate-after-release');
    }, delay);
  };
  setTimeout(() => scheduleCesium(0), 4000);

  /* ── 画布内容探针（回修 ①，Round-3 对齐 B5 口径）───────────────────────
     「当前相机视锥真的有内容」不能靠 tileset 全局计数 —— numberOfTilesWithContentReady
     把落位前太空视角的瓦片也算进去（实测 8–10 块时画面仍是一片纯色）。
     这里直接读 WebGL 默认 framebuffer 的中心 **640×420**（gate 的 B5 量的正是页面
     中心 640×420，DPR=1 时两者像素一一对应），统计 **8bit 唯一色数 + 亮度 std**。
     统计按 stride 2 抽样（覆盖同一区域，67k 样本，主线程 <8ms），阈值取在
     「空白 / 粗 LOD」与「清晰影像」之间：
       空白基线      std 0.36 / 唯一色 1（画布）；页面截图含 UI 时 std 10.19 / 22 色
       模糊粗层(R3)  std 8.09 / 340 色          ← 旧探针在这里就放行（21.69/76）
       清晰影像      std 21–30 / 8k–25k 色
     readPixels 在自己的 postRender 回调里读，所以不依赖 preserveDrawingBuffer。 */
  const PROBE_W = 640;
  const PROBE_H = 420;
  const PROBE_STRIDE = 2; // 覆盖全区域，按 2 抽样
  const PROBE_STD_MIN = 18; // 空白 0.36–10 / 模糊粗层 8–15 / 清晰影像 ≥21
  const PROBE_UNIQ_MIN = 800; // 8bit 唯一色：空白 1 / 模糊 340 / 清晰 8k–25k
  const PROBE_EVERY_MS = 150;
  /* 判定用的读数必须是「当下」的：旧窗口 900ms 会让一次过期的 ok 读数参与决策
     （refine 掉档/切视角后仍算 ok）。300ms ≈ 2 个采样周期，足够覆盖一次
     postRender 往返，但不会把陈旧读数当证据。 */
  const PROBE_FRESH_MS = 300;
  /* Phase7A2-D+：输入放行不再看探针 —— 旧的「非纯色」下限（std 6 / uniq 150）
     随之退役。B5 视觉门仍用 PROBE_STD_MIN/PROBE_UNIQ_MIN（18/800），两者互不替代。 */

  let probeScene = null;
  let probeGl = null;
  let probePending = false;
  let lastProbe = null;
  let lastProbeUsed = null; // 上一次参与判定的读数对象（同一对象不重复处理）
  let lastProbeOk = null; // 最近一次真读数的结论（null = 还没读到过）
  const probeLog = [];

  const installProbe = () => {
    if (probeGl) return true;
    const v = window.__gevViewer;
    const scene = v && v.scene;
    if (
      !scene ||
      !scene.postRender ||
      typeof scene.postRender.addEventListener !== 'function'
    )
      return false;
    let gl = null;
    try {
      const ctx = scene.context;
      gl =
        (ctx &&
          (ctx._gl ||
            (typeof ctx.getGl === 'function' ? ctx.getGl() : null))) ||
        null;
    } catch (_) {
      gl = null;
    }
    if (!gl || typeof gl.readPixels !== 'function') return false;
    probeGl = gl;
    probeScene = scene;
    const buf = new Uint8Array(PROBE_W * PROBE_H * 4);
    scene.postRender.addEventListener(() => {
      if (!probePending) return;
      probePending = false;
      const t = performance.now();
      const r = {
        at: t,
        atRel: +(t - T0).toFixed(1),
        area: null,
        stride: PROBE_STRIDE,
        mean: 0,
        std: 0,
        uniq: 0,
        ok: false,
        err: null,
      };
      try {
        const cw = gl.drawingBufferWidth;
        const ch = gl.drawingBufferHeight;
        const w = Math.min(PROBE_W, cw);
        const h = Math.min(PROBE_H, ch);
        const x = Math.max(0, Math.floor(cw / 2 - w / 2));
        const y = Math.max(0, Math.floor(ch / 2 - h / 2));
        r.area = w + 'x' + h;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let sum = 0,
          sum2 = 0,
          n = 0;
        const uniq = new Set();
        for (let yy = 0; yy < h; yy += PROBE_STRIDE) {
          const row = yy * w;
          for (let xx = 0; xx < w; xx += PROBE_STRIDE) {
            const i = (row + xx) * 4;
            const rr = buf[i];
            const gg = buf[i + 1];
            const bb = buf[i + 2];
            const l = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
            sum += l;
            sum2 += l * l;
            n += 1;
            uniq.add((rr << 16) | (gg << 8) | bb);
          }
        }
        const mean = sum / n;
        r.mean = +mean.toFixed(2);
        r.std = +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2);
        r.uniq = uniq.size;
        r.ok = r.std >= PROBE_STD_MIN && r.uniq >= PROBE_UNIQ_MIN;
      } catch (e) {
        r.err = String((e && e.message) || e);
      }
      lastProbe = r;
      probeLog.push(r);
      if (probeLog.length > 240) probeLog.shift();
    });
    return true;
  };

  const requestProbe = () => {
    if (!installProbe()) return;
    probePending = true;
    try {
      probeScene.requestRender();
    } catch (_) {}
  };

  /* 探针读数摘要（decide / reveal 两处取证用同一形状，便于 gate 直接比对 B5 口径） */
  const probeSummary = (p) =>
    p
      ? {
          atRel: p.atRel,
          area: p.area,
          stride: p.stride,
          std: p.std,
          uniq: p.uniq,
          mean: p.mean,
          ok: p.ok,
        }
      : null;

  /* ── 一次性信号 ─────────────────────────────────────────────────────── */
  const signals = {};
  const signal = (key) => {
    if (signals[key]) return signals[key];
    const s = { fired: false, value: undefined, resolve: null };
    s.promise = new Promise((res) => {
      s.resolve = res;
    });
    signals[key] = s;
    return s;
  };
  const fire = (key, v) => {
    const s = signal(key);
    if (s.fired) return;
    s.fired = true;
    s.value = v;
    s.resolve(v);
  };
  const when = (key, ms) => {
    const s = signal(key);
    if (s.fired) return Promise.resolve(s.value);
    if (!ms) return s.promise;
    return Promise.race([
      s.promise,
      new Promise((res) => setTimeout(() => res(null), ms)),
    ]);
  };

  /* ── Phase7A：不再发现 Cesium3DTileset ────────────────────────────────
     旧实现（isTileset/findTileset + initialTilesLoaded/allTilesLoaded 监听）只服务于
     三个现在已经删掉的判定：cine:go(tileset)、decide('tiles-loaded')、no-cine 的
     tileset 前置条件。base-first 下 tileset 只在交互之后才进 primitives
     （scene.upgradeToPhotoreal），boot 期扫它恒为 null —— 保留扫描只会给后续
     「顺手把 tileset 提前 add」留下一条把 3D Tiles 绑回首屏的暗道。
     3D Tiles 的就绪改为独立事件：'gev:photoreal-ready'（见 markPhotorealReady）。 */

  let decided = false;
  let firstFrameAt = null;
  let cineDoneAt = null;
  let quietSince = null;
  let terrainBusySince = null;
  let lastProbeAt = 0;
  let last = performance.now();

  const decide = (reason) => {
    if (decided) return;
    decided = true;
    state.state = 'ready-to-hide';
    state.reason = reason;
    state.decideAt = mark('decide:' + reason);
    /* base-ready 是「遮罩可以收」的唯一理由；no-cine / timeout 只是兜底，
       它们会让 B1 FAIL（收起时画面没达标），所以不写 baseReadyAt。 */
    if (reason === 'base-ready') {
      state.baseReadyAt = state.decideAt;
      mark('base:ready', { probe: state.probeAtDecide });
      console.info(
        '[boot] base-ready @ ' +
          state.baseReadyAt +
          'ms (loading 撤除只依赖此项；3D Tiles 不参与)',
      );
    }
    fire('readyToHide', reason);
    nudgeRenders(10);
  };

  const tick = () => {
    const t = performance.now();
    const dt = t - last;
    last = t;
    state.frames += 1;
    if (firstFrameAt == null) {
      firstFrameAt = t;
      state.startedAt = mark('frame:first');
      /* Phase7A（base-first）：相机动作不再等 3D Tiles —— 首帧就放行。
         落位越早，底图在该视角的 imagery 请求越早发出，遮罩只等 base-ready。
         （旧链路 cine:go 绑在 tileset 进场景后，实测把它推到 2.5–3.5s。） */
      state.cineMayStartAt = mark('cine:go(base-first)');
      fire('cineMayStart', true);
      /* base-only：boot 期场景里没有 tileset（Tiles 只在交互后由
         scene.upgradeToPhotoreal add），所以内容判据只可能来自底图 imagery。
         显式记一笔，替代旧的 'tileset:none(globe)'（那时的语义是「没 tileset
         才退底图」，现在是常态）。 */
      state.baseOnlyAt = mark('base:only');
    }
    /* 未交互阶段的每一帧都留档（>50ms），带上当时的遮罩不透明度 ——
       gate 用它断言「所有 >100ms 长帧都发生在遮罩 ≥0.95 之下」。 */
    if (state.interactiveAt == null && dt > LONG_FRAME_MS) {
      longFrames.push({
        at: +(t - T0).toFixed(1),
        dt: +dt.toFixed(1),
        maskOp: +maskOpacity().toFixed(3),
      });
      if (longFrames.length > 300) longFrames.shift();
    }
    /* 观测：冷启动期的每帧间隔（含 <50ms）交给时间线统计 frames/worstFrame，
       只有 >50ms 的帧才入环，不额外开销。 */
    if (state.interactiveAt == null) timeline.recordFrame(dt, maskOpacity());
    if (state.interactiveAt != null) return; // 交互后交给 gate 自己的采样器

    /* ── Phase7A2-D+：卡片层挂载即放行输入（不等探针 / 不等底图）───────────
       lead 决策 D+：「可交互」= 卡片层已挂载可点，地图在可见区继续细化。
       旧写法（Phase7A-D）把放行挂在 baseVisible + 探针（std/uniq）之下，实测被
       底图首帧推后到 7–8s（探针读数是 globe.show 之后才有的）。D+ 只认一件事：
       __lc.api.mounted（卡片 DOM 已加 .gev-lc、interaction.bind 已绑、port 已起），
       此刻真实鼠标点卡就能进 opening。白屏风险由遮罩退化方式兜住 —— 放行只是把
       遮罩变成顶部状态胶囊 + 地图区一层无 pointer-events 的暗纱（见 startupChrome
       releaseInput / controls.css .boot-refining），B5 视觉门仍由 content+settle 决定。 */
    if (state.inputReleasedAt == null) {
      const lcApi = bridge.get('lc.api');
      if (lcApi && lcApi.mounted === true) releaseInputNow('lc-mounted');
    }

    if (decided) {
      /* 注：收起期不再额外采样 —— 淡出只有 ~230ms，而 postRender 回调在长帧/
         重载下会迟到 200ms+（实测：请求了也赶不上在 opacity<0.05 之前落盘），
         加了只会给淡出期添主线程工作。reveal 时刻的 B5 证据由 gate 的
         「reveal+0.1s 截图中心 640×420」直接取（与本模块探针同口径）；
         decide 时刻的读数留在 probeAtDecide，两者一起看。 */
      const op = maskOpacity();
      if (op < 0.05 || !maskEl()) {
        state.probeAtReveal = probeSummary(lastProbe);
        state.interactiveAt = mark('mask:gone', { probe: state.probeAtReveal });
        state.state = 'interactive';
        fire('interactive', true);
        nudgeRenders(12);
        /* 交互后才开始后台 photoreal 的限流窗口（ready 即恢复） */
        armPhotorealWatch();
        return;
      }
      requestAnimationFrame(tick);
      return;
    }

    /* Phase7A：这里原来是「扫 primitives 找 Cesium3DTileset → 等它渲染
       FRAMES_BEFORE_CINE 帧 / 9s 超时 → cine:go(tileset)」的第二条相机放行通路。
       相机在首帧已经放行（上面 firstFrameAt 分支），这条路在 base-first 下永远
       不可达；整段删除，避免有人「修」回「等 tileset 再放行」（架构审查 B-2）。 */

    if (window.__gevCine && window.__gevCine.done && cineDoneAt == null) {
      cineDoneAt = t;
      state.cineDoneAt = mark('cine:done');
      quietSince = null;
      /* 注意：这里不再恢复并发 —— 并发恢复改在 photoreal ready（armPhotorealWatch）。 */
    }
    /* ── 内容等待（= base-ready 的唯一判据）───────────────────────────────
       「画布中心 640×420 真的有影像」+ SETTLE_MS 持续，才允许收遮罩。
       3D Tiles / terrain / egm96 全是 B 类，**都不进这条判据**：Tiles 在交互
       之后才由 scene.upgradeToPhotoreal 接入，遮罩收起时它还没开始。
       base 影像与 photoreal 影像在探针口径上等价（B5：std ≥18 / uniq ≥800），
       所以遮罩在底图上收不降视觉判据 —— 只是不再等 3D 内容。 */
    const baseVisible = !!(
      window.__gevViewer &&
      window.__gevViewer.scene &&
      window.__gevViewer.scene.globe &&
      window.__gevViewer.scene.globe.show === true
    );
    /* Phase7A3：地形安装（setTerrain）会让 globe 重建，画面有 1–2 帧空/黑。
       遮罩不能在这段空窗里收起（实测 reveal 帧中心 std 2.61 → B5 FAIL），
       所以「地形切换进行中」期间把 settle 窗口清零。超过 8s 仍未结束视为异常，
       不再阻塞（避免地形端点卡死导致遮罩永不开）。 */
    const terrainBusy = (() => {
      const s = globalThis.__gevStackState;
      if (!(s && s.terrainBusy)) {
        terrainBusySince = null;
        return false;
      }
      if (terrainBusySince == null) terrainBusySince = t;
      return t - terrainBusySince < 8000;
    })();
    if (terrainBusy) quietSince = null;
    if (baseVisible) {
      /* 采样节拍：常规 PROBE_EVERY_MS；读数陈旧（长帧/主线程阻塞让 postRender
         迟到）就下一帧立刻补一次 —— 陈旧只用来「催采样」，不当成「画面不行」。 */
      const staleProbe = !!(lastProbe && t - lastProbe.at > PROBE_FRESH_MS);
      if (staleProbe || t - lastProbeAt >= PROBE_EVERY_MS) {
        lastProbeAt = t;
        requestProbe();
      }

      /* ── Phase7A2-D+：这里原来有一条「等 baseVisible + 探针 std/uniq 才放行输入」
         的判据（Phase7A-D），实测把卡片可点推到底图首帧之后（7–8s）。放行已上移到
         tick 顶部、只认 __lc.api.mounted。别再把它挂回内容判据下面。 */

      if (cineDoneAt != null) {
        /* 判定只用「真正到达的新读数」：
         - 主线程被 100ms+ 长帧卡住时 lastProbe 不更新，quietSince 继续计时，
           不把「暂时没拿到新读数」误判成「画面变差」（按 900ms 新鲜度判的旧写法
           在长帧下会让 settle 反复清零，最后一路拖到 timeout —— C4 实测复现）；
         - 一旦有更新的读数且它不 ok（refine 掉档 / 切视角），立刻清零重计。 */
        if (lastProbe && lastProbe !== lastProbeUsed) {
          lastProbeUsed = lastProbe;
          lastProbeOk = !lastProbe.err && !!lastProbe.ok;
        }
        const viewOk =
          lastProbeOk === true && !!lastProbe && lastProbe.at >= cineDoneAt;
        const viewBad = lastProbeOk === false;
        /* Phase7A-D：读数必须是**落位之后**才产生的。probe 现在从首帧就开始跑
         （为了给「卡片可点」提供非纯色证据），落位前读到的是飞行途中的星空/粗地球
         —— std 18+/uniq 8k+，与清晰影像同量级，旧写法会把这种陈旧读数当 ok，
         遮罩便在真正底图到齐前收掉（实测：4 跑 reveal 截图中心 std 2.58 全黑）。
         因此 B5 的 ok 还要求读数时间戳 ≥ cineDoneAt。 */
        /* Phase7A：判定只看探针（base 影像）。旧的 `|| tileset.tilesLoaded` 已删除 ——
         那是一条「3D Tiles 一 load 完就收遮罩」的暗道，会把 B5 判据整条旁路掉
         （架构审查 B-3）。 */
        if (viewOk) {
          if (quietSince == null) quietSince = t;
          if (state.viewContentAt == null) {
            state.viewContentAt = mark('view:content', {
              std: lastProbe.std,
              uniq: lastProbe.uniq,
              mean: lastProbe.mean,
            });
          }
        } else if (viewBad) {
          quietSince = null;
        }
        /* Phase7A-D：撤遮罩还必须等到**这一层细化真的结束**。
         `globe.tilesLoaded === true` 表示当前视锥内没有待加载瓦片，此后不会再出现
         「父瓦片已丢、子瓦片未到」的空帧 —— 这正是 reveal 截图偶发纯黑（std 2.58）的成因。 */
        const tilesSettled = (() => {
          try {
            const g =
              window.__gevViewer &&
              window.__gevViewer.scene &&
              window.__gevViewer.scene.globe;
            return !!(g && g.tilesLoaded);
          } catch (_) {
            return false;
          }
        })();
        if (
          quietSince != null &&
          t - quietSince >= SETTLE_MS &&
          tilesSettled &&
          !terrainBusy
        ) {
          state.settledAt = mark('view:settled', {
            via: 'base-content',
            probe: probeSummary(lastProbe),
          });
          /* 判定所用的读数留档（reveal 时还会再取一次，见 decided 分支） */
          state.probeAtDecide = probeSummary(lastProbe);
          decide('base-ready');
          requestAnimationFrame(tick);
          return;
        }
        /* grace 已退役（POST_CINE_GRACE_MS === 0）：等不到影像就不放行，
         交给下面的 DEADLINE_MS timeout 兜底（reason='timeout'，B1 FAIL 暴露）。
         保留下面的分支形状只是为了让「把 grace 调回非 0」成为一行可回滚操作。 */
        if (POST_CINE_GRACE_MS > 0 && t - cineDoneAt >= POST_CINE_GRACE_MS) {
          state.settledAt = mark('view:grace', { probe: lastProbe });
          decide('view-grace');
          requestAnimationFrame(tick);
          return;
        }
      }
    }
    /* 镜头没跑（分享链接跳过 / 定位卡住）也要有人收遮罩。
       Phase7A：这里不再要求 `tileset` 存在 —— 旧条件在 base-first 下恒为假
       （tileset 交互后才 add），结果是「镜头卡住 → 干等 26s 白屏」（架构审查 B-1，
       当时是活风险）。现在无论有没有 tileset，22s 就早退。 */
    if (cineDoneAt == null && t - firstFrameAt >= DEADLINE_MS - 4000) {
      decide('no-cine');
      requestAnimationFrame(tick);
      return;
    }
    if (t - firstFrameAt >= DEADLINE_MS) {
      decide('timeout');
      requestAnimationFrame(tick);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  /* 兜底：75s 后无条件恢复瓦片调度并发（防止 interactive 永不触发时一直被压着） */
  setTimeout(restoreSchedCap, 75000);

  bridge.register(
    'boot',
    {
      get version() {
        return 1;
      },
      get state() {
        return state.state;
      },
      get reason() {
        return state.reason;
      },
      get interactive() {
        return state.interactiveAt != null;
      },
      /* Phase7A-D：卡片可点（遮罩不再拦截输入）；≠ interactive（视觉撤遮罩）。 */
      get inputReleased() {
        return state.inputReleasedAt != null;
      },
      /* Phase7A：两个独立的 ready 门 —— base 决定交互，photoreal 只是后台完成。 */
      get baseReady() {
        return state.baseReadyAt != null;
      },
      get photorealReady() {
        return state.photorealReadyAt != null;
      },
      whenReadyToHide: (ms) => when('readyToHide', ms),
      /* 同义入口：base-ready 就是「遮罩可以收」的那一时刻。 */
      whenBaseReady: (ms) => when('readyToHide', ms),
      whenPhotorealReady: (ms) => when('photorealReady', ms),
      whenCineMayStart: (ms) => when('cineMayStart', ms),
      whenInteractive: (ms) => when('interactive', ms),
      /* Phase7A-D：遮罩放行输入（卡片可点）的时刻；B5 视觉门另走 whenReadyToHide。 */
      whenInputRelease: (ms) => when('inputRelease', ms),
      /* Phase7A3：卡片层 mount 的一刻**同步**放行输入（LC 直接调用，不等 rAF 轮询），
       并把遮罩退化成「胶囊 + 只盖 canvas 的暗纱」。幂等。 */
      releaseInputEarly: (via) => releaseInputNow(via || 'lc-mounted-sync'),
      snapshot: () => {
        const photoreal = (() => {
          try {
            const p = globalThis.__gevPhotoreal;
            if (!p) return null;
            return {
              ready: !!p.ready,
              route: p.route || null,
              via: p.via || null,
              at: p.at == null ? null : p.at,
            };
          } catch (_) {
            return null;
          }
        })();
        return {
          state: state.state,
          reason: state.reason,
          frames: state.frames,
          startedAt: state.startedAt,
          cineMayStartAt: state.cineMayStartAt,
          cineDoneAt: state.cineDoneAt,
          settledAt: state.settledAt,
          decideAt: state.decideAt,
          interactiveAt: state.interactiveAt,
          inputReleasedAt: state.inputReleasedAt,
          /* 埋点（本卡要求）：base-ready / photoreal-ready 的时间戳，单位 ms，
           基准 = 本模块求值（与 marks[].t 同口径）；navigationStart 口径见
           window.__bootTimeline（gate:base:ready / gate:photoreal:ready）。 */
          ready: {
            base: state.baseReadyAt,
            inputReleased: state.inputReleasedAt,
            interactive: state.interactiveAt,
            photoreal: state.photorealReadyAt,
            baseOnlyAt: state.baseOnlyAt,
          },
          baseReadyAt: state.baseReadyAt,
          photorealReadyAt: state.photorealReadyAt,
          baseOnlyAt: state.baseOnlyAt,
          photoreal,
          maskOpacity: +maskOpacity().toFixed(3),
          sched: schedRef()
            ? {
                per: schedRef().maximumRequestsPerServer,
                all: schedRef().maximumRequests,
                cap: SCHED_CAP,
                orig: SCHED_ORIG,
              }
            : null,
          viewContentAt: state.viewContentAt,
          schedRestoredAt: state.schedRestoredAt,
          probeAtDecide: state.probeAtDecide,
          probeAtReveal: state.probeAtReveal,
          probeConfig: {
            area: PROBE_W + 'x' + PROBE_H,
            stride: PROBE_STRIDE,
            stdMin: PROBE_STD_MIN,
            uniqMin: PROBE_UNIQ_MIN,
            settleMs: SETTLE_MS,
            graceMs: POST_CINE_GRACE_MS,
            settleGraceTotalMs: POST_CINE_WAIT_BUDGET_MS,
            freshnessMs: PROBE_FRESH_MS,
            caliber: '与 gate B5 同口径：中心 640×420 + 8bit 唯一色',
          },
          viewProbe: lastProbe
            ? {
                atRel: lastProbe.atRel,
                area: lastProbe.area,
                stride: lastProbe.stride,
                std: lastProbe.std,
                uniq: lastProbe.uniq,
                mean: lastProbe.mean,
                ok: lastProbe.ok,
                err: lastProbe.err,
              }
            : null,
          viewProbeLog: probeLog.slice(-40).map((p) => ({
            atRel: p.atRel,
            area: p.area,
            std: p.std,
            uniq: p.uniq,
            mean: p.mean,
            ok: p.ok,
            err: p.err,
          })),
          marks: marks.slice(),
          longFrames: longFrames.slice(),
        };
      },
    },
    { global: '__gevBoot', owner: 'src/gev-boot-gate.js' },
  );
})();
