import { applicationHtmlPlugin } from './application-html.js';
import cesium from 'vite-plugin-cesium';

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
      const tag = /<script(\s+)src="(\/cesium\/Cesium\.js)"\s*><\/script>\s*/.exec(html);
      if (!tag) return html;
      const src = tag[2];
      return (
        html.replace(tag[0], '') +
        ''
      ).replace(
        /<\/head>/,
        `  <!-- Phase7A3：Cesium 只预下载不求值；求值时机由 src/cesium-boot.js 决定 -->\n` +
          `  <link rel="preload" as="script" href="${src}" />\n</head>`,
      );
    },
  };
}

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  host = 'localhost',
  port = 4173,
  command,
} = {}) {
  return {
    plugins: [cesium(), applicationHtmlPlugin(), deferCesiumScriptPlugin(), ...plugins],
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
      ],
    },
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      allowedHosts:
        host === '0.0.0.0' || host === '::'
          ? true
          : ['localhost', '127.0.0.1', '.local'],
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
      // These headers protect the document containing Provider Settings.
      headers: {
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
