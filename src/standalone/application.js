import { createStandaloneCatalog, setStandaloneCatalog } from './catalog.js';
import { createStandalonePlaceSearch } from './placeSearch.js';
import { CITY_POIS } from '../cityPois.js';
import { createApplication } from '../app/application.js';
import { scheduleCatalogHydration } from '../app/deferredCatalog.js';
import { createStandaloneScene } from './scene.js';
import { createStandaloneControls } from './controls.js';
import { createStandaloneData } from './data.js';
import { createStandaloneTools } from './tools.js';
import { resolveLocale, applyDocumentLanguage } from '../i18n/locale.js';
import {
  applyDocumentTranslations,
  getLocale,
  onLocaleChange,
  setLocale,
} from '../i18n/index.js';
import { mountApplicationViews } from '../ui/views/index.js';
import { createGoogleTokenSource } from '../maps/googleTokens.js';

// The existing controls and layer catalog contain page-scoped state.
let constructed = false;

/** Compose the standalone application once per page. Reload to start again. */
export function createStandaloneApplication({
  googleApiKey,
  cesiumToken,
  geospatial = {},
  voice = {},
  sources = {},
  streetLevelProviders,
  allowQaRegistration = false,
}) {
  if (constructed)
    throw new Error('The standalone application already owns this page');
  constructed = true;
  // Locale is resolved before any UI initialization so <html lang>/<html dir>
  // and every catalog lookup agree from the first painted frame. Module
  // scripts execute after parsing, so the DOM is ready here: the views
  // translate as they render, and the page's static data-i18n* markup (the
  // loading screen) is translated here and after every language switch.
  const activeLocale = resolveLocale();
  setLocale(activeLocale);
  applyDocumentLanguage(document, activeLocale);
  // Views render the page's markup; wiring reads it.
  mountApplicationViews(document);
  applyDocumentTranslations(document);
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');
  let placeSearch;
  let catalog;
  const application = createApplication({
    createScene: async (context) => {
      // A language switch applies in place; the page's own markup follows.
      context.defer(
        onLocaleChange(() => {
          applyDocumentLanguage(document, getLocale());
          applyDocumentTranslations(document);
        }),
      );
      placeSearch = createStandalonePlaceSearch({
        // The bundled city and landmark data the offline name provider reads.
        // The search package takes it as plain data rather than importing it,
        // so it stays free of application state.
        presets: CITY_POIS,
        ...geospatial,
        resolveApiKey: () => googleApiKey,
        signal: context.signal,
      });
      const scene = await createStandaloneScene({
        ...context,
        googleApiKey,
        // Without a key, Google 3D can still load with tokens from the
        // app's server when it offers them.
        googleTokens: googleApiKey ? null : createGoogleTokenSource(),
        cesiumToken,
        loaderStatus,
      });
<<<<<<< ours
      catalog = createStandaloneCatalog({
        sources,
        streetLevelProviders,
=======
      catalog = await createStandaloneCatalog({
>>>>>>> theirs
        nepalBoundaryResolver: (signal) =>
          scene.operations.annotationResolver.resolveRegionRingForQuery(
            'Nepal',
            signal,
            placeSearch,
            // The locator draws the border whenever it arrives.
            { budgetMs: Infinity },
          ),
        signal: context.signal,
        surface: scene.operations.surface,
      });
      // 兼容入口（src/ui.js / standalone/controls.js / data.js）读这一份；
      // 启动链路自己用的是下面显式传下去的 catalog。
      setStandaloneCatalog(catalog);
      return scene;
    },
    createControls: (context) =>
      createStandaloneControls({
        ...context,
        loaderStatus,
        placeSearch,
        catalog,
      }),
    createData: (context) =>
      createStandaloneData({ ...context, allowQaRegistration, catalog }),
    createTools: (context) =>
      createStandaloneTools({ ...context, loadingScreen, placeSearch, voice }),
  });
  return Object.freeze({
    ...application,
    /**
     * Phase8E2：应用就绪之后才水合波次 2 图层（首帧 + 空闲），
     * 让首屏完全不请求非默认 layers 的工厂 chunk。
     */
    start() {
      return application.start().then((components) => {
        void scheduleCatalogHydration(catalog);
        return components;
      });
    },
  });
}
