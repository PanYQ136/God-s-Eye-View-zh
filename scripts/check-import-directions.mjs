import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeModule } from './module-analysis.mjs';

const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
const code = /\.[mc]?js$/;
/* 2026-11-05 · data/bundledJson.js 契约：这两个文件的 Node 测试专用 JSON
   装载器必须用运行时计算的说明符，否则 Rollup 会把字面量属性化动态导入
   打成 ~2.9MB 浏览器永不可达的 JSON-module 死块（regions/marine/
   san-francisco 三组 Natural Earth / 街区数据在 dist 各双份）。
   计算导入对方向图不可见 —— 豁免面收敛到这两个文件，且目标均为
   无 import 的纯数据文件；其余文件的计算导入依旧被拒绝。 */
const COMPUTED_IMPORT_ALLOWLIST = new Set([
  'src/data/naturalEarthRegions.js',
  'src/data/neighborhoodPolygons.js',
]);
/* 应用装配入口：把「旧 main.js 的其余部分」搬进一个模块后（Phase7A3），它也是入口，
   与 src/main.js 同类 —— 允许它组装 standalone/rendering。 */
const entry = (file) =>
  file === 'src/main.js' ||
  file === 'src/bootstrap.js' ||
  file.startsWith('src/standalone/');
const tests = (file) =>
  file.endsWith('.test.mjs') ||
  file.startsWith('src/testSupport/') ||
  file.startsWith('src/tooling/') ||
  file === 'src/overlays/worldOverlayAllocation.worker.mjs' ||
  // Test double that wraps the real Cesium classes for weather/wind shells.
  file === 'src/layers/weather/shellFixture.mjs';
const source = (file) =>
  file.startsWith('src/sources/') ||
  /^src\/layers\/[^/]+\/(?:source|bundledSource|flowSource)\.js$/.test(file);
const renderer = (file) =>
  /^src\/(?:ui|app|standalone|overlays)\//.test(file) ||
  /^src\/layers\/[^/]+\/(?:index|rendering|snapshotRenderer|overlay|presentation|cards|controls)\.js$/.test(
    file,
  );
// One compatibility composition entry intentionally selects standalone defaults.
<<<<<<< ours
=======
// 2026-11-01：`src/ui.js`（@deprecated 兼容壳，零引用）已删除，原先给它的那条
// 豁免边同时移除；若日后有人重建该入口，这里不再放行，需显式登记。
>>>>>>> theirs
const compatibilityEdge = (from, to) =>
  from === 'server/providers/local.js' &&
  to === 'server/standalone/key-setup.js';
const portableExport = (key) =>
  key.startsWith('./sources/') ||
  /\/source$/.test(key) ||
  /^\.\/layers\/(?:flights|military|vessels)\/(?:records|ingestion)$/.test(
    key,
  ) ||
  [
    './director',
    './tools',
    './tools/mcp',
    './tools/services',
    './view',
    './voice/action-schemas',
    './voice/session',
    './data/lifecycle',
  ].includes(key);

