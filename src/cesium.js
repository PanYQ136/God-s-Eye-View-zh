/**
 * Cesium 单一出口（问题清单 #14 · Phase8E）
 *
 * 全仓只有本文件允许直连 npm 包 `cesium`；其余模块一律
 *
 *     import { Cesium } from '../cesium.js';
 *
 * 为什么不再 `import * as Cesium from 'cesium'`：
 *   - 构建期 vite-plugin-cesium 用 rollup `external: ['cesium']` +
 *     `externalGlobals({ cesium: 'Cesium' })`，把包引用换成全局 `window.Cesium`。
 *     单个出口模块把「包名 ↔ 全局」的映射收成一处，升级 Cesium 或改注入方式
 *     （ESM/global/子集 build）只改这一行；
 *   - 出口同时是唯一的可测试接缝：node:test 里想替换 Cesium 只需替换本模块；
 *   - 让 `scripts/check-import-directions.mjs` 能用一条规则守住边界
 *     （默认 warn，`--strict-cesium` 或 `GEV_CESIUM_SINGLE_ENTRY=error` 升级为 error）。
 *
 * 本地变量必须避开 `Cesium` 本身：建置期 externalGlobals 会把命名空间导入的
 * 引用整体改写成全局名 `Cesium`，若这里也写 `export const Cesium = …` 就会
 * 自引用（`const Cesium = Cesium`）并报 "Cesium is not exported"。故用
 * `cesiumNamespace` → `cesium` → `export { cesium as Cesium }`。
 *
 * 行为不变：导出的是与裸导入完全相同的 Cesium 命名空间对象，
 * 调用方 `Cesium.Cartesian3` 等写法一字不改。
 *
 * 回滚：删除本文件 + `git checkout -- src` 即恢复 198 处直连。
 */
import * as cesiumNamespace from 'cesium';

/** Cesium 命名空间（dev 为 npm 包 ESM，build 为注入的全局 `Cesium`）。 */
const cesium = cesiumNamespace;

export { cesium as Cesium };
export default cesium;
