import { createApplicationOperations } from './operations.js';
import * as Cesium from 'cesium';
import {
  createApplicationViewer,
  installTrackpadPinchZoom,
} from '../app/viewer.js';
import { registerDataCredits } from '../data/dataCredits.js';
import { configureCreditKeyboardAccess } from '../creditKeyboard.js';
import { MapStackController } from '../mapStackController.js';
import { resolveInitialStackId } from '../maps/regionDetect.js';
import {
  loadPhotorealisticTilesetPrimed,
  selectMapStartupRoute,
} from '../mapStartup.js';
import { takeWarmIonEndpoint } from '../maps/tileWarmup.js';
import { setBaseProvider } from '../maps/baseTilePrefetch.js';
import { initLogoGaze } from '../logoGaze.js';
import {
  uninstallRenderGovernor,
  governorRequestRender,
} from '../renderGovernor.js';
import { describeError } from './errors.js';
import * as timeline from '../boot-timeline.js';
import { sampleCanvasContent, isSceneContentVisible } from './sceneContent.js';

/* Phase7A：底图探测在**模块求值**就发起（与 Viewer 构造、App 前段、Tiles 预热
   全部并行）。旧链路把它排在 Tiles 之后串行等，实测 1.2s 全在关键路径上。 */
const bootStackProbe = resolveInitialStackId({ hasGoogle3d: false }).catch(
  () => 'amap-satellite',
);

/** Construct the application globe using the caller's local configuration. */
export async function createApplicationScene({
  requestServices,
  googleApiKey,
  cesiumToken,
  credits,
  MapController = MapStackController,
  mapOptions = {},
  loaderStatus,
  signal,
  defer,
}) {
  const operations = createApplicationOperations({
    requests: requestServices,
    signal,
  });
  defer(initLogoGaze());
  const previousKey = window.__GOOGLE_MAPS_API_KEY__;
  if (googleApiKey) {
    window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;
    defer(() => {
      if (window.__GOOGLE_MAPS_API_KEY__ !== googleApiKey) return;
      if (previousKey === undefined) delete window.__GOOGLE_MAPS_API_KEY__;
      else window.__GOOGLE_MAPS_API_KEY__ = previousKey;
    });
  }
  loaderStatus.textContent = 'Configuring viewer...';
  timeline.mark('scene:begin');
  /* Phase7A：底图探测（google 可达性）与 Viewer 构造并行；最迟 700ms 直接
     落 amap-satellite（大陆可用、无元数据往返）——base 只是过渡层，最终仍是
     photoreal 3D Tiles。旧链路串行等探测，实测 1.2s 全在关键路径上。 */
  const stackProbe = bootStackProbe;
  // Provider attribution stays visible, including clean-view and recording.
  const creditContainer = document.createElement('div');
  creditContainer.id = 'cesium-credits';
  document.body.appendChild(creditContainer);
  defer(() => creditContainer.remove());
  const viewer = createApplicationViewer({
    container: 'cesiumContainer',
    creditContainer,
  });
  timeline.mark('scene:viewer:ready');
  defer(() => {
    uninstallRenderGovernor(viewer);
    if (!viewer.isDestroyed()) viewer.destroy();
  });
  defer(installTrackpadPinchZoom(viewer));
  registerDataCredits(viewer, credits);
  configureCreditKeyboardAccess(document);
  /* ── base-first：Tiles 只「发起」，不 await（解耦首屏交互与 3D Tiles）───
     旧链路 await 了 Tiles 才 setStack + scene ready，于是 App 其余阶段与就绪门
     全部排在 3D Tiles 之后（C6 实测 tileset 2.5–3.5s / 最终视角影像 10.3–12.4s）。
     新链路：底图 imagery 立刻上屏，Tiles 解析完在「交互之后」后台接入并升级。 */
  const route = selectMapStartupRoute({ googleApiKey, cesiumToken });
  loaderStatus.textContent = 'Loading the base map...';
  timeline.mark('tileset:fetch:dispatched', { route });
  const photorealPromise = loadPhotorealisticTilesetPrimed(Cesium, {
    googleApiKey,
    cesiumToken,
    warmEndpoint: takeWarmIonEndpoint(),
  });

  loaderStatus.textContent = 'Initializing systems...';
  // Network-aware default base map: a browser that cannot reach Google's hosts
  // (mainland CN) gets the reachable AMap (高德) satellite; a browser that can
  // gets the Esri stack. `hasGoogle3d:false` on purpose — the 3D tileset is no
  // longer part of this decision (it upgrades in the background).
  const initialStackId = await Promise.race([
    stackProbe,
    new Promise((resolve) => setTimeout(() => resolve('amap-satellite'), 700)),
  ]);

  /* 底图栈已定 → 立刻补该 provider 的 z12/13/14 视野环（探针区 640×420）。 */
  setBaseProvider(initialStackId);

  const mapStackController = new MapController(viewer, {
    requestRender: governorRequestRender,
    ...mapOptions,
    googleTileset: null,
    cesiumToken,
    initialStack: initialStackId,
    // Task 5 (height-datum fix): rebroadcast stack changes as a window
    // CustomEvent so data layers (CCTV per-regime ground resolution) can
    // react without coupling MapStackController to layer modules. Fires on
    // 'switching'/'ready'/'error'; listeners derive the surface regime from
    // live scene state, so intermediate emissions are harmless.
    onChange: (state) => {
      window.dispatchEvent(
        new CustomEvent('gev:map-stack-changed', { detail: state }),
      );
    },
    onError: (message) => console.warn('[MapStack]', message),
  });
  defer(() => mapStackController.destroy());
  timeline.mark('basemap:setStack:begin', { stack: initialStackId });
  await mapStackController.setStack(initialStackId, {
    silent: true,
    deferTerrain: true,
  });
  timeline.mark('basemap:setStack:end');

  signal.throwIfAborted();
  timeline.mark('scene:ready');

  /* defer() 只在同步构造期有效 —— 后台升级拿到的 tileset 由这里持有并释放。 */
  const photorealHolder = { tileset: null };
  defer(() => {
    const t = photorealHolder.tileset;
    if (t && !t.isDestroyed()) {
      if (!viewer.scene.primitives.remove(t)) t.destroy();
    }
  });
  const scene = {
    viewer,
    tileset: null,
    mapStackController,
    operations,
    baseStackId: initialStackId,
    photoreal: null,
  };
  /* 后台升级：Tiles 解析完成 + 用户已可交互 → 接入场景 → photoreal 栈。
     失败（无凭据 / 网络不通）保持底图，可交互性不受影响。 */
  scene.photoreal = upgradeToPhotoreal({
    viewer,
    mapStackController,
    photorealPromise,
    scene,
    holder: photorealHolder,
    signal,
    tileErrorStatus: loaderStatus,
  }).catch((error) => {
    console.warn('[Init] photoreal upgrade failed:', error);
    return null;
  });
  return scene;
}

