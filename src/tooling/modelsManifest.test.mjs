import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RUNTIME_MODEL_FILES, pruneModels, syncModels } from '../../build/models.mjs';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'));

function reachableModelLiterals() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\n')
    .filter((file) => file.endsWith('.js') && !file.endsWith('.test.mjs'));
  const found = new Set();
  for (const file of files) {
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/['"]\/models\/([^'"/]+)['"]/g)) found.add(match[1]);
  }
  return [...found].sort();
}

test('every /models literal reachable from src/ ships in the build output', () => {
  const literals = reachableModelLiterals();
  // 上游 2026-11 合并后 src 仅引用 8 个 /models 字面量（b789 由
  // aircraftClass.js/modelVisualAnchor.js 引入，已加入 RUNTIME_MODEL_FILES）。
  assert.ok(literals.length >= 8, `expected model literals, got ${literals.length}`);
  for (const name of literals)
    assert.ok(
      RUNTIME_MODEL_FILES.includes(name),
      `${name} is referenced by src/ but missing from build/models.mjs RUNTIME_MODEL_FILES`,
    );
});

test('pruneModels keeps the runtime manifest and drops working copies', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'gev-models-'));
  mkdirSync(path.join(dist, 'models/_norm'), { recursive: true });
  writeFileSync(path.join(dist, 'models/_norm/huge.glb'), 'x'.repeat(64));
  writeFileSync(path.join(dist, 'models/a320.glb'), 'runtime');
  writeFileSync(path.join(dist, 'models/README.md'), 'attribution');
  const result = pruneModels(dist);
  assert.deepEqual(readdirSync(path.join(dist, 'models')).sort(), ['README.md', 'a320.glb']);
  assert.equal(result.removed, 1);
  assert.equal(result.kept, 2);
});

test('syncModels exports the subset with a sha256 manifest', () => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'gev-models-src-'));
  for (const name of RUNTIME_MODEL_FILES) writeFileSync(path.join(source, name), `${name}\n`);
  const target = mkdtempSync(path.join(os.tmpdir(), 'gev-models-out-'));
  const files = syncModels(target, source);
  assert.equal(files.length, RUNTIME_MODEL_FILES.length);
  const manifest = JSON.parse(readFileSync(path.join(target, 'models-manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, files.length);
  for (const entry of manifest.files) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(existsSync(path.join(target, entry.url.replace('/models/', ''))));
  }
});
