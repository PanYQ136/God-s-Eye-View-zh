<<<<<<< ours
import { fileURLToPath } from 'node:url';
import cesium from 'vite-plugin-cesium';
import vue from '@vitejs/plugin-vue';
import { VUE_PLUGIN_OPTIONS } from './vueOptions.js';
import { DEFAULT_ALLOWED_HOSTS, hostCheckPlugin } from './allowedHosts.js';
import { embedFramingPlugin } from './embed-framing.js';
import { panelBuildPlugin } from './panel.js';

/**
 * The repository root (this file lives at `<root>/build/vite.js`), as a
 * forward-slash path for glob matching. Vite's `fs.deny` patterns are
 * matched against the full absolute file path, and a bare `**\/dist/**`
 * matches a `dist` directory at *any* depth — including dependencies that
 * ship their own, such as `node_modules/vite/dist/client/client.mjs` (the
 * dev client itself). Anchoring to this repository's root denies only the
 * project's own build output.
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
  .replace(/\\/g, '/')
  .replace(/\/$/, '');

export function escapeFsDenyPath(path) {
  return path.replace(/[()[\]{}*?!+@|]/g, '\\$&');
}

const REPO_ROOT_GLOB = escapeFsDenyPath(REPO_ROOT);

/**
 * Browser-safe form of the optional Photon endpoint build input. Only https
 * is accepted: the page's connect-src allows no plain-http origin, so an
 * http endpoint would only fail later, silently, in the browser.
 */
function photonEndpointSetting(value) {
  if (value === undefined) return undefined;
  const text = String(value ?? '').trim();
  if (!text || ['off', 'none', 'disabled'].includes(text.toLowerCase()))
    return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy for every document the dev/preview server serves.
 * No inline script is permitted, and the only foreign script origins are the
 * three that the Bhote Koshi event's embedded media needs (YouTube, Facebook
 * and X), which frame-src matches for their players and posts. 'unsafe-eval' is
 * required: Knockout (bundled inside @cesium/widgets) resolves the global
 * object with `(0, eval)("this")` at module load, and without it the Cesium
 * widget never initializes (verified in headless Chrome). It also covers
 * Cesium's WASM decoders. `blob:` is required in the built app: Cesium's
 * bundled workers bootstrap through `importScripts(blob:...)`, which a worker
 * checks against script-src (the dev server loads them by URL instead).
 * Widen any other directive only for a real violation.
 */
export const BROWSER_CSP = [
  "default-src 'self'",
  // The Bhote Koshi event's embedded media: the YouTube player API, the
  // Facebook video SDK and X's post widget (src/data/bhoteKoshiEmbeddedMedia.js);
  // and the Maps JavaScript API that Street Level's Google Street View runs on.
  "script-src 'self' 'unsafe-eval' blob: https://www.youtube.com https://connect.facebook.net https://platform.twitter.com https://maps.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' blob: data: https: wss: ws:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // The same media's players and posts, which load in frames.
  "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.youtube.com https://www.facebook.com https://platform.twitter.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Response headers shared by the dev and preview servers. */
export const BROWSER_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': BROWSER_CSP,
  // Responses are only ever used as the type the server declares.
  'X-Content-Type-Options': 'nosniff',
});

/**
 * Content-Security-Policy for every `/api` response. API routes return data,
 * never a document, so a response opened directly in a tab gets no origin and
 * can load nothing.
 */
export const API_CSP = "default-src 'none'; sandbox";

/** Response headers every `/api` response carries. */
export const API_HEADERS = Object.freeze({
  'Content-Security-Policy': API_CSP,
  'X-Content-Type-Options': 'nosniff',
});

/**
 * Whether a request reaches an `/api` mount, by the router's own rule: the
 * prefix compared without case and followed by the end, `/` or `.`. The router
 * reads an absolute-form target's path without resolving dot segments, so the
 * path is taken here the same way (scheme and authority dropped, backslashes as
 * slashes), alongside the raw and the fully parsed path; any match counts.
 */
