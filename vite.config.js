/**
 * Vite 配置入口（问题清单 #18 · Phase8E）
 *
 * 单一职责：只把默认配置交给 Vite。历史上这里还 `export * from
 * './server/providers/local.js'`，把 provider 运行时代码再导出给测试，导致
 * 「配置文件」与「provider 聚合模块」两个角色混在一个文件里。
 *
 * 再导出已移到 `server/providers/index.js`；需要 provider 实现的工具/测试改从
 * 那里导入。回滚：把 `export *` 那行加回来，并删除 server/providers/index.js。
 */
export { default } from './server/standalone/vite.config.js';
