/**
 * scripts/check-window-globals.mjs —— Phase8D · 问题清单 #15 的机器判据
 *
 * 三条规则（任一违反 → 退出码 1）：
 *   R1 已迁移的名字（`src/bridge.js` 槽位化）**不许**再在 src/ 里直接读写 `window.__*`；
 *     兼容面由 bridge 的 getter/setter 提供，测试仪器照旧能读。
 *   R2 `src/**` 出现的任何 `window.__*` 必须在下方 LEGACY_WHITELIST 里（带保留理由）。
 *      新增一个全局名字会被这里拦下 —— 想加就先想清楚为什么不走 bridge。
 *   R3 `src/ui.js` 是 @deprecated 兼容入口：除 `src/standalone/**`、测试与自身外，
 *      不许新增 import。
 *
 * 用法：
 *   node scripts/check-window-globals.mjs            # 判据模式（CI / gate）
 *   node scripts/check-window-globals.mjs --report   # 打印名字清单（写报告用）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** 已收进 bridge 的名字：全局名 → 槽位名 */
const MIGRATED = {
  __lc: 'lc',
  __lcBooted: 'lc.booted',
  __lcPanelApi: 'app.panelApi',
  __lcExternalDisclosure: 'ui.externalDisclosure',
  __gevEdge: 'edge.lens',
  __gevEdgeLens: 'edge.lensState',
  __gevGpu: 'gpu',
  __gevBoot: 'boot',
};

/**
 * 保留的窗口全局：名字 → 理由。这些不是「还没做」，而是**不该进 bridge**：
 * - 诊断/验收开关：由人或其他脚本读，写方只有一处；
 * - 第三方或平台约定名：Cesium / Google Maps 的既有全局；
 * - classic script 的仪器通道：同帧写入+读取，桥加一层没有收益。
 */
const LEGACY_WHITELIST = {
  __gevViewer: 'Cesium Viewer 句柄：main 里创建，多处只读；公开调试约定（gate 脚本按名字取）',
  __godsEyeView: '应用调试聚合对象（src/app/tools.js 唯一写方），gate/人工调试读',
  __GOOGLE_MAPS_API_KEY__: 'Google Maps SDK 约定全局（scene.js 临时设置并在 finally 还原）',
  __CESIUM__: 'Cesium 命名空间约定全局',
  __GEV_GL_PRESERVE: '启动早期（lens 之前）由 HTML/内联脚本置位的只读开关',
  __GEV_ENRICH_AMBIENT_QA: 'QA 开关（URL 参数驱动），只读',
  __gevGizmoDebug: 'QA 追踪开关，只读',
  __gevAnnotations: '标注引擎句柄（人工调试用）',
  __gevDrawTool: '绘制工具句柄（人工调试用）',
  __gevCine: '电影运镜诊断对象（gev-autolocate 唯一写方，boot-gate 读）',
  __gevQaRegisterLayer: 'QA 层注册钩子（数据层脚本 ↔ 测试）',
  __gevQaUnregisterLayer: 'QA 层注销钩子',
  __gevLayerLimits: '图层上限诊断对象',
  __gevVoiceCommands: '语音指令句柄（调试/测试）',
  __bootTimeline: '启动时间线（gate 判据读取：gate:base:ready 等）',
  __gevRecentImagery: '近期影像句柄（工具层）',
  __gevWorldOverlay: '世界覆盖层句柄（调试）',
  __gevBaseTiles: '底图瓦片句柄（诊断）',
  __gevTileWarm: '瓦片预热状态（诊断）',
  __gevPanelWin: '面板窗口诊断状态',
  __gevMobileUI: '移动端 UI 诊断状态',
  __gevDossier: '档案卡面板句柄（人工调试）',
  __gevCn: '中文 UI 词表句柄（调试）',
  __gevContextStore: '上下文存储句柄（调试）',
  __gevGFX: '图形开关句柄（诊断）',
  __gevPhotoreal: '写实升级诊断状态（src/app/photorealUpgrade.js 文档 + 写方）',
  __gevShaderCache: '着色器缓存统计（诊断）',
  __gevEdgeGrab: '验收仪器通道：gate 脚本写、lens 同帧读（跨脚本一帧内往返，桥无收益）',
  __gevEdgeGrabOut: '验收仪器通道：lens 写、gate 脚本读',
  __gevStartupRevealed:
    '启动握手标志（D5）：startupChrome 写、data/geoid.js 读，决定 EGM96 是否等遮罩；单写多读的启动期一次性开关',
  __gevCnHealth: '中文健康面板句柄（gev-cn-health.js 幂等守卫 + 人工调试），无其他模块消费',
  __gevCnWeather: '中文天气面板句柄（gev-cn-weather.js 幂等守卫 + 人工调试），无其他模块消费',
  __gevGeoImport: '地理文件导入 handle：geoFileImport.js 唯一写方，测试与人工调试读（用例断言存在/清理）',
};

