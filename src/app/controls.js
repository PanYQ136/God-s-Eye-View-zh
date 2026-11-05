import { catalogControlServices } from './catalog.js';
import { StyleManager } from '../ui/composition.js';
<<<<<<< ours
import { flyToAustin } from '../camera.js';
import { installZoomOutGuard } from './zoomOutGuard.js';
=======
import { flyToDeviceLocation } from '../camera.js';
>>>>>>> theirs
import { initCockpitCloudEffects } from '../cockpitCloudEffects.js';
import { t } from '../i18n/index.js';

/**
 * Construct the existing controls and camera presentation. `initialShareCode`
 * opens a share code (the `<code>` of `/share/<code>`) at start-up, for a host
 * whose address does not carry one. `localePicker: false` removes the language
 * picker, for a host that does not initialize Core's locale.
 */
export function createApplicationControls({
  scene: { viewer, mapStackController, operations },
  loaderStatus,
  Controls = StyleManager,
  services,
  catalog,
  placeSearch,
  defer,
  initialShareCode = null,
  localePicker = true,
}) {
  // Initialize the style manager (post-processing, HUD, locations, share links)
  const styleManager = new Controls(viewer, {
    services: {
      ...services,
      ...operations.surface.controlServices,
      searchAndFlyTo: operations.searchAndFlyTo,
      fetchRegionalBrief: (...args) =>
        operations.requests.regional.getBrief(...args),
      ...catalogControlServices(catalog),
    },
    requestServices: operations.requests,
    mapStackController,
    placeSearch,
    // A share code to open at start-up instead of the page's address.
    initialShareCode,
    localePicker,
  });
  defer(() => styleManager.orbitController.stop());
  defer(() => styleManager.hud.destroy());
  defer(() => styleManager.dispose());
  defer(
    installZoomOutGuard(viewer, {
      subscribeCameraHandoff: (listener) =>
        styleManager.subscribeCameraHandoff?.(listener),
    }),
  );
  // The previous multi-canvas weather compositor remains disabled. Cockpit
  // clouds use a separate, capped low-resolution GPU pass that never attaches
  // Cesium fog or post-process stages and is fully stopped in map mode.
  const weatherEffects = null;
  const cockpitCloudEffects = initCockpitCloudEffects(viewer, {
    weatherService: operations.requests.weather,
  });
  defer(() => cockpitCloudEffects?.destroy());

  // If no share link state, default to the device's current location
  // (falls back to Fuzhou when geolocation is unavailable or denied).
  if (!styleManager.hasShareState) {
<<<<<<< ours
    loaderStatus.textContent = t('Flying to Austin, TX...');
    defer(flyToAustin(viewer));
=======
    loaderStatus.textContent = '正在定位当前设备…';
    // GEV (owner 2026-09-28): startup camera owned by gev-autolocate.js
    // (地球上空 → 定位设备 → 手动逐帧电影补间放大到当前位置). The bundled call
    // snapped straight to the device with no animation; disabling leaves one owner.
    // defer(flyToDeviceLocation(viewer));
>>>>>>> theirs
  } else {
    loaderStatus.textContent = t('Restoring shared view...');
  }

  return { styleManager, weatherEffects, cockpitCloudEffects };
}
