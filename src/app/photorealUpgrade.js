/* ════════════════════════════════════════════════════════════════════════════
   photorealUpgrade.js —— Phase7A · photoreal 后台加载 + 自然升级（base-first 的 B 半）
   ----------------------------------------------------------------------------
   卡片口径（t_910b0a14）：interactive 只等 base；3D Tiles 在**交互后**才启动、
   分片加载、完成时**自然升级**（不闪白/不黑屏/不跳变），失败保留清晰底图。

   三条纪律（改动任何一条都要重新跑 scripts/lc/_diag/photoreal-bg-audit.mjs）：

   ① 启动时机：`gev:base-ready`（= 遮罩收起/可交互）之后，再等一次
      requestIdleCallback 才发起 tileset 加载。交互前**一条** 3D Tiles 请求都不发
      （旧链路在 main:entry 就抢发 ion endpoint + root.json，与底图共享带宽）。

   ② 升级时机：globe 只在**tileset 真的有瓦片内容**并已渲染过 ≥2 帧之后才隐藏。
      旧实现在「首批瓦片 6s 超时」后无条件 `globe.show=false` → prod 实测
      interactive+5.75s 起黑屏 ~0.8s（中心 64×64 亮度 96.1 → 0.2 → 82.1），
      正是本卡要修的「黑屏跳变」。现在超时只意味着「再等」，底图不动。

   ③ 分片：photoreal 首批瓦片涌入前把 Cesium RequestScheduler 并发压到 1/2
      （遮罩期 gate 用的是 2/4），首批内容到齐即恢复。压并发不降画质：SSE /
      分辨率 / 材质 / 瓦片数量一律不动，只是让「同帧多条瓦片解析」错开。

   降级路径（全部静默，不弹窗）：
     · 没有 tileset（无凭据/网络不通） → 保持底图，`__gevPhotoreal.ready=false`
     · 首批内容一直不来（>20s）        → 保持底图，继续后台重试，不隐藏 globe
     · 任何异常                        → 保持底图 + console.warn

   事件契约（与 boot gate 任务共用，幂等）：
     `gev:base-ready`      detail { at, via } —— base 影像可交互
     `gev:photoreal-ready` detail { at, route, via, tiles } —— photoreal 已上屏
   诊断：`window.__gevPhotoreal = { ready, phase, route, at, addedAt, contentAt, error }`
   ════════════════════════════════════════════════════════════════════════════ */

const BASE_READY_EVENT = 'gev:base-ready';
const PHOTOREAL_READY_EVENT = 'gev:photoreal-ready';

const now = () =>
  typeof performance !== 'undefined'
    ? +performance.now().toFixed(1)
    : Date.now();

/* ── idle 调度：优先 requestIdleCallback，缺少时退化为「下一帧之后」 ────────── */
function onIdle(fn, timeoutMs = 400) {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(fn, { timeout: timeoutMs });
  }
  return setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 16);
}

/** base 是否已可交互（不阻塞：读一次快照 + 事件，两条都走同一入口）。 */
function baseIsReady() {
  const gate = globalThis.__gevBoot;
  if (gate && gate.interactive) return true;
  const el =
    typeof document !== 'undefined' &&
    document.getElementById('loading-screen');
  if (el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    const op = parseFloat(cs.opacity);
    if (Number.isFinite(op) && op < 0.05) return true;
  }
  return false;
}

/**
 * 等 base-ready：`gev:base-ready` 事件 / `__gevBoot.whenInteractive` / 轮询兜底。
 * 三路取最先到的，永不 reject。maxMs 之后无论如何放行（B 类晚到可以，不能卡死）。
 */