/** 遮罩收起（= 用户可交互）后放行 3D Tiles 升级；就绪门缺失时退化为 3s。 */
function whenInteractive(maxMs = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const gate = globalThis.__gevBoot;
    if (gate && typeof gate.whenInteractive === 'function') {
      gate.whenInteractive(maxMs).then(finish, finish);
      setTimeout(finish, maxMs + 2000);
      return;
    }
    setTimeout(finish, 3000);
  });
}

/**
 * Phase7D1 · tileset「纱」：让它照常渲染（RENDER pass：取瓦片、上传纹理、编译
 * shader，速度和可见时一样），但用 Cesium3DTileStyle 把 alpha 压到 0，底图不被
 * 遮挡。实测 Google Photorealistic 支持该 style：alpha0 → 画布 mean 1.54/std 0.82，
 * alpha1 → 恢复 mean 97.58/std 50.37。
 *
 * 之所以不能只靠 `show=false + preloadWhenHidden`：隐形预载只走 PRELOAD pass，
 * 实测预载 9.2s 才到 24 块 contentReady、25s 才 tilesLoaded，且纹理要等首次
 * render 才上传——试切要重试十余次，每次都是一帧灰屏。
 */
function createPhotorealVeil(tileset) {
  let style = null;
  try {
    style = new Cesium.Cesium3DTileStyle({ color: 'color("white", 0.0)' });
  } catch (_) {
    style = null;
  }
  if (!style) {
    /* 兜底（老 Cesium 没有 style）：只能隐形预载，慢一些但同样不遮挡底图。 */
    tileset.show = false;
    tileset.preloadWhenHidden = true;
    return {
      mode: 'preload',
      draw: (visible) => {
        tileset.show = visible;
      },
      reveal: () => {
        tileset.show = true;
        tileset.preloadWhenHidden = false;
      },
    };
  }
  tileset.style = style;
  tileset.show = true;
  /* 预渲染期先用粗 LOD（SSE ×4）：选中集更小、更快到「tilesLoaded」，
     提交后再还给原 SSE 继续细化 —— 否则在 12km 视角下要等 20s 才凑齐
     （实测 ×1 → 21.5s、×2 → 15.8s、×4 → 13.2s 到 tilesLoaded，成片后照样细化到 std 50）。 */
  const refineSse = tileset.maximumScreenSpaceError;
  try {
    tileset.maximumScreenSpaceError = refineSse * 4;
  } catch (_) {}
  const opaque = new Cesium.Cesium3DTileStyle({ color: 'color("white", 1.0)' });
  return {
    mode: 'veil',
    draw: (visible) => {
      tileset.style = visible ? opaque : style;
    },
    reveal: () => {
      tileset.style = opaque;
      try {
        tileset.maximumScreenSpaceError = refineSse;
      } catch (_) {}
    },
  };
}

