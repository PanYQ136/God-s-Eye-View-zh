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

/** 2026-11-01 · 拆包：把两个最大的第三方依赖分出去，让首屏不必等整张应用图。
    只拆 node_modules 里的叶子依赖（cesium / react 系），**不拆 src/** ——
    manualChunks 拆应用代码容易造出循环 chunk，运行期报 "Cannot access before
    initialization"。拆分后 chunkSizeWarningLimit 回到 900，让告警重新有信号。
    回收：删掉本函数与 rollupOptions.output 一项即恢复单块。 */
function gevManualChunks(id) {
  if (!id.includes('node_modules')) return;
  if (id.includes('/cesium/') || id.includes('\\cesium\\')) return 'cesium';
  if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
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
        console.log('[chunks] vendor split inactive (cesium 是 external 全局，react 未进应用图)');
      }
      console.log(
        `[chunks] ${rows.length} js chunk(s); top: ` +
          rows
            .slice(0, 5)
            .map((r) => `${r.file}=${r.rawKB}kB`)
            .join(' '),
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
    plugins: [
      cesium(),
      applicationHtmlPlugin(),
      deferCesiumScriptPlugin(),
      // #21：构建收尾只留运行时模型（其余 346 MB 工作副本不进产物）。
      modelsPlugin(),
      chunkReportPlugin(),
      ...plugins,
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
    // 2026-11-01：拆第三方 vendor，单块体积告警阈值回到 900（原 1500 等于关掉告警）。
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: { output: { manualChunks: gevManualChunks } },
    },
  };
}
