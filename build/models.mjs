/**
 * 3D 模型产物体积闸门（问题清单 #21 · Phase8E）
 *
 * 现状（Phase8E 前）：`dist` 377.9 MB，其中 `models` 346.7 MB（92%），
 * `dist/models` 里 `_norm/ _skb/ _baked/ ships/ trains/ vehicles/` 全是不进运行时
 * 的中间件/工作副本 —— 每次发布都要同步 3D 模型，部署与冷启动成本高。
 *
 * 做法（不删源文件）：
 *   1. 清单只列「运行时真的会请求」的 `/models/*.glb`（由 `src/**` 里的
 *      `'/models/…'` 字面量推出，见 `src/tooling/modelsManifest.test.mjs` 守卫）
 *      + `README.md`（CC BY 4.0 要求署名随产物发布，不能删）；
 *   2. 构建收尾（`closeBundle`）把 `dist/models` 里清单以外的条目删掉；
 *   3. 需要把模型放独立域名/CDN 时 `node build/models.mjs --sync <dir>` 只导出
 *      清单内的文件 + `models-manifest.json`（含 sha256/字节数），产物里再删
 *      `dist/models` 即可（本卡不删，默认仍留本地回退）。
 *
 * 回滚：删掉 `build/vite.js` 里 `modelsPlugin()` 一项（或设
 * `GEV_KEEP_ALL_MODELS=1`）即恢复「public/models 全量进 dist」。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Runtime model files: every `/models/<file>.glb` literal reachable from src/. */
export const RUNTIME_MODEL_FILES = Object.freeze([
  'airplane.glb',
  'jet.glb',
  'a320.glb',
  'a350.glb',
  'a380.glb',
  'atr72.glb',
  'b737.glb',
  'bell206.glb',
  'c172.glb',
  'citation2.glb',
  'mq9.glb',
  // Attribution is part of the license obligation, not an asset.
  'README.md',
]);

const isRuntimeModel = (name) => RUNTIME_MODEL_FILES.includes(name);

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Delete everything under `<distDir>/models` that is not in RUNTIME_MODEL_FILES. */
export function pruneModels(distDir) {
  const models = path.join(distDir, 'models');
  if (!existsSync(models)) return { removed: 0, kept: 0, bytesRemoved: 0 };
  let removed = 0;
  let kept = 0;
  let bytesRemoved = 0;
  for (const name of readdirSync(models)) {
    const target = path.join(models, name);
    if (isRuntimeModel(name)) {
      kept += 1;
      continue;
    }
    const size = statSync(target).isDirectory() ? dirSize(target) : statSync(target).size;
    rmSync(target, { recursive: true, force: true });
    removed += 1;
    bytesRemoved += size;
  }
  return { removed, kept, bytesRemoved };
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(target) : statSync(target).size;
  }
  return total;
}

/** Copy the runtime subset to a standalone directory (CDN staging) + manifest. */
export function syncModels(targetDir, sourceDir = path.join(root, 'public/models')) {
  mkdirSync(targetDir, { recursive: true });
  const files = [];
  for (const name of RUNTIME_MODEL_FILES) {
    const from = path.join(sourceDir, name);
    if (!existsSync(from)) throw new Error(`Missing runtime model: ${from}`);
    copyFileSync(from, path.join(targetDir, name));
    files.push({ url: `/models/${name}`, bytes: statSync(from).size, sha256: sha256(from) });
  }
  writeFileSync(
    path.join(targetDir, 'models-manifest.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2)}\n`,
  );
  return files;
}

/** Vite plugin: prune non-runtime models from the build output. */
export function modelsPlugin({ distDir } = {}) {
  let outDir;
  return {
    name: 'gev-models-prune',
    apply: 'build',
    configResolved(config) {
      outDir = distDir || config.build.outDir;
    },
    closeBundle() {
      if (process.env.GEV_KEEP_ALL_MODELS === '1') return;
      const result = pruneModels(path.resolve(root, outDir));
      if (result.removed)
        console.log(
          `[models] pruned ${result.removed} non-runtime entr${result.removed === 1 ? 'y' : 'ies'} ` +
            `(${(result.bytesRemoved / 1048576).toFixed(1)} MB), kept ${result.kept}`,
        );
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const syncIndex = args.indexOf('--sync');
  if (syncIndex !== -1) {
    const target = args[syncIndex + 1];
    if (!target) throw new Error('--sync requires a target directory');
    const files = syncModels(path.resolve(target));
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    console.log(
      JSON.stringify({ target: path.resolve(target), files: files.length, bytes: total }, null, 1),
    );
  } else {
    const models = path.join(root, 'public/models');
    console.log(
      JSON.stringify(
        RUNTIME_MODEL_FILES.map((name) => ({
          name,
          bytes: existsSync(path.join(models, name)) ? statSync(path.join(models, name)).size : null,
        })),
        null,
        1,
      ),
    );
  }
}
