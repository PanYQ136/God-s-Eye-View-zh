import { createApplicationOperations } from './operations.js';
import * as Cesium from 'cesium';
import {
  createApplicationViewer,
  installTrackpadPinchZoom,
} from '../app/viewer.js';
import { registerDataCredits } from '../data/dataCredits.js';
import { configureCreditKeyboardAccess } from '../creditKeyboard.js';
import { MapStackController } from '../mapStackController.js';
import { loadPhotorealisticTileset } from '../mapStartup.js';
import { detectBaseSourceRegion } from '../maps/sourcePreference.js';
import { initLogoGaze } from '../logoGaze.js';
import {
  uninstallRenderGovernor,
  governorRequestRender,
} from '../renderGovernor.js';
import { describeError } from './errors.js';
import { onLocaleChange, t } from '../i18n/index.js';

/** Construct the application globe using the caller's local configuration. */
export async function createApplicationScene({
  requestServices,
  googleApiKey,
  googleTokens = null,
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
  loaderStatus.textContent = t('Configuring viewer...');
  // Provider attribution stays visible, including clean-view and recording.
  const creditContainer = document.createElement('div');
  creditContainer.id = 'cesium-credits';
  document.body.appendChild(creditContainer);
  defer(() => creditContainer.remove());
  const viewer = createApplicationViewer({
    container: 'cesiumContainer',
    creditContainer,
  });
  defer(() => {
    uninstallRenderGovernor(viewer);
    if (!viewer.isDestroyed()) viewer.destroy();
  });
  defer(installTrackpadPinchZoom(viewer));
  registerDataCredits(viewer, credits);
  configureCreditKeyboardAccess(document);
  defer(onLocaleChange(() => configureCreditKeyboardAccess(document)));
  // fork（CN 自适应底图）：检测网络环境/地理位置，决定默认卫星底图。
  // 检测预算 ~2.5s（双探针各 1.5s 超时），结论缓存于 sessionStorage。
  loaderStatus.textContent = /* i18n-ignore */ '正在检测卫星影像数据源…';
  const baseRegion = await detectBaseSourceRegion();
  const useCnBase = baseRegion.region === 'cn';
  let tileset = null;
  let photorealRoute = '';
  let photorealError = null;
  if (useCnBase) {
    // 中国大陆：跳过 Google 3D Tiles 加载流程，底图走高德卫星影像栈。
    viewer.scene.globe.show = true;
    loaderStatus.textContent = /* i18n-ignore */ '正在加载高德卫星影像…';
  } else {
    loaderStatus.textContent =
      googleApiKey || googleTokens || cesiumToken
        ? t('Loading Google 3D Tiles...')
        : t('Loading the keyless globe...');
    // fork：Google 3D Tiles 在不可达网络下会无限挂起，遮罩永不清除。
    // 26s 兜底：超时先走 keyless 地球；迟到的 tileset 若最终就绪则
    // 安全销毁（不加入场景，避免泄漏）。
    let photorealSettled = false;
    const photorealPromise = loadPhotorealisticTileset(Cesium, {
      googleApiKey,
      googleTokens,
      cesiumToken,
    }).then((result) => {
      photorealSettled = true;
      return result;
    });
    const photorealDeadline = new Promise((resolve) => {
      const deadlineTimer = setTimeout(() => {
        if (!photorealSettled)
          resolve({
            tileset: null,
            route: 'deadline',
            errors: [
              new Error('photoreal load deadline (26s) — keyless fallback'),
            ],
          });
      }, 26000);
      void photorealPromise.finally(() => clearTimeout(deadlineTimer));
    });
    const photoreal = await Promise.race([photorealPromise, photorealDeadline]);
    void photorealPromise.then((result) => {
      // 迟到者：deadline 已兜底接管，迟到的 tileset 不进场景，销毁防泄漏。
      if (!photorealSettled && result?.tileset) result.tileset.destroy?.();
    });
    tileset = photoreal.tileset;
    photorealRoute = photoreal.route;
    photorealError = tileset ? null : (photoreal.errors.at(-1) ?? null);
    // A provider can finish after cancellation; retain ownership of its result.
    defer(() => {
      if (tileset && !tileset.isDestroyed()) {
        if (!viewer.scene.primitives.remove(tileset)) tileset.destroy();
      }
    });
  }
  signal.throwIfAborted();
  if (tileset) {
    viewer.scene.primitives.add(tileset);
    // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
    // Google Photorealistic 3D Tiles provide their own terrain/elevation.
    viewer.scene.globe.show = false;
    console.info(`[Init] Google 3D Tiles loaded via ${photorealRoute}.`);
  } else {
    if (!useCnBase && photorealError) {
      console.warn(
        '[Init] Google 3D Tiles unavailable, using the keyless globe:',
        photorealError,
      );
      const tileErrorDetail = describeError(photorealError);
      loaderStatus.textContent = t(
        'Google 3D Tiles unavailable ({detail}). Loading the keyless globe...',
        {
          detail: tileErrorDetail,
        },
      );
    }
    viewer.scene.globe.show = true;
  }

  loaderStatus.textContent = t('Initializing systems...');

  const mapStackController = new MapController(viewer, {
    requestRender: governorRequestRender,
    ...mapOptions,
    googleTileset: tileset,
    cesiumToken,
    basePreference: useCnBase ? 'amap-satellite' : null,
    initialStack: tileset
      ? 'photoreal'
      : useCnBase
        ? 'amap-satellite'
        : 'esri-imagery',
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
  await mapStackController.setStack(
    tileset ? 'photoreal' : useCnBase ? 'amap-satellite' : 'esri-imagery',
    {
      silent: true,
    },
  );

  signal.throwIfAborted();
  return { viewer, tileset, mapStackController, operations };
}