export function whenBaseReady(maxMs = 30000) {
  if (baseIsReady()) return Promise.resolve('already');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (via) => {
      if (settled) return;
      settled = true;
      try {
        globalThis.removeEventListener(BASE_READY_EVENT, onEvt);
      } catch (_) {}
      clearInterval(poll);
      clearTimeout(cap);
      resolve(via);
    };
    const onEvt = () => finish('event');
    try {
      globalThis.addEventListener(BASE_READY_EVENT, onEvt);
    } catch (_) {}
    /* 软兼容：gate 提供 whenInteractive（遮罩收起 = 可交互）。 */
    const gate = globalThis.__gevBoot;
    if (gate && typeof gate.whenInteractive === 'function') {
      gate.whenInteractive(maxMs).then(
        () => finish('gate'),
        () => finish('gate'),
      );
    }
    /* 最后兜底：轮询 DOM opacity（gate 被移除/语义变化时仍然工作）。 */
    const poll = setInterval(() => {
      if (baseIsReady()) finish('poll');
    }, 120);
    const cap = setTimeout(() => finish('timeout'), maxMs);
  });
}

/**
 * 发起 3D Tiles 加载的唯一入口（main.js 与 scene.js 都走这里）：
 * 先等 base-ready，再等空闲，才真正 fetch —— 交互前 0 条 3D Tiles 请求。
 * 幂等：多次调用复用同一个 promise。
 */
let loadPromise = null;
export function schedulePhotorealLoad(startLoad, { maxWaitMs = 30000 } = {}) {
  if (loadPromise) return loadPromise;
  loadPromise = whenBaseReady(maxWaitMs).then(
    (via) =>
      new Promise((resolve) => {
        onIdle(() => {
          try {
            globalThis.__gevPhotoreal = {
              ...(globalThis.__gevPhotoreal || {}),
              ready: false,
              phase: 'loading',
              baseReadyVia: via,
              startedAt: now(),
            };
          } catch (_) {}
          resolve(startLoad());
        }, 600);
      }),
  );
  /* 失败也要释放：不能把一条坏 promise 永久留在模块里。 */
  loadPromise.catch(() => {
    loadPromise = null;
  });
  return loadPromise;
}

/** tileset 首批瓦片进场景（initialTilesLoaded），带超时 + 可中断。 */
function whenTilesetContent(tileset, maxMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(how);
    };
    try {
      tileset.initialTilesLoaded.addEventListener(() => finish('content'));
    } catch (_) {}
    try {
      tileset.allTilesLoaded.addEventListener(() => finish('all-loaded'));
    } catch (_) {}
    const timer = setTimeout(() => finish('timeout'), maxMs);
    /* 已经加载过的（缓存命中/超快网络）立刻返回，不等事件。 */
    if (tileset.tilesLoaded) finish('tiles-loaded-now');
  });
}

/** 等 tileset 渲染过 n 帧（隐藏 globe 前至少让它画出来一帧，避免黑屏）。 */
function afterFrames(scene, n = 2, maxMs = 4000) {
  return new Promise((resolve) => {
    let left = n;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        scene.postRender.removeEventListener(step);
      } catch (_) {}
      clearTimeout(timer);
      resolve();
    };
    const step = () => {
      left -= 1;
      if (left <= 0) finish();
    };
    const timer = setTimeout(finish, maxMs);
    try {
      scene.postRender.addEventListener(step);
    } catch (_) {
      finish();
    }
  });
}

/* photoreal 首批瓦片涌入期的并发上限（gate 遮罩期用 2/4；这里更紧一档）。 */
const BURST_CAP = { per: 1, all: 2 };
let schedSaved = null;
function tightenScheduler() {
  try {
    const S = globalThis.Cesium && globalThis.Cesium.RequestScheduler;
    if (!S || schedSaved) return;
    schedSaved = { per: S.maximumRequestsPerServer, all: S.maximumRequests };
    S.maximumRequestsPerServer = BURST_CAP.per;
    S.maximumRequests = BURST_CAP.all;
  } catch (_) {}
}
function restoreScheduler() {
  try {
    const S = globalThis.Cesium && globalThis.Cesium.RequestScheduler;
    if (!S || !schedSaved) return;
    S.maximumRequestsPerServer = schedSaved.per;
    S.maximumRequests = schedSaved.all;
    schedSaved = null;
  } catch (_) {}
}

function emit(name, detail) {
  try {
    globalThis.dispatchEvent(new CustomEvent(name, { detail }));
  } catch (_) {}
}

function setState(patch) {
  try {
    globalThis.__gevPhotoreal = {
      ...(globalThis.__gevPhotoreal || {}),
      ...patch,
    };
  } catch (_) {}
}

