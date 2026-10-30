import * as Cesium from 'cesium';
import {
  applyModelAtmosphereWorkaround,
  isAppleMobilePlatform,
} from './atmosphereCompat.js';

const PINCH_ZOOM_MULTIPLIER = 8;
const MAX_PINCH_PIXEL_DELTA = 120;

function boundedPinchDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return delta;
  return (
    Math.sign(delta) *
    Math.min(Math.abs(delta) * PINCH_ZOOM_MULTIPLIER, MAX_PINCH_PIXEL_DELTA)
  );
}

/**
 * Add browser trackpad pinch to Cesium's zoom inputs and return its disposer.
 * Browsers expose this gesture as a small pixel-mode Ctrl+wheel event.
 */
export function installTrackpadPinchZoom(
  viewer,
  { createWheelEvent = (type, init) => new WheelEvent(type, init) } = {},
) {
  const controller = viewer?.scene?.screenSpaceCameraController;
  const container = viewer?.container;
  const canvas = viewer?.canvas;
  if (!controller || !container || !canvas)
    throw new TypeError('A complete Cesium viewer is required');

  const originalZoomEventTypes = controller.zoomEventTypes;
  const zoomEventTypes = Array.isArray(originalZoomEventTypes)
    ? originalZoomEventTypes
    : originalZoomEventTypes === undefined
      ? []
      : [originalZoomEventTypes];
  const alreadyHandlesControlWheel = zoomEventTypes.some(
    (binding) =>
      binding?.eventType === Cesium.CameraEventType.WHEEL &&
      binding?.modifier === Cesium.KeyboardEventModifier.CTRL,
  );
  const configuredZoomEventTypes = alreadyHandlesControlWheel
    ? originalZoomEventTypes
    : [
        ...zoomEventTypes,
        {
          eventType: Cesium.CameraEventType.WHEEL,
          modifier: Cesium.KeyboardEventModifier.CTRL,
        },
      ];
  if (!alreadyHandlesControlWheel)
    controller.zoomEventTypes = configuredZoomEventTypes;

  const relayedEvents = new WeakSet();
  const relayPinch = (event) => {
    if (
      !event.ctrlKey ||
      relayedEvents.has(event) ||
      event.deltaMode !== 0 ||
      !Number.isFinite(event.deltaY) ||
      event.deltaY === 0
    )
      return;
    let relayed;
    try {
      relayed = createWheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: boundedPinchDelta(event.deltaY),
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        view: globalThis.window,
      });
    } catch {
      // The registered Ctrl+wheel binding can still consume the original.
      return;
    }
    relayedEvents.add(relayed);
    event.preventDefault();
    event.stopPropagation();
    canvas.dispatchEvent(relayed);
  };
  container.addEventListener('wheel', relayPinch, {
    capture: true,
    passive: false,
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    container.removeEventListener('wheel', relayPinch, true);
    if (
      !alreadyHandlesControlWheel &&
      controller.zoomEventTypes === configuredZoomEventTypes
    )
      controller.zoomEventTypes = originalZoomEventTypes;
  };
}

