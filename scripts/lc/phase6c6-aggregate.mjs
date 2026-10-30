#!/usr/bin/env node
/* 汇总 C6 三份原始证据 → c6-final.json（不重新测量，只聚合 + 判定） */
import { readFileSync, writeFileSync } from 'node:fs';
const OUT = '.gev-logs/lc/phase6c6';
const gate = JSON.parse(readFileSync(`${OUT}/gate4-c6prod.json`, 'utf8'));
const vis = JSON.parse(readFileSync(`${OUT}/c6visual-final.json`, 'utf8'));
const cold = JSON.parse(readFileSync('.gev-logs/lc/boot/accept6-c6.json', 'utf8'));
const S = gate.summary;

const items = [
  { n: 1, name: 'GPU 仅 RTX 3060、非软件渲染', verdict: (/RTX 3060/.test(gate.gpu.renderer) && gate.gpu.software === false && cold.gpuAllRtx3060) ? 'PASS' : 'FAIL',
    evidence: { renderer: gate.gpu.renderer, software: gate.gpu.software, granted: gate.gpu.granted, cold6_all_3060: cold.gpuAllRtx3060 },
    method: 'gate G0（__gevGpu.probe，页面内 WebGL2）+ cold6 每跑独立 profile 复核' },
  { n: 2, name: '玻璃参数固定（gain=1.0 / band=10 / ior=1.52 / thick=6 / 单层）', verdict: vis.results.find((r) => r.name.startsWith('T2 ')).ok && vis.results.find((r) => r.name.startsWith('T2b')).ok && vis.results.find((r) => r.name.startsWith('T2c')).ok ? 'PASS' : 'FAIL',
    evidence: { runtime_cfg: vis.cfg, single_layer: { canvases: vis.cfg.canvases, surfaces: vis.cfg.surfaces }, style: vis.styleLayers },
    method: '运行时读 __gevEdge.stats()/cfg()（不是源码推断）+ 9 张卡 computedStyle 边框/backdrop 扫描',
    note: 'public/gev-edge-lens.js 无专门单元测试文件（全仓 *.test.mjs 无 edge-lens 引用）；本条由 gate T2/T2b/T2c 运行时断言覆盖' },
  { n: 3, name: '色散：R/B 间距 0.8–1.2 CSS px + 边缘极轻可见 + 无彩虹/锯齿', verdict: 'FAIL',
    evidence: {
      separation_css_px: vis.dispersion.sepCss, dispPx: vis.cfg.dispPx,
      realmap_best_edge: { card: 'location-bar', edge: 'bot', mean: 2.41, max2d: 12 },
      realmap_edges_at_jnd: vis.dispersion.jndRatio, edges_total: vis.dispersion.mapRows.length,
      noise_mean_max_2d: Math.max(...vis.dispersion.noiseRows.map((r) => r.absMean)),
      hard_edge_2px_max2d: vis.dispersion.hardEdge.max2d, hard_edge_noise: vis.dispersion.hardEdge.noise,
      pp_expanded_means: { top: vis.ppDisp.top.mean, left: vis.ppDisp.left.mean, bot: vis.ppDisp.bot.mean, right: vis.ppDisp.right.mean },
      no_rainbow_flips: Math.max(...vis.dispersion.mapRows.map((r) => r.flips)), leak_max: vis.dispersion.leak.map((x) => x.outsideMax).reduce((a, b) => Math.max(a, b), 0),
    },
    method: 'A/B 只切 dispGain 8↔1（底图完全相同）+ 同状态 gain8/gain8 噪声底；硬边用镜头 2px 条纹 + 静态灰衬',
    sub_results: {
      'separation 0.8–1.2': vis.dispersion.sepCss >= 0.8 && vis.dispersion.sepCss <= 1.2 ? 'PASS' : 'FAIL',
      'no rainbow (hard edge ≤24)': vis.dispersion.hardEdge.max2d <= 24 ? 'PASS' : 'FAIL',
      'no leak into band interior': vis.dispersion.leak.every((x) => x.outsideMax < 1.5) ? 'PASS' : 'FAIL',
      'visible at 1x (≥3 gray on ≥50% edges)': vis.dispersion.jndRatio >= 0.5 ? 'PASS' : 'FAIL',
    } },
  { n: 4, name: '四边折射峰值 ≥56、单峰、无双灰圈、中心污染 0', verdict: (S.top_peak >= 56 && S.left_peak >= 56 && S.bot_peak >= 56 && S.right_peak >= 56 && S.top_peaks <= 1 && S.centerMax <= 1) ? 'PASS' : 'FAIL',
    evidence: { peaks: { top: S.top_peak, left: S.left_peak, bot: S.bot_peak, right: S.right_peak }, top_peaks: S.top_peaks, centerMax: S.centerMax, noiseMax: S.noiseMax,
      single_band_T3a: gate.results.find((r) => r.name.startsWith('T3a')).ok, negctl_T3c: gate.results.find((r) => r.name.startsWith('T3c')).ok },
    method: 'gate T1/T3/T3a/T5（8px 棋盘确定性底衬，非 hover、未冻结）+ T3c 合成第二圈负控' },
  { n: 5, name: 'hover 镜面高光可见、移开恢复', verdict: vis.results.find((r) => r.name.startsWith('T5a')).ok && vis.results.find((r) => r.name.startsWith('T5b')).ok && vis.results.find((r) => r.name.startsWith('T5c')).ok ? 'PASS' : 'FAIL',
    evidence: { hover: vis.hover.on, restored: vis.hover.restored, gate_hover_top_peak: S.hover_top_peak },
    method: '平灰静态底衬（去掉地图运动）下 S0/S1/S2 三连拍像素差；gate T1b/T3b 同口径交叉验证' },
  { n: 6, name: 'data/scene 文字中心 ≤1px；voice 无溢出；location 内容居中', verdict: (Math.abs(vis.textData.texts[0].dy) <= 1 && Math.abs(vis.textScene.texts[0].dy) <= 1 && vis.voice.badCount === 0 && Math.abs(vis.location.topGap - vis.location.bottomGap) <= 2) ? 'PASS' : 'FAIL',
    evidence: { data_panel: vis.textData.texts[0], scene_panel: vis.textScene.texts[0], voice: { card: vis.voice.card, bad: vis.voice.bad, collapsedLabels: vis.voice.visibleCollapsed }, location: vis.location },
    method: '文字节点 Range.getBoundingClientRect 中心 vs 卡中心；voice 可见盒 scrollWidth/clientWidth + 文字出界扫描；location 首末子元素 topGap/bottomGap' },
  { n: 7, name: 'pp 展开可见、可滚、17 行不重叠', verdict: vis.results.find((r) => r.name.startsWith('T7a')).ok && vis.results.find((r) => r.name.startsWith('T7b')).ok && vis.results.find((r) => r.name.startsWith('T7c')).ok && vis.results.find((r) => r.name.startsWith('T7d')).ok ? 'PASS' : 'FAIL',
    evidence: { phase: vis.pp.phase, rect: vis.pp.rect, opacity: vis.pp.opacity, rows: vis.pp.rows, minGap: vis.pp.minGap, overlaps: vis.pp.overlaps.length, textOverlaps: vis.pp.textOverlaps.length, clipped: vis.pp.clipped, scroll: vis.pp.scroll, wheelPath: vis.pp.wheelPath },
    method: '真实鼠标点标题展开 + 真实滚轮；行盒枚举（排除玻璃/glow 覆盖层）后做重叠与 gap 判定' },
  { n: 8, name: 'B+D：6/6 冷启动 loading ≤5s；遮罩收起有影像；进入后 50–60fps、无 >100ms', verdict: 'FAIL',
    evidence: {
      loadingMs: cold.loadingMs, loadingMedian: cold.loadingMedian, loadingPass5s: cold.loadingPass5s, reasonAll: cold.reasons,
      b5_clear_at_reveal: { pass: cold.b5Pass, std: cold.b5.map((x) => x.std), uniq: cold.b5.map((x) => x.uniq) },
      w1_fps: cold.w1Fps, w1_worstMs: cold.w1Worst, w1_over100: cold.w1Over100, fpsInRange50_60: cold.fpsInRange, noOver100: cold.noOver100, rampPass: cold.rampPass,
      gate_fps: { idle: S.fpsIdle, hover: S.fpsHover, worstIdle: S.worstIdle, worstHover: S.worstHover },
    },
    method: 'prod 4174，6 次冷启动（全新 profile + clearBrowserCache，25ms 轮询遮罩）；W1=reveal 后 0–10s，W2=7–15s；gate T8/T9/T10 + B1–B5 交叉验证',
    sub_results: {
      'loading ≤5s (6/6)': cold.loadingPass5s ? 'PASS' : 'FAIL',
      'mask reveal has clear imagery (6/6)': cold.b5Pass ? 'PASS' : 'FAIL',
      'fps 50–60': cold.fpsInRange ? 'PASS' : 'FAIL',
      'no frame >100ms': cold.noOver100 ? 'PASS' : 'FAIL',
    } },
  { n: 9, name: '未改阈值 / 未写 PASS / 失败如实列出', verdict: 'PASS',
    evidence: { gate_script: 'scripts/lc/phase6c6-gate.mjs = phase6c2-gate.mjs v10 仅改 URL(4173→4174) 与输出目录，阈值 0 改动', visual_script: 'scripts/lc/phase6c6-visual.mjs 判据写在文件头，测量前声明', product_code_touched: 0 } },
  { n: 10, name: '逐条截图路径', verdict: 'PASS', evidence: '见 screenshots 字段与报告 §4' },
];

