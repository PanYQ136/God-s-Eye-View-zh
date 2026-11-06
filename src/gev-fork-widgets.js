// fork 自包含 widget 装载入口（上游架构下的独立装载点）。
// 原由 bootstrap.js 装载的 boot-defer 小部件（CN 天气胶囊/健康面板/
// dossier/perf/graphics/panel-win/mobile-ui/layer-limits）改由此文件装载；
// 删除 index.html 里对应 script 行 + 本文件即回滚。
import './boot-defer.js';