/** Create the standard globe viewer in caller-owned, visible containers. */
export function createApplicationViewer({ container, creditContainer }) {
  if (!container || !creditContainer)
    throw new TypeError('Viewer and credit containers are required');
  // GEV: Apple mobile (iOS/iPadOS WebKit) has a tight per-tab WebGL memory
  // budget. 4x MSAA + preserveDrawingBuffer + a HiDPI (DPR2) canvas together
  // exceed it, so Safari/Edge-on-iOS kills and reload-loops the tab (symptom:
  // the view "keeps flashing", entities freeze, assets never accumulate).
  // Use a low-memory profile there; desktop (apple === false) is untouched.
  const apple = isAppleMobilePlatform();
  // GEV 画面设置（gev-graphics.js 写入 localStorage 'gev.gfx'）: 创建期项
  // MSAA / preserveDrawingBuffer / 瓦片精度 / 帧率上限在此读取；由面板「重载生效」。
  let gfx = {};
  try {
    gfx = JSON.parse(globalThis.localStorage?.getItem('gev.gfx') || '{}') || {};
  } catch (e) {
    gfx = {};
  }
  const msaa =
    gfx.msaa === 0 || gfx.msaa === 2 || gfx.msaa === 4
      ? gfx.msaa
      : apple
        ? 0
        : 4;
  // GEV perf 2026-10-24: 默认关闭 preserveDrawingBuffer —— 它每帧强制整帧 framebuffer
  // 拷贝（viewer.js 注释自认），而本应用所有 toDataURL 均在离屏 2D canvas，无 Cesium 画布
  // 截图/录屏依赖，故默认 false 纯赚。用户如需可在画面设置面板开启。
  // GEV 液态玻璃 2026-10-26: WebGL 玻璃层要每帧读回地图纹理做折射，必须保留绘制缓冲。
  // public/gev-gl-glass.js（经典脚本，先于本模块执行）会置 window.__GEV_GL_PRESERVE = true，
  // 这里做「或」运算，避免画面设置里的 pdb 迁移把它关掉导致玻璃整层失效。
  const pdb = (typeof gfx.pdb === 'boolean' ? gfx.pdb : false) || window.__GEV_GL_PRESERVE === true;
  const tileMSE = typeof gfx.tileMSE === 'number' ? gfx.tileMSE : apple ? 4 : 2;
  /*
   * fps: 0 / 负数 / NaN = "不限帧率"，Cesium 只接受 undefined（会抛
   * "targetFrameRate must be greater than 0, or undefined"，整个 viewer 构造失败）。
   */
  const fpsRaw = Number(gfx.fps);
  const fps = Number.isFinite(fpsRaw) && fpsRaw > 0 ? Math.min(fpsRaw, 240) : undefined;
  const gpuPref =
    gfx.gpuPref === 'high-performance' ||
    gfx.gpuPref === 'low-power' ||
    gfx.gpuPref === 'default'
      ? gfx.gpuPref
      : apple
        ? 'default'
        : 'high-performance';
  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    creditContainer,
    // iOS: no MSAA by default — the biggest single memory cost on a phone GPU.
    msaaSamples: msaa,
    // Honour resolutionScale instead of clamping to 1 CSS px — keeps the
    // canvas crisp on HiDPI (on a 1080p panel this stays at native 1.0).
    useBrowserRecommendedResolution: false,
    // iOS: drop preserveDrawingBuffer (forces a full extra framebuffer copy
    // every frame). Screenshot features degrade; stability wins on mobile.
    // GEV: 强制浏览器优先使用高性能(独显)GPU —— 双显卡本上默认可能落到核显，
    // 表现为"很卡/没调用 GPU"。preserveDrawingBuffer 由画面设置面板控制。
    contextOptions: {
      webgl: {
        preserveDrawingBuffer: pdb,
        powerPreference: gpuPref,
        failIfMajorPerformanceCaveat: false,
      },
    },
  });
  try {
    // undefined = 交给浏览器垂直同步；绝不能赋 0
    viewer.targetFrameRate = fps > 0 ? fps : undefined;
    // ── GEV 高清增强包 · 1080p 锐利 ─────────────────────────────
    // 按设备像素比满分辨率渲染：1080p(DPR=1)→1.0、Retina(DPR=2)→2.0（封顶 2），
    // 并把地球瓦片屏幕误差收紧到 2 → 地形/贴图/图标更锐、更清。若中端机变卡，
    // 把 resolutionScale 改回 1 或 0.9、maximumScreenSpaceError 调回 3 即可。
    // iOS: keep the drawing buffer small (cap DPR at 1, then 0.75 → a light
    // framebuffer). Desktop keeps the crisp DPR2 render.
    // GEV perf 2026-10-24 (G10): 画布像素预算封顶，防 4K+DPR2 填充爆炸。
    // 1080p 保持原生清晰；超大画布自动按 sqrt(预算/面积) 降采样。
    {
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      let scale = apple ? 0.75 : dpr;
      try {
        const cv = viewer.canvas;
        const cw = (cv && cv.clientWidth) || 0;
        const ch = (cv && cv.clientHeight) || 0;
        const budgetPx = 2.4e6; // ≈2.4MP 画布预算
        if (cw > 0 && ch > 0 && cw * ch * scale * scale > budgetPx) {
          scale = Math.max(0.6, Math.sqrt(budgetPx / (cw * ch)));
        }
      } catch (e) {}
      viewer.resolutionScale = scale;
    }
    viewer.scene.globe.maximumScreenSpaceError = tileMSE;
    window.__gevViewer = viewer;
    /* ── 渲染循环护栏 ────────────────────────────────────────────
     * Cesium 在 canvas 宽/高为 0 时（窗口最小化、切到隐藏模式、容器瞬间
     * display:none、尺寸重算的那一帧）会在 render() 里抛
     *   DeveloperError: Expected width to be greater than 0, actual value was 0
     * 一旦抛出，Cesium 认为渲染出错并**永久停掉渲染循环**，页面就只剩这个红框。
     * 这里在 scene.render 外面包一层：0 尺寸直接跳过这一帧（并尝试 resize 恢复），
     * 只有真正的其他异常才继续抛。
     */
    try {
      const scene = viewer.scene;
      const origRender = scene.render.bind(scene);
      scene.render = function guardedRender() {
        const cv = scene.canvas;
        if (!cv) return undefined;
        const w = cv.clientWidth || 0;
        const h = cv.clientHeight || 0;
        if (w <= 0 || h <= 0) {
          // 尺寸恢复后必须重新算一次视图，否则会停在旧分辨率
          try {
            if (cv.clientWidth > 0 && cv.clientHeight > 0) viewer.resize();
          } catch (e) {}
          return undefined;
        }
        try {
          return origRender();
        } catch (e) {
          const msg = String((e && e.message) || e || '');
          if (msg.indexOf('greater than 0') >= 0) return undefined; // 尺寸抖动导致，跳过即可
          throw e;
        }
      };
    } catch (e) {}
    // Before any tile builds a draw command: Cesium's per-vertex model
    // atmosphere fails to LINK on Apple's Metal backend and kills the
    // render loop. See app/atmosphereCompat.js.
    applyModelAtmosphereWorkaround(viewer.scene);
    viewer.scene.globe.show = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;
    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}
