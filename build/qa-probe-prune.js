/**
 * 构建时剥离 QA 探针页。
 *
 * 背景：`public/_fps-probe{,2,3}.html` 是给 `scripts/lc/_diag/*` 在 dev(4173)
 * 下做帧率/画布诊断用的临时页，却被 Vite 原样拷进 dist，线上可直接访问
 * （实测 https://gods-eye-pro.vercel.app/_fps-probe.html 返回 200）。
 *
 * 取舍：不删 public/ 下的源文件 —— 4 个 diag 脚本仍以 URL 形式引用它们，
 * 删源会让 dev 诊断失效。只在构建收尾从产物里移除。
 *
 * 回滚：删掉 `build/vite.js` 里 `qaProbePrunePlugin()` 一项
 * （或设 `GEV_KEEP_QA_PROBES=1`）即恢复「探针页进 dist」。
 */
import fs from 'node:fs';
import path from 'node:path';

const PROBE_RE = /^_fps-probe\d*\.html$/;

export function qaProbePrunePlugin({ distDir } = {}) {
  let outDir;
  return {
    name: 'gev-qa-probe-prune',
    apply: 'build',
    configResolved(config) {
      outDir = distDir || config.build.outDir;
    },
    closeBundle() {
      if (process.env.GEV_KEEP_QA_PROBES === '1') return;
      const dir = path.resolve(outDir);
      let removed = 0;
      let names = [];
      for (const name of fs.readdirSync(dir)) {
        if (!PROBE_RE.test(name)) continue;
        try {
          fs.rmSync(path.join(dir, name));
          removed += 1;
          names.push(name);
        } catch (err) {
          console.warn(`[qa-probe] failed to remove ${name}: ${err.message}`);
        }
      }
      if (removed) console.log(`[qa-probe] pruned ${removed} probe page(s): ${names.join(', ')}`);
    },
  };
}