/** Check every runtime file, plus transitive portable/source graphs, independently of bundler reachability. */
export function checkImportDirections(
  root,
  { cesiumStrict = process.env.GEV_CESIUM_SINGLE_ENTRY !== 'warn' } = {},
) {
  root = realpathSync(root);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = [
    ...new Set(
      execFileSync(
        'git',
        [
          'ls-files',
          '-z',
          '--cached',
          '--others',
          '--exclude-standard',
          '--',
          'src',
          'server',
        ],
        { cwd: root, encoding: 'utf8' },
      ).split('\0'),
    ),
  ].filter(
    (file) =>
      code.test(file) && !tests(file) && existsSync(path.join(root, file)),
  );
  const errors = new Set();
  const warnings = new Set();
  const modules = new Map();
  const relative = (file) =>
    path.relative(root, file).split(path.sep).join('/');
  const report = (file, message) => errors.add(`${file}: ${message}`);
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const resolved = realpathSync(path.join(root, file));
    if (relative(resolved) !== file) {
      report(
        file,
        'Runtime modules must not alias other owners through symlinks',
      );
      return null;
    }
    let analysis;
    try {
      analysis = analyzeModule(readFileSync(resolved, 'utf8'), {
        allowComputedImports: COMPUTED_IMPORT_ALLOWLIST.has(file),
      });
    } catch (error) {
      report(file, error.message);
      return null;
    }
    const record = { ...analysis, edges: [], external: [] };
    modules.set(file, record);
    for (const specifier of analysis.imports) {
      let target;
      if (specifier.startsWith('.'))
        target = path.resolve(path.dirname(resolved), specifier.split('?')[0]);
      else if (specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)) {
        const key =
          specifier === pkg.name ? '.' : '.' + specifier.slice(pkg.name.length);
        const exported = pkg.exports?.[key];
        if (typeof exported !== 'string') {
          report(file, `Unsupported self import: ${specifier}`);
          continue;
        }
        target = path.resolve(root, exported);
      } else {
        record.external.push(specifier);
        // #14 单一出口：只有 src/cesium.js 可以直连 npm 包 `cesium`。
        // 先 warn（默认）再 error（--strict-cesium / GEV_CESIUM_SINGLE_ENTRY=error）。
        if (specifier === 'cesium' && file !== 'src/cesium.js')
          (cesiumStrict ? errors : warnings).add(
            `${file}: Import Cesium through src/cesium.js, not the package directly`,
          );
        if (
          file.startsWith('src/') &&
          (builtins.has(specifier) || specifier.startsWith('node:'))
        )
          report(file, `Node builtin in browser module: ${specifier}`);
        if (
          specifier.startsWith('/') ||
          (/^[a-z]+:/i.test(specifier) && !specifier.startsWith('node:'))
        )
          report(file, `Use repository or package imports: ${specifier}`);
        continue;
      }
      if (!existsSync(target)) {
        report(file, `Missing import: ${specifier}`);
        continue;
      }
      const to = relative(realpathSync(target));
      if (to.startsWith('../') || path.isAbsolute(to)) {
        report(file, `Import escapes repository: ${specifier}`);
        continue;
      }
      record.edges.push(to);
      if (file.startsWith('src/') && to.startsWith('server/'))
        report(file, `Browser imports server: ${to}`);
      if (
        !compatibilityEdge(file, to) &&
        file.startsWith('server/providers/') &&
        (to.startsWith('server/standalone/') || renderer(to))
      )
        report(file, `Provider imports application/rendering: ${to}`);
      if (
        !compatibilityEdge(file, to) &&
        file.startsWith('src/') &&
        !entry(file) &&
        entry(to)
      )
        report(file, `Reusable module imports standalone setup: ${to}`);
      if (source(file) && renderer(to))
        report(file, `Source imports rendering/application: ${to}`);
      if (file === 'src/voice/gevActions.js' && to === 'src/data/manager.js')
        report(
          file,
          'Actions must consume feed state without the manager facade',
        );
    }
    return record;
  }
  for (const file of files) load(file);
  // A helper outside src must not smuggle Node or server code into a browser graph.
  const browserSeen = new Set();
  function browser(file) {
    if (browserSeen.has(file) || !code.test(file)) return;
    browserSeen.add(file);
    const info = load(file);
    if (!info) return;
    for (const specifier of info.external) {
      if (builtins.has(specifier) || specifier.startsWith('node:'))
        report(file, `Browser graph reaches Node builtin: ${specifier}`);
    }
    for (const to of info.edges) {
      if (to.startsWith('server/') || tests(to))
        report(file, `Browser graph reaches non-runtime owner: ${to}`);
      else browser(to);
    }
  }
  for (const file of files.filter((file) => file.startsWith('src/')))
    browser(file);
  const roots = new Map(files.filter(source).map((file) => [file, 'source']));
  for (const [key, value] of Object.entries(pkg.exports || {})) {
    if (portableExport(key) && typeof value === 'string')
      roots.set(value.replace(/^\.\//, ''), key);
  }
  roots.set('src/data/feedState.js', 'feed state');
  for (const [start, label] of roots) {
    if (!existsSync(path.join(root, start))) {
      report(start, `Missing portable entry: ${label}`);
      continue;
    }
    const seen = new Set();
    function visit(file) {
      if (seen.has(file) || !code.test(file)) return;
      seen.add(file);
      const info = load(file);
      if (!info) return;
      if (info.browser.length)
        report(
          file,
          `${label} reaches browser globals: ${info.browser.join(', ')}`,
        );
      for (const specifier of info.external) {
        if (
          builtins.has(specifier) ||
          specifier.startsWith('node:') ||
          /^(?:cesium|vite)(?:\/|$)/.test(specifier)
        )
          report(
            file,
            `${label} reaches platform/rendering dependency: ${specifier}`,
          );
      }
      for (const to of info.edges) {
        if (renderer(to) || to.startsWith('server/'))
          report(file, `${label} reaches application/rendering: ${to}`);
        else visit(to);
      }
    }
    visit(start);
  }
  // Common voice controls may use their DOM view, but never a protocol implementation.
  const voiceSeen = new Set();
  function voice(file) {
    if (voiceSeen.has(file)) return;
    voiceSeen.add(file);
    const info = load(file);
    for (const to of info?.edges || []) {
      if (/^src\/voice\/realtime/.test(to))
        report(file, `Common voice controls import protocol: ${to}`);
      else if (code.test(to)) voice(to);
    }
  }
  if (existsSync(path.join(root, 'src/voice/sessionCommands.js')))
    voice('src/voice/sessionCommands.js');
  if (errors.size) throw new Error([...errors].join('\n'));
  return {
    modules: files.length,
    portableEntries: roots.size,
    warnings: [...warnings],
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  /* Phase8E #14：出口已收干净（0 处直连），默认由 warn 升级为 error。
     `--warn-cesium` / GEV_CESIUM_SINGLE_ENTRY=warn 是逃生口（迁移期用）。 */
  const warnOnly =
    process.argv.includes('--warn-cesium') ||
    process.env.GEV_CESIUM_SINGLE_ENTRY === 'warn';
  process.env.GEV_CESIUM_SINGLE_ENTRY = warnOnly ? 'warn' : 'error';
  try {
    const result = checkImportDirections(
      fileURLToPath(new URL('../', import.meta.url)),
    );
    if (result.warnings.length) {
      console.error(result.warnings.join('\n'));
      console.error(
        `[warn] ${result.warnings.length} file(s) import Cesium directly (warn-only mode; drop --warn-cesium / GEV_CESIUM_SINGLE_ENTRY=warn to fail the build)`,
      );
    }
    console.log(
      JSON.stringify({
        modules: result.modules,
        portableEntries: result.portableEntries,
        cesiumWarnings: result.warnings.length,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