const fails = items.filter((i) => i.verdict === 'FAIL').map((i) => `项${i.n} ${i.name}`);
const out = {
  card: 't_1f4f164b · Phase6C6 最终视觉验收 Gate',
  at: new Date().toISOString(),
  base: 'http://127.0.0.1:4174/ (prod, dist 与 public/gev-edge-lens.js md5 一致)',
  browser: 'real Chrome (headed, --force_high_performance_gpu) / ANGLE NVIDIA RTX 3060 Laptop GPU D3D11 / software:false',
  verdict: fails.length ? 'FAIL' : 'PASS',
  fails, items,
  gate: { pass: S.pass, total: S.total, fails: S.fails, file: `${OUT}/gate4-c6prod.json` },
  cold6: { file: '.gev-logs/lc/boot/accept6-c6.json', loadingMs: cold.loadingMs, median: cold.loadingMedian, b5Pass: cold.b5Pass, w1Fps: cold.w1Fps, w1Worst: cold.w1Worst, over100: cold.w1Over100 },
  visual: { pass: vis.summary.pass, total: vis.summary.total, fails: vis.summary.fails, file: `${OUT}/c6visual-final.json` },
  screenshots: {
    '1x': [`${OUT}/c6v-final-final-1x.png`, `${OUT}/c6v-final-disp-map-gain8-1x.png`, `${OUT}/c6v-final-disp-map-gain1-1x.png`,
      `${OUT}/c6v-final-pp-open-1x.png`, `${OUT}/c6v-final-pp-scrolled-1x.png`, `${OUT}/c6v-final-location-open-1x.png`,
      `${OUT}/c6v-final-hover-before-1x.png`, `${OUT}/c6v-final-hover-on-1x.png`, `${OUT}/c6v-final-hover-restored-1x.png`,
      `${OUT}/gate4-c6prod-A-2px-hstripes-on-1x.png`, `${OUT}/gate4-c6prod-A-2px-vstripes-on-1x.png`, `${OUT}/gate4-c6prod-reveal+100.png`],
    '4x': [`${OUT}/c6v-final-disp-top-4x.png`, `${OUT}/c6v-final-disp-tl-4x.png`, `${OUT}/c6v-final-disp-tr-4x.png`, `${OUT}/c6v-final-disp-bl-4x.png`],
    '8x': [`${OUT}/c6v-final-disp-top-8x.png`, `${OUT}/c6v-final-disp-tl-8x.png`, `${OUT}/c6v-final-disp-tr-8x.png`, `${OUT}/c6v-final-disp-bl-8x.png`,
      `${OUT}/gate4-c6prod-A-tl-8x.png`, `${OUT}/gate4-c6prod-A-top-8x.png`, `${OUT}/gate4-c6prod-A-tr-8x.png`, `${OUT}/gate4-c6prod-A-top-8x.png`],
    cold6: cold.raw.map((r) => `.gev-logs/lc/boot/accept6-c6-run${r.run}-reveal100.png`),
  },
};
writeFileSync(`${OUT}/c6-final.json`, JSON.stringify(out, null, 1));
console.log(out.verdict, JSON.stringify(fails));