function isApiPath(url) {
  const raw = String(url || '/');
  const target = raw
    .trim()
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .replace(/^[a-z][a-z0-9+.-]*:(?:\/\/[^/]*)?/i, '');
  let parsed = '';
  try {
    parsed = new URL(raw, 'http://localhost').pathname;
  } catch {
    /* the unparsed paths still decide */
  }
  return [raw.split(/[?#]/, 1)[0], target, parsed].some((path) =>
    /^\/api(?:$|[/.])/i.test(path),
  );
}

/**
 * Vite plugin that sets API_HEADERS on every API response before any other
 * middleware runs, so success, error, partial, refused and unknown-route
 * answers all carry them. Vite's `server.headers` and `preview.headers` only
 * reach the documents and assets Vite serves itself. A route may still add
 * headers; a route's own Content-Security-Policy is sent as an additional
 * policy, which can only restrict further, never replace this one.
 */
export function apiResponseHeadersPlugin() {
  const install = (server) => {
    server.middlewares.use((req, res, next) => {
      if (!isApiPath(req.url)) return next();
      for (const [name, value] of Object.entries(API_HEADERS))
        res.setHeader(name, value);
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) =>
        String(name).toLowerCase() === 'content-security-policy' &&
        String(value) !== API_CSP
          ? setHeader(name, `${API_CSP}, ${value}`)
          : setHeader(name, value);
      next();
    });
  };
  return {
    name: 'api-response-headers',
    enforce: 'pre',
    configureServer: install,
    configurePreviewServer: install,
=======
import { applicationHtmlPlugin } from './application-html.js';
import { modelsPlugin } from './models.mjs';
import cesium from 'vite-plugin-cesium';
import { mkdirSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

/** Phase7A-A/R8 + Phase7A3：让 `/cesium/Cesium.js` 既不阻塞 HTML 解析、
    **也不阻塞卡片层求值**。
    vite-plugin-cesium 在 build 时把 5.73MB 的 Cesium.js 作为 classic script 注入
    head（默认 head-prepend）。per HTML 规范，classic defer 与 module 脚本按
    **文档顺序**执行 —— 它排在 head 最前时，`src/lc`（卡壳/LC）必须等它下载
    （约 4.7s）+ 求值（约 3s）才能 mount，这就是「卡片可点 4.3–8.2s」的根因。
    Phase7A3 改法：
      ① 把 tag 从 head 开头摘掉，换成 `<link rel="preload" as="script">`
         —— 下载照旧在解析期并行发起，但**不求值**；
      ② 真正的 `<script>` 由 `src/cesium-boot.js` 在「卡片已挂载 + 输入已放行」
         之后注入（命中 preload 缓存，即时），应用图（src/bootstrap.js）再动态
         import 求值。
    删掉本插件即回滚为同步注入。
 */
function deferCesiumScriptPlugin() {
  return {
    name: 'gev-defer-cesium-script',
    enforce: 'post',
    transformIndexHtml(html) {
      const tag =
        /<script(\s+)src="(\/cesium\/Cesium\.js)"\s*><\/script>\s*/.exec(html);
      if (!tag) return html;
      const src = tag[2];
      return (html.replace(tag[0], '') + '').replace(
        /<\/head>/,
        `  <!-- Phase7A3：Cesium 只预下载不求值；求值时机由 src/cesium-boot.js 决定 -->\n` +
          `  <link rel="preload" as="script" href="${src}" />\n</head>`,
      );
    },
  };
}

/** 2026-11-01 · 拆包：把两个最大的第三方依赖分出去，让首屏不必等整张应用图。
    只拆 node_modules 里的叶子依赖（cesium / react 系），**不拆 src/** ——
    manualChunks 拆应用代码容易造出循环 chunk，运行期报 "Cannot access before
    initialization"。拆分后 chunkSizeWarningLimit 回到 900，让告警重新有信号。
    回收：删掉本函数与 rollupOptions.output 一项即恢复单块。 */
function gevManualChunks(id) {
  if (!id.includes('node_modules')) return;
  if (id.includes('/cesium/') || id.includes('\\cesium\\')) return 'cesium';
  if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
    return 'vendor-react';
  return;
}

/** 构建后把每个 chunk 的体积写进 .gev-logs/build/chunks.json，便于和下一轮对比。 */
function chunkReportPlugin() {
  return {
    name: 'gev-chunk-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const rows = [];
      for (const [file, item] of Object.entries(bundle)) {
        if (item.type !== 'chunk' || !/\.m?js$/.test(file)) continue;
        const code = item.code || '';
        rows.push({
          file,
          rawKB: +(Buffer.byteLength(code) / 1024).toFixed(1),
          gzipKB: +(zlib.gzipSync(code).length / 1024).toFixed(1),
          modules: Object.keys(item.modules || {}).length,
        });
      }
      rows.sort((a, b) => b.rawKB - a.rawKB);
      try {
        mkdirSync('.gev-logs/build', { recursive: true });
        writeFileSync(
          '.gev-logs/build/chunks.json',
          `${JSON.stringify({ at: new Date().toISOString(), chunks: rows }, null, 2)}\n`,
        );
      } catch (e) {
        this.warn(`chunk report skipped: ${e.message}`);
      }
      if (!rows.some((r) => /(^|\/)(cesium|vendor-react)-/.test(r.file))) {
        console.log(
          '[chunks] vendor split inactive (cesium 是 external 全局，react 未进应用图)',
        );
      }
      console.log(
        `[chunks] ${rows.length} js chunk(s); top: ` +
          rows
            .slice(0, 5)
            .map((r) => `${r.file}=${r.rawKB}kB`)
            .join(' '),
      );
    },
>>>>>>> theirs
  };
}

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  photonUrl,
  mapillaryToken,
  host = 'localhost',
  port = 4173,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  command,
} = {}) {
  const photonSetting = photonEndpointSetting(photonUrl);
  return {
    plugins: [
<<<<<<< ours
      // First, so every API response, including a Host refusal, carries them.
      apiResponseHeadersPlugin(),
      // Next, so no provider route answers a Host the server does not allow.
      hostCheckPlugin(),
      cesium(),
      // Application views are Vue single-file components.
      vue(VUE_PLUGIN_OPTIONS),
      ...plugins,
      embedFramingPlugin(),
      panelBuildPlugin(),
=======
      cesium(),
      applicationHtmlPlugin(),
      deferCesiumScriptPlugin(),
      // #21：构建收尾只留运行时模型（其余 346 MB 工作副本不进产物）。
      modelsPlugin(),
      chunkReportPlugin(),
      ...plugins,
>>>>>>> theirs
    ],
    ...(publicDir === undefined ? {} : { publicDir }),
    // A production build must not clean the dependency cache a running dev
    // server is still serving optimized module URLs from.
    ...(command === 'build' ? { cacheDir: 'node_modules/.vite-build' } : {}),
    optimizeDeps: {
      // First reached through the SDR worker or a dynamic import. Pre-bundle
      // them at startup so first use cannot invalidate already-transformed
      // URLs with Vite's "Outdated Optimize Dep" 504 response.
      include: [
        '@jtarrio/signals/demod/demodulator.js',
        '@jtarrio/signals/demod/modes.js',
        '@jtarrio/webrtlsdr/rtlsdr.js',
        'egm96-universal',
        // Loaded on demand when the first street-level image opens.
        'mapillary-js',
      ],
    },
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      // A wildcard bind only chooses interfaces; it never disables Vite's
      // Host-header check. LAN hostnames are added explicitly (see
      // build/allowedHosts.js); IP addresses are always accepted.
      allowedHosts: [...allowedHosts],
      fs: {
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          '**/ENVIRONMENT',
          '**/.gev-logs/**',
          '**/.gev-cache/**',
          // Root-anchored: a bare '**/dist/**' would also deny every
          // dependency's own dist/ (e.g. node_modules/vite/dist/client),
          // breaking /@vite/client and other dev-client assets.
          `${REPO_ROOT_GLOB}/dist/**`,
        ],
      },
      // These headers protect the document containing Provider Settings and
      // give the whole page a real Content-Security-Policy (BROWSER_CSP).
      // Embed-mode documents are framable instead: embed-framing.js rewrites
      // only the frame-ancestors directive and keeps the rest of the policy.
      headers: BROWSER_HEADERS,
    },
    // The preview server serves the same documents, so it carries the same
    // framing + CSP hardening (one constant, no drift).
    preview: { headers: BROWSER_HEADERS },
    define: {
      // vue-i18n holds the locale and catalogs; Core formats the messages
      // (src/ui/i18n.js), so the build drops vue-i18n's message compiler.
      __VUE_I18N_FULL_INSTALL__: 'false',
      __VUE_I18N_LEGACY_API__: 'false',
      __INTLIFY_PROD_DEVTOOLS__: 'false',
      __INTLIFY_DROP_MESSAGE_COMPILER__: 'true',
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
      // Only expose a validated URL or the explicit disabled sentinel.
      ...(photonSetting === undefined
        ? {}
        : {
            'import.meta.env.PHOTON_URL': JSON.stringify(photonSetting),
          }),
      // Mapillary client tokens are public by design (see SECURITY.md).
      'import.meta.env.MAPILLARY_CLIENT_TOKEN': JSON.stringify(
        mapillaryToken ?? '',
      ),
    },
    // 2026-11-01：拆第三方 vendor，单块体积告警阈值回到 900（原 1500 等于关掉告警）。
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: { output: { manualChunks: gevManualChunks } },
    },
  };
}
