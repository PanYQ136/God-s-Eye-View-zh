import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeModule } from '../../scripts/module-analysis.mjs';
import { checkImportDirections } from '../../scripts/check-import-directions.mjs';

function fixture(t, exports = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gev-directions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const write = (name, source = '') => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), source);
  };
  write(
    'package.json',
    JSON.stringify({ name: '@gods-eye-view/core', exports }),
  );
  write('src/data/feedState.js');
  return { root, write };
}

test('module analysis parses dependencies and platform references without reading comments or property labels', () => {
  assert.deepEqual(
    analyzeModule(
      "// import('node:fs'); document\nimport x from 'one'; export { x } from 'two'; export * from 'three'; import('four'); const data = { document: 1 }; data.window;",
    ),
    { imports: ['one', 'two', 'three', 'four'], browser: [] },
  );
  assert.deepEqual(
    analyzeModule(
      "const data = { element: document }; globalThis['navigator'];",
    ).browser,
    ['document', 'navigator'],
  );
  assert.throws(() => analyzeModule('import(name)'), /Computed/);
  assert.throws(() => analyzeModule("require('node:fs')"), /ES imports/);
});

test('computed-import allowance is opt-in per module and records no edge', () => {
  // data/bundledJson.js 的 Node 测试专用装载器（见门禁脚本白名单注释）：
  // 豁免后不再抛错，但计算导入也不进方向图。
  const source =
    "import x from './known.js'; const spec = './x.json'; import(spec);";
  assert.throws(() => analyzeModule(source), /Computed/);
  const allowed = analyzeModule(source, { allowComputedImports: true });
  assert.deepEqual(allowed.imports, ['./known.js']);
});

test('portable sources can share records, and standalone can assemble rendering', (t) => {
  const { root, write } = fixture(t, {
    './layers/demo/source': './src/layers/demo/source.js',
  });
  write('src/layers/demo/source.js', "export { read } from './records.js';");
  write('src/layers/demo/records.js', 'export const read = (value) => value;');
  write('src/standalone/catalog.js', "import '../layers/demo/index.js';");
  /* Phase8E #14 pinned the single Cesium exit: `src/cesium.js` is the only file
     allowed to import the npm package, and every rendering module goes through
     it. The fixture has to model that shape — a demo renderer importing
     `cesium` directly is now the very thing the checker rejects — so the
     assembly keeps its rendering dependency while the sanctioned path is also
     exercised (the returned warnings must stay empty). */
  write('src/cesium.js', "export * from 'cesium';");
  write(
    'src/layers/demo/index.js',
    "import { Viewer } from '../../cesium.js';",
  );
  const result = checkImportDirections(root);
  assert.deepEqual(
    result.warnings,
    [],
    'the sanctioned single exit must not warn',
  );
  assert.equal(result.modules, 6);
});

for (const [name, files, pattern] of [
  [
    'unreachable source imports rendering',
    {
      'src/layers/demo/source.js': "import './rendering.js';",
      'src/layers/demo/rendering.js': '',
    },
    /Source imports rendering/,
  ],
  [
    'source reaches a platform through a record helper',
    {
      'src/layers/demo/source.js': "import './records.js';",
      'src/layers/demo/records.js': "import 'cesium';",
    },
    /reaches platform\/rendering/,
  ],
  [
    'source reaches a DOM helper',
    {
      'src/sources/demo.js': "import '../data/helper.js';",
      'src/data/helper.js': 'export const view = () => globalThis.document;',
    },
    /reaches browser globals/,
  ],
  [
    'browser imports Node without prefix',
    { 'src/unused.mjs': "import 'fs/promises';" },
    /Node builtin/,
  ],
  [
    'browser hides Node outside src',
    {
      'src/unused.js': "import '../shared/helper.js';",
      'shared/helper.js': "export * from 'node:fs';",
    },
    /Browser graph reaches Node/,
  ],
  [
    'browser imports server',
    {
      'src/data/demo.js': "import '../../server/helper.js';",
      'server/helper.js': '',
    },
    /Browser imports server/,
  ],
  [
    'reusable module selects standalone',
    {
      'src/app/demo.js': "import '../standalone/catalog.js';",
      'src/standalone/catalog.js': '',
    },
    /Reusable module imports standalone/,
  ],
  [
    'provider selects application setup',
    {
      'server/providers/demo.js': "import '../standalone/key-setup.js';",
      'server/standalone/key-setup.js': '',
    },
    /Provider imports application/,
  ],
  [
    'voice controls reach protocol indirectly',
    {
      'src/voice/sessionCommands.js': "import './helper.js';",
      'src/voice/helper.js': "import './realtimeSession.js';",
      'src/voice/realtimeSession.js': '',
    },
    /Common voice controls import protocol/,
  ],
  [
    'dynamic import cannot evade direction',
    { 'src/app/demo.js': "const target = './module.js'; import(target);" },
    /Computed/,
  ],
  [
    'browser imports test helper',
    {
      'src/app/demo.js': "import '../testSupport/helper.js';",
      'src/testSupport/helper.js': '',
    },
    /non-runtime owner/,
  ],
]) {
  test(`rejects ${name}`, (t) => {
    const { root, write } = fixture(t);
    for (const [file, body] of Object.entries(files)) write(file, body);
    assert.throws(() => checkImportDirections(root), pattern);
  });
}

test('self package imports cannot evade portable ownership', (t) => {
  const { root, write } = fixture(t, { './view': './src/ui/view.js' });
  write('src/sources/demo.js', "import '@gods-eye-view/core/view';");
  write('src/ui/view.js');
  assert.throws(() => checkImportDirections(root), /Source imports rendering/);
});

test('compatibility exceptions are limited to the one remaining composition entry', (t) => {
  // 2026-11-01：`src/ui.js` 这个 @deprecated 兼容入口已删除（零引用），
  // 对应豁免边一并移除；这里只保留仍存在的 server/providers/local.js → key-setup。
  const { root, write } = fixture(t);
  write('server/providers/local.js', "import '../standalone/key-setup.js';");
  write('server/standalone/key-setup.js');
  assert.doesNotThrow(() => checkImportDirections(root));
  // 被删掉的那条边不再放行：若有人重建同名入口，必须显式登记。
  write('src/ui.js', "import './standalone/catalog.js';");
  write('src/standalone/catalog.js');
  assert.throws(
    () => checkImportDirections(root),
    /Reusable module imports standalone/,
  );
  write('src/ui/new.js', "import '../standalone/catalog.js';");
  assert.throws(
    () => checkImportDirections(root),
    /Reusable module imports standalone/,
  );
});

test('symlink aliases do not hide renderer ownership', (t) => {
  const { root, write } = fixture(t);
  write('src/sources/demo.js', "import './helper/view.js';");
  write('src/ui/view.js');
  // Directory junctions exercise the same resolved edge without Windows symlink privileges.
  symlinkSync(
    path.join(root, 'src/ui'),
    path.join(root, 'src/sources/helper'),
    'junction',
  );
  assert.throws(() => checkImportDirections(root), /rendering|symlinks/);
});