const CODE = /\.[mc]?js$/;

function listSources(root) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  })
    .toString('utf8')
    .split('\0')
    .filter((f) => f && CODE.test(f));
}

/** 去掉注释，避免文档里的 `window.__x` 触发误报。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const USE = /window\s*\.\s*(__[A-Za-z0-9_]+)/g;

export function checkWindowGlobals(root, { report = false } = {}) {
  const files = listSources(root);
  const violations = [];
  const seen = new Map(); // name → Set(file)

  for (const file of files) {
    /* bridge.js 是总线本身；bridge.test.mjs 专门测兼容面（它必须能直接读写 window.__*） */
    if (file === 'src/bridge.js' || file.endsWith('.test.mjs')) continue;
    const raw = readFileSync(path.join(root, file), 'utf8');
    const code = stripComments(raw);
    for (const m of code.matchAll(USE)) {
      const name = m[1];
      if (!seen.has(name)) seen.set(name, new Set());
      seen.get(name).add(file);
      if (Object.hasOwn(MIGRATED, name)) {
        violations.push(`R1 ${file}: window.${name} 已迁移到 bridge('${MIGRATED[name]}')，不许直接读写`);
      } else if (!Object.hasOwn(LEGACY_WHITELIST, name)) {
        violations.push(`R2 ${file}: window.${name} 不在白名单 —— 走 src/bridge.js 注册，或补一条保留理由`);
      }
    }
  }

  /* R3：src/ui.js 是 @deprecated 兼容入口 */
  const ALLOW_UI_JS = (from) =>  // eslint-disable-line no-unused-vars
    from === 'src/ui.js' || from.startsWith('src/standalone/') || from.endsWith('.test.mjs') || from.startsWith('src/testSupport/');
  for (const file of files) {
    if (ALLOW_UI_JS(file)) continue;
    const code = stripComments(readFileSync(path.join(root, file), 'utf8'));
    if (/(?:from|import)\s*['"][^'"]*\bui\.js['"]/.test(code)) {
      violations.push(`R3 ${file}: 引用了 @deprecated 的 src/ui.js 兼容入口`);
    }
  }

  const inventory = [...seen.entries()]
    .map(([name, where]) => ({ name, files: [...where].sort(), migrated: Object.hasOwn(MIGRATED, name), kept: Object.hasOwn(LEGACY_WHITELIST, name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (report) {
    console.log(JSON.stringify({ scanned: files.length, names: inventory.length, inventory }, null, 2));
  }
  return { ok: violations.length === 0, violations, inventory, scanned: files.length };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('check-window-globals.mjs')) {
  const report = process.argv.includes('--report');
  const r = checkWindowGlobals(path.resolve('.'), { report });
  if (!report) {
    console.log(`check-window-globals: ${r.scanned} 个 src 文件，${r.inventory.length} 个 window.__* 名字`);
    for (const v of r.violations) console.error('  ✗', v);
    console.log(r.ok ? '  ✓ 全部通过（已迁移名字 0 处直连；其余均有保留理由；无新增 ui.js 引用）' : `  ✗ ${r.violations.length} 条违规`);
  }
  process.exit(r.ok ? 0 : 1);
}