/** 等 n 个动画帧（等 style 重新生效 / 新瓦片真正出图）。 */
function nextFrames(n = 2) {
  return new Promise((resolve) => {
    let left = n;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Phase7D1：等 tileset **自己就能出成片画面**，而不是等「首批瓦片事件」。
 *
 * 就绪后「试切一帧」——隐藏 globe、把 veil 揭开，在 postRender 里读回画布中心像素：
 * - 成片（与 gate 同尺度 std ≥18 && uniq ≥800，连拍两帧确认）→ 停在该状态，由调用方提交；
 * - 不成片 → 立刻盖回 veil 并恢复底图（imagery 还在，`globe.show=true` 即恢复）。
 * 这样底图全程可见，不会出现「未成片的灰/黑几何盖住整屏」。
 */
async function whenPhotorealVisible({ viewer, tileset, veil, signal, deadlineMs = 45000 }) {
  const started = performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let attempts = 0;
  let sample = null;
  let preloaded = 0;
  let selected = 0;
  let lastProbeAt = -Infinity;
  while (performance.now() - started < deadlineMs) {
    if (signal.aborted) return { ok: false, sample, attempts, preloaded };
    const stats = tileset.statistics || {};
    preloaded = stats.numberOfTilesWithContentReady || 0;
    selected = tileset._selectedTiles ? tileset._selectedTiles.length : 0;
    const now = performance.now();
    /* 唯一可信的「这一刻画面是完整的」信号：tilesLoaded（= 当前视角没有待完成
       请求/处理）。实测在此之前选中集 `contentAvailable` 全为真也照样画不出东西
       （replacement refinement 换个 LOD 就整屏空），硬切必黑。 */
    if (tileset.tilesLoaded !== true) {
      await sleep(120);
      continue;
    }
    attempts += 1;
    lastProbeAt = now;
    const wasGlobeVisible = viewer.scene.globe.show;
    viewer.scene.globe.show = false;
    veil.draw(true);
    /* 改 style 后要等几帧才重新 makeStyle/出图 → 给最多 ~600ms 逐帧读到成片为止。 */
    for (let i = 0; i < 20; i += 1) {
      await nextFrames(1);
      sample = await sampleCanvasContent(viewer);
      if (isSceneContentVisible(sample)) break;
    }
    timeline.mark('photoreal:probe', {
      attempts,
      preloaded,
      selected,
      settled: tileset.tilesLoaded === true,
      std: sample?.std ?? null,
      uniq: sample?.uniq ?? null,
    });
    if (isSceneContentVisible(sample)) {
      const confirm = await sampleCanvasContent(viewer);
      if (isSceneContentVisible(confirm)) {
        return { ok: true, sample: confirm, attempts, preloaded };
      }
      sample = confirm;
    }
    veil.draw(false);
    viewer.scene.globe.show = wasGlobeVisible;
    await sleep(500);
  }
  return { ok: false, sample, attempts, preloaded };
}

/**
 * Phase7A · photoreal-background：底图先上屏 → 交互后接入 3D Tiles → 自然升级。
 * 不砍画质：SSE / 分辨率 / 材质参数一律未动，Tiles 最终仍然加载。
 */
async function upgradeToPhotoreal({
  viewer,
  mapStackController,
  photorealPromise,
  scene,
  holder,
  signal,
  tileErrorStatus,
}) {
  const photoreal = await photorealPromise;
  timeline.mark('tileset:fetch:end', { route: photoreal.route });
  const tileset = photoreal.tileset;
  if (!tileset) {
    if (photoreal.errors.length) {
      const tileError = photoreal.errors.at(-1);
      console.warn(
        '[Init] Google 3D Tiles unavailable, keeping the base imagery:',
        tileError,
      );
      if (tileErrorStatus) {
        tileErrorStatus.textContent = `Google 3D Tiles unavailable (${describeError(
          tileError,
        )}).`;
      }
    }
    globalThis.__gevPhotoreal = { ready: false, route: photoreal.route };
    return null;
  }
  if (holder) holder.tileset = tileset;
  globalThis.__gevPhotoreal = {
    ready: false,
    route: photoreal.route,
    resolvedAt: +performance.now().toFixed(1),
  };
  /* 遮罩期内不碰场景：B5 的 reveal 取证量的是 base 影像。 */
  await whenInteractive();
  if (signal.aborted) return null;
  try {
    mapStackController.adoptPhotorealTileset(tileset);
  } catch (_) {
    /* 老版本没有该方法 → 直接 add（下面统一走 veil 预渲染） */
  }
  /* ── Phase7D1：先「盖纱预渲染」，画面成片后再切 ──────────────────────
     旧链路 add 之后 tileset 立刻绘制：未成片的瓦片会以整屏均匀灰几何盖住
     已上屏的底图（prod 实测 std 0.43 / mean 83、持续 1.6s），随后
     whenTilesetContent 的 6s 超时又会在画面还灰时强行 globe.show=false
     （再黑 1.9s）。现在：照常 add + 渲染（瓦片/纹理照常准备），但 style 把
     alpha 压到 0（纱）→ 底图不被遮挡；读回画布像素确认 tileset 自己就能出
     成片画面，才把纱揭开并和 globe 一起切过去。底图全程可见。 */
  const veil = createPhotorealVeil(tileset);
  viewer.scene.primitives.add(tileset);
  timeline.mark('photoreal:added', { veil: veil.mode });
  console.info(
    `[Init] Google 3D Tiles ready via ${photoreal.route}; pre-rendering behind the base imagery (${veil.mode}).`,
  );
  const visible = await whenPhotorealVisible({ viewer, tileset, veil, signal });
  if (signal.aborted) return null;
  if (!visible.ok) {
    /* tileset 一直没能自己出图 → 保底图，别把灰屏留在场景里。 */
    veil.draw(false);
    if (veil.mode === 'preload') tileset.preloadWhenHidden = false;
    tileset.show = false;
    globalThis.__gevPhotoreal = {
      ready: false,
      route: photoreal.route,
      phase: 'not-visible',
      probe: visible.sample || null,
      preloaded: visible.preloaded,
      attempts: visible.attempts,
      at: +performance.now().toFixed(1),
    };
    console.warn(
      '[Init] photoreal tiles never became visible; keeping the base imagery:',
      visible.sample,
    );
    return null;
  }
  /* 探针那两帧已经是成片画面（globe 隐藏、纱已揭开）→ 直接提交。
     控制器只负责状态/credit 对齐，不 await（它的地形/图层工作在后台）。 */
  veil.reveal();
  try {
    void mapStackController
      .setStack('photoreal', { silent: true })
      .catch((error) => console.warn('[Init] photoreal stack switch failed:', error));
  } catch (error) {
    console.warn('[Init] photoreal stack switch failed:', error);
  }
  scene.tileset = tileset;
  const exposed = globalThis.__godsEyeView;
  if (exposed) exposed.tileset = tileset;
  globalThis.__gevPhotoreal = {
    ready: true,
    route: photoreal.route,
    via: 'visible',
    veil: veil.mode,
    probe: visible.sample,
    preloaded: visible.preloaded,
    attempts: visible.attempts,
    at: +performance.now().toFixed(1),
  };
  timeline.mark('photoreal:upgrade', {
    via: 'visible',
    veil: veil.mode,
    std: visible.sample?.std,
    uniq: visible.sample?.uniq,
  });
  try {
    globalThis.dispatchEvent(
      new CustomEvent('gev:photoreal-ready', {
        detail: { route: photoreal.route },
      }),
    );
  } catch (_) {}
  return tileset;
}
