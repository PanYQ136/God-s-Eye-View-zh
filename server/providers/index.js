/**
 * Provider 兼容再导出面（问题清单 #18 · Phase8E）
 *
 * 历史原因：`vite.config.js` 除了默认导出 Vite 配置，还 `export * from
 * './server/providers/local.js'`，把一批运行时代码（provider 中间件、HTTP 工具、
 * 缓存键）混进了「配置文件」的角色里。测试与工具因此习惯 `import { x } from
 * '../../vite.config.js'`，配置文件于是没法只当配置用。
 *
 * 现在只有这一层做再导出：
 *   - `vite.config.js` → 仅 `export { default }`（单一职责：给 Vite 读配置）；
 *   - 需要 provider 内部实现（测试/工具）→ `import { … } from
 *     'server/providers/index.js'`。
 *
 * 新代码请直接从具体 provider 模块导入；本文件只为存量调用点保留稳定名字。
 */
export * from './local.js';