/**
 * 后台升级主流程。返回 tileset 或 null（null = 保底图，交互完全不受影响）。
 *
 * @param {{viewer: object, mapStackController: object, load: () => Promise<object>,
 *          scene: object, holder: {tileset: object|null}, signal: AbortSignal,
 *          contentMs?: number, retry?: boolean}} args
 */
export async function runPhotorealUpgrade({
  viewer,
  mapStackController,
  load,
  scene,
  holder,
  signal,
  contentMs = 20000,
}) {
  if (!viewer || (signal && signal.aborted)) return null;
  /* ① 交互后 + 空闲才发起加载（main.js 也可能已经通过 schedulePhotorealLoad 发起）。 */
  const photoreal = await schedulePhotorealLoad(load);
  if (signal && signal.aborted) return null;
  if (!photoreal || !photoreal.tileset) {
    const err = photoreal && photoreal.errors && photoreal.errors.at(-1);
    setState({
      ready: false,
      phase: 'unavailable',
      at: now(),
      error: err ? String(err.message || err) : null,
    });
    if (err) {
      console.info(
        '[Init] Google 3D Tiles unavailable, keeping the base imagery:',
        err,
      );
    }
    emit(PHOTOREAL_READY_EVENT, {
      ready: false,
      at: now(),
      route: photoreal && photoreal.route,
    });
    return null;
  }
  const tileset = photoreal.tileset;
  if (holder) holder.tileset = tileset;

  /* ② 接入场景也要等交互 + 空闲：primitives.add 会同步解析 tileset.json。 */
  await whenBaseReady();
  if (signal && signal.aborted) return null;
  await new Promise((resolve) => onIdle(resolve, 500));
  if (signal && signal.aborted) return null;

  try {
    mapStackController.adoptPhotorealTileset(tileset);
  } catch (_) {
    /* 老版本没有该方法 → 下面 add + 隐藏 globe 兜底 */
  }
  /* ③ 分片：首批瓦片涌入期压并发，内容到齐即恢复。 */
  tightenScheduler();
  viewer.scene.primitives.add(tileset);
  scene.tileset = tileset;
  const addedAt = now();
  setState({ ready: false, phase: 'added', route: photoreal.route, addedAt });

  /* ④ 等真内容：超时**不**隐藏 globe（旧实现在这里黑屏 0.8s）。 */
  const how = await whenTilesetContent(tileset, contentMs);
  if (signal && signal.aborted) {
    restoreScheduler();
    return null;
  }
  if (how === 'timeout') {
    restoreScheduler();
    /* 底图继续显示，tileset 留在场景里继续后台加载；ready 保持 false。 */
    setState({
      ready: false,
      phase: 'content-timeout',
      route: photoreal.route,
      addedAt,
    });
    console.warn('[Init] photoreal 首批瓦片 20s 未到，保留底图继续后台加载');
    return null;
  }
  const contentAt = now();
  /* 先让它真的画一帧（globe 仍在），再切 —— 避免切过去时画面还是空的。 */
  await afterFrames(viewer.scene, 2);
  if (signal && signal.aborted) {
    restoreScheduler();
    return null;
  }
  viewer.scene.globe.show = false;
  restoreScheduler();

  /* ⑤ 控制器状态对齐放空闲里做，用户看到的切换不等它。 */
  onIdle(() => {
    try {
      void mapStackController
        .setStack('photoreal', { silent: true })
        .catch((error) =>
          console.warn('[Init] photoreal stack switch failed:', error),
        );
    } catch (error) {
      console.warn('[Init] photoreal stack switch failed:', error);
    }
  }, 800);
  const exposed = globalThis.__godsEyeView;
  if (exposed) exposed.tileset = tileset;
  const at = now();
  setState({
    ready: true,
    phase: 'ready',
    route: photoreal.route,
    via: how,
    addedAt,
    contentAt,
    at,
  });
  emit(PHOTOREAL_READY_EVENT, {
    ready: true,
    at,
    route: photoreal.route,
    via: how,
  });
  return tileset;
}
