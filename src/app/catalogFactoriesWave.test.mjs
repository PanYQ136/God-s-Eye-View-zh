/**
 * 波次工厂清单一致性（Phase8E · D2 收口）。
 *
 * 背景：`constructCatalog.js` 把 40 条静态 import 换成两波 `import()` 之后，
 * 波次文件漏导出一个工厂只会在运行时炸（曾漏 airQuality/osmPlaces/gnss/
 * ghostMaps/droneAirspace/streetLevel/osmOverlays 七个，触发 ReferenceError）。
 * 静态检查抓不到这种"解构清单 vs 导出清单"的缺口，所以这里直接读源码对齐。
 *
 * 三条断言：
 *   1. 解构清单 ⊆ core ∪ rest 导出（零遗漏）；
 *   2. core 与 rest 无交集、波次文件内无重名导出（否则后者静默覆盖前者）；
 *   3. 装配文件不再出现指向 layers/ 的静态 import（防止拆包回潮）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ASSEMBLY = new URL('./constructCatalog.js', import.meta.url);
const WAVES = [
  new URL('./catalogFactoriesCore.js', import.meta.url),
  new URL('./catalogFactoriesRest.js', import.meta.url),
];

async function readSource(url) {
  return readFile(url, 'utf8');
}

/** 装配文件里 `const { … } = factories;` 的解构名单。 */
function destructuredNames(source) {
  const start = source.indexOf('const {');
  assert.notEqual(start, -1, 'assembly must destructure the factory waves');
  const end = source.indexOf('} = factories;', start);
  assert.notEqual(end, -1, 'assembly must destructure from `factories`');
  return source
    .slice(start + 'const {'.length, end)
    .split(',')
    .map((line) => line.replace(/\/\/.*$/gm, '').trim())
    .filter(Boolean);
}

/** 波次文件的 `export { X } from …` 名单。 */
function exportedNames(source) {
  const names = [];
  const pattern = /export\s*\{([^}]*)\}\s*from/g;
  for (const match of source.matchAll(pattern)) {
    for (const entry of match[1].split(',')) {
      const name = entry.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  return names;
}

test('every destructured factory is exported by exactly one wave', async () => {
  const assembly = await readSource(ASSEMBLY);
  const wanted = destructuredNames(assembly);
  assert.ok(wanted.length > 30, `unexpected small factory list: ${wanted.length}`);

  const waves = await Promise.all(WAVES.map(readSource));
  const [core, rest] = waves.map(exportedNames);

  const missing = wanted.filter(
    (name) => !core.includes(name) && !rest.includes(name),
  );
  assert.deepEqual(
    missing,
    [],
    `destructured factories missing from both waves: ${missing.join(', ')}`,
  );
});

test('the waves do not overlap and export no duplicate names', async () => {
  const [core, rest] = (await Promise.all(WAVES.map(readSource))).map(
    exportedNames,
  );

  const duplicatedWithinCore = core.filter((n, i) => core.indexOf(n) !== i);
  const duplicatedWithinRest = rest.filter((n, i) => rest.indexOf(n) !== i);
  assert.deepEqual(duplicatedWithinCore, [], 'duplicate exports in core wave');
  assert.deepEqual(duplicatedWithinRest, [], 'duplicate exports in rest wave');

  const overlap = core.filter((name) => rest.includes(name));
  assert.deepEqual(
    overlap,
    [],
    `names exported by both waves would resolve to the last spread: ${overlap.join(', ')}`,
  );
});

test('the assembly keeps layer code out of static imports', async () => {
  // Only these may stay static: the catalog contract, source composition and the
  // serialization registry (`layerState.js` is metadata, not a layer factory —
  // it costs no layer code and the UI needs it before any wave resolves).
  const allowed = new Set([
    './sourceComposition.js',
    './catalog.js',
    '../data/layerState.js',
  ]);
  const assembly = await readSource(ASSEMBLY);
  const staticImports = [
    ...assembly.matchAll(/^import[^;]*from\s+'([^']+)';?$/gm),
  ].map((match) => match[1]);

  const offenders = staticImports.filter(
    (specifier) => !allowed.has(specifier),
  );
  assert.deepEqual(
    offenders,
    [],
    `layer code must arrive through the waves, found static imports: ${offenders.join(', ')}`,
  );
});
