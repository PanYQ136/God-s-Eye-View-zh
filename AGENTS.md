# 上帝之眼 · Hermes 工作硬性规则（2026-10-29 更新）

## 1. 浏览器与 GPU

- 浏览器不限：Chrome / Edge / Firefox / Safari / Ego Lite 均可；
- **默认只调用渲染性能最强的 GPU：NVIDIA GeForce RTX 3060**（含 Laptop GPU）；Intel UHD/Iris、AMD、SwiftShader、llvmpipe、Software Rasterizer 一律**无效**；
- 浏览器必须默认选中 3060：Windows 图形设置 + NVIDIA 控制面板 + 浏览器硬件加速/高性能参数；
- 验收必须确认 renderer 明确是 `NVIDIA GeForce RTX 3060`；不是 3060 立即 blocked；
- 若浏览器实际是 Intel/AMD/软件渲染，必须先切换到 3060（Windows 图形设置 / NVIDIA 控制面板 / 浏览器高性能），否则任务 blocked；
- `powerPreference:'high-performance'` 必须请求，但**不以请求代替实际 renderer**；
- 不符合 3060 的旧截图/旧报告全部作废；
- 交互必须真实鼠标/键盘，禁止 `element.click()` / `__gevLc.open()` 旁路。

### FPS 指标（2026-10-29 放宽）

- **可接受区间：50–60fps**；不再强制锁 60 / p95 ≤16.7ms；
- 连续 8s 采样：平均 **≥50fps 且 ≤60fps**；
- 不允许长时间冻结（单帧 >100ms）或掉到 30fps 以下；
- 目标仍是接近 60；50–60 内可接受；
- **不允许用降级玻璃/关折射/砍采样换 FPS**；
- 如果低于 50，先优化 shader/采样/合成，不是砍效果。

## 2. 液态玻璃标准

- 目标：**接近/复刻 Apple Liquid Glass**；
- 必须保留边缘折射、透镜感、镜面高光、透明中心；
- **不允许降级**：不能通过关掉折射、降低 `gain/dispPx`、关闭 edge-lens、减少面数来换 FPS；
- FPS 不够时优化 shader/采样，不是砍掉玻璃；
- 中心透明，不许磨砂、暗底、全屏 blur；
- 不允许彩虹色带、锯齿大色带、灰圈。

## 3. 一层玻璃

- **每张卡只有一层玻璃**：卡壳 + 单层边缘折射；
- 禁止玻璃叠玻璃：内层不得再有 `backdrop-filter` / 半透明填充 / 第二层 edge-lens / 第二圈高光/描边；
- 不允许 `.panel-inner`、`.dock-popover-content`、按钮、tray 各自再画一层玻璃；
- 卡与卡之间也不允许互相叠加玻璃效果。

## 4. 架构

- 唯一 worktree：`D:\Hermes\gods-eye-view`；
- `src/lc` 分层必须清晰：
  - Controller 状态
  - Layout 纯几何
  - Renderer 单帧
  - Interaction 真实输入
  - CollapsePort 唯一 `.collapsed` 写入
  - AppAdapter App 唯一触点
  - Material/Glass 单层材质
- 代码简洁高效：无旧补丁、无 `!important` 战争、无重复定时器、无旧 App 控件；
- 旧 `src/gev-liquid-cards.js`、旧 CSS、`lg-glass.css`、旧 `gev-panel-win` 逻辑必须 0 引用。

## 5. 审计

- 每次 review 必须用真实浏览器截图 + 真实点击；
- 至少检查：初始、7 卡展开、互斥、dock、快速连点、收起、8x 边缘；
- 检查 GPU renderer、FPS、`gain/dispPx`、一层玻璃、无双灰圈；
- 失败项必须保留，不能隐藏；
- 不接受“自测通过”当最终验收。

## 6. 工作路径

每次工作先规划：基线只读 → P0/P1 分级 → 明确写入范围 → 串行执行 → 每阶段真实浏览器验收 → 最后 Gate。

禁止并行改同一文件；同一问题 2 轮不过就拆小，不硬堆。

## 7. 时间 / token 预算

- 单点修复：20–30 分钟；模块改造：30–45 分钟；硬停 60 分钟；
- 到硬停：停止改代码，交 checkpoint（结果 + 失败 + 下一步），不许硬堆；
- 每轮只改一个变量，只截变化区域；
- 开发中只跑 `scripts/lc/_smoke.mjs` + 3–5 条断言，不每轮跑全量矩阵/5100 单测/整页截图；
- 浏览器复用：一个 server、一个 page、批量点击，不每轮重开 Cesium；
- 报告只交：状态、改动文件/行、参数、1–3 个截图、失败列表、下一步；
- 同一问题 2 轮不过 → 拆任务；
- 详见 `D:\Hermes\docs\Hermes-工作流优化-20261029.md`。

## 8. 视觉检测（强制，不可糊弄）

- 视觉类改动必须同时交 **1x 全图 + 4x/8x 目标裁剪**；
- 截图必须来自真实浏览器 + 硬件 RTX 3060，窗口可见聚焦；
- 必须用视觉模型/vision 复核（`vision-fallback` 或 `image-vision-understanding`）：
  - 描述玻璃/色散/高光/文字/重叠/灰圈是否真的可见；
  - 禁止只看 JSON/数值就写 PASS；
- 每批报告写：截图路径 + vision 结论 + 指标；
- 指标 PASS 但 vision 说“看不到” → 判 FAIL；
- 最终 Gate 必须独立视觉复核，不许只信实现方自述。
