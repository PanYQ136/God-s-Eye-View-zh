import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBrowserViteConfig } from '../../build/vite.js';
import standaloneConfig from '../../vite.config.js';
import * as providers from '../../server/providers/local.js';

test('explicit build inputs preserve browser-only defines, plugin order and loopback protections', () => {
  const plugin = { name: 'fixture-provider' };
  const config = createBrowserViteConfig({
    plugins: [plugin],
    googleApiKey: 'browser-fixture',
    cesiumToken: 'ion-fixture',
  });
  assert.equal(config.plugins[5], plugin);
  /* [0] vite-plugin-cesium / [1] 组件模板展开 / [2] Phase7A-A：Cesium.js defer 注入 /
     [3] #21 模型产物闸门 / [4] chunk 体积报告（2026-11-01 新增）/
     [5] 调用方插件（断言上面一行） */
  assert.equal(config.plugins[2].name, 'gev-defer-cesium-script');
  assert.equal(config.plugins[3].name, 'gev-models-prune');
  assert.equal(config.plugins[4].name, 'gev-chunk-report');
  assert.equal(config.server.host, 'localhost');
  assert.equal(config.server.port, 4173);
  assert.deepEqual(config.server.allowedHosts, [
    'localhost',
    '127.0.0.1',
    '.local',
  ]);
  assert.ok(config.server.fs.deny.includes('**/ENVIRONMENT'));
  assert.ok(config.server.fs.deny.includes('.env.*'));
  assert.equal(config.server.headers['X-Frame-Options'], 'DENY');
  assert.equal(
    config.server.headers['Content-Security-Policy'],
    "frame-ancestors 'none'",
  );
  assert.deepEqual(config.define, {
    'import.meta.env.GOOGLE_MAPS_API_KEY': '"browser-fixture"',
    'import.meta.env.CESIUM_ION_TOKEN': '"ion-fixture"',
  });
  assert.equal(
    createBrowserViteConfig({ host: '0.0.0.0', port: '4800' }).server
      .allowedHosts,
    true,
  );
  assert.equal(
    createBrowserViteConfig({ host: '::', port: '4800' }).server.port,
    4800,
  );
});

test('build helper does not discover environment values or construct local providers', () => {
  const before = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'environment-fixture';
  try {
    const config = createBrowserViteConfig();
    assert.equal(
      config.define['import.meta.env.GOOGLE_MAPS_API_KEY'],
      undefined,
    );
    assert.equal(config.plugins.length, 5);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = before;
  }
});

test('root config stays config-only and providers re-export from providers/index.js', async () => {
  // #18：配置文件只导出 Vite 配置本身（单一职责）。
  const root = await import('../../vite.config.js');
  assert.deepEqual(Object.keys(root), ['default']);
  // provider 的再导出面搬到了 server/providers/index.js，名字与实现保持一致。
  const reexported = await import('../../server/providers/index.js');
  for (const [name, value] of Object.entries(providers))
    assert.equal(reexported[name], value, name);
  // The root config factory is async since it awaits the local-proxy bootstrap.
  const config = await standaloneConfig({ mode: 'test' });
  assert.deepEqual(
    config.plugins.slice(5, -2).map((plugin) => plugin.name),
    providers.localProviderPlugins().map((plugin) => plugin.name),
  );
  /* 尾巴两家：warmupPlugin（server/standalone/mini-speedup.js）+ apiNotFoundPlugin。
     这条断言在 warmup 插件引入后一直落后于实现（slice 到 -1 会把 gev-warmup 算进
     provider 列表），Phase7A-A 顺带对齐。 */
  assert.equal(config.plugins.at(-2).name, 'gev-warmup');
  assert.equal(config.plugins.at(-1).name, 'api-not-found');
});

test('build export resolves in Node and has no browser fallback', async () => {
  const exported = await import('gods-eye-view/build/vite');
  assert.equal(exported.createBrowserViteConfig, createBrowserViteConfig);
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url)),
  );
  assert.deepEqual(pkg.exports['./build/vite'], { node: './build/vite.js' });
});
