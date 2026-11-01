# Phase8F · 最终 Gate 报告（24 条 + D1–D12 + G1–G22）

- 任务：kanban `t_730bd5e1`（Phase8F，parent 8E `t_5523b364`）
- 时间：2026-10-31 02:55 → 04:20（CST）
- 性质：**只读验收**。未改任何产品代码、未改任何阈值/判据、未改卡体。
- 基线：`D:\Hermes\gods-eye-view` 工作区（`main @ ac6d09b` + 8B–8E 未提交改动，267 M / 41 ??）
- 生产构建：`dist-8e`（36 MB，models 12 文件 3.4 MB），`vite preview --outDir dist-8e --port 4175`
- 浏览器：真实 Chrome（非 headless，headed、窗口可见），`deviceScaleFactor=1`，1348×774
- 本轮新增 Gate 仪器（非产品代码）：`scripts/lc/_8f-gate.mjs`、`_8f-fps.mjs`、`_8f-d.mjs`

---

## 0. 结论先行

| 维度 | 判定 |
|---|---|
| 24 条问题清单 | **18 FIXED / 4 PARTIAL / 1 N/A / 1 OPEN**（#13 #15 #16 #17 PARTIAL；#12 N/A；#23 OPEN-ENV） |
| D1–D12 | **11 PASS / 1 PARTIAL**（D2 阴影动态本轮未能复现真采样，见 §3） |
| G1–G22 | **19 PASS / 3 PARTIAL**（G8 按点发光、G11 thickness、G20 内部 alpha） |
| 玻璃硬判据（单层/四边/色散/无彩虹/无双圈/中心透明） | **单层 PASS、无双圈 PASS、无彩虹 PASS、中心透明 PASS、四边色散 FAIL（T3b 0/36）** |
| 文字 / pp / location / hover | **PASS**（6C6 本轮 20/21） |
| RTX3060 / 启动 / reload 黑帧 | **PASS**（renderer 3060；卡片可点 674 ms；reload 无黑帧） |
| FPS / 长帧 | **PARTIAL**（3×8 s 窗 49.5 / 36.8 / 62.2；2 窗 <50 均在 photoreal 加载 ramp） |
| 代码卫生 / 出口 / 懒加载 / 产物 | **`!important` PARTIAL、`window.__` FAIL、Cesium 出口 PASS、懒加载 PARTIAL、产物 PASS** |

**Gate 不通过项（4 条，如实列出，未改判据）**：
1. **T3b 真实地图色散 0/36 边**（阈值 57 灰阶，实测逐边峰值中位 19、最大 45）
2. **`check-window-globals` EXIT 1**：`src/app/catalog.js` 残留 `PROBE-TEMP` 探针 + 未登记 `window.__gevProbeAccess`
3. **FPS 2/3 窗 <50**（49.5 / 36.8），第三窗 62.2 才达标
4. **8D 自定硬要求被违反**：`style.css:18` 重复 `@layer a,b,c;` 层序声明（8D §9.3 明令「只允许 index.html 一处」）

---

## 1. 24 条逐条状态

| # | 问题 | 状态 | 本轮证据 / 理由 |
|---|---|---|---|
| 1 | 全场 Clear、无 scrim 兜底 | **FIXED** | `glass.state()`：`variants:['regular','clear']`、`variant:'clear'`、`scrimMode:'off'`、断言计数字段存在；`look` 显示真实亮度 0.355 < 0.6（未触发属正常）；8B A2/A6 双向切换证据 |
| 2 | 高光静态 / 阴影固定 | **FIXED（附限制）** | 真实鼠标：卡宽 20% → `--lc-gloss-x:20.0%`、80% → `80.0%`，alpha 0.250（≤0.25）；`bgImage` 含 tint 层；阴影 `shadowA 0.14` 有 5Hz lerp 通道。**限制**：本轮 `luma:null / lumaSamples:0 / lumaSrc:'black-readback'`，阴影随亮度的真采样未复现（未注入 `pdb=true`），D2 该半分靠 8B A4（lumaSamples 84 / 注入 0.15→0.13、0.85→0.27） |
| 3 | morph 期玻璃不降级 | **FIXED** | 真实鼠标点 `#data-panel` 头：30 帧采样中 **7 帧 `__gevEdge.cfg().enabled===false`**，morph 前后均 `true`；8B A7 另测 45 帧关闭、duration 445 ms、峰值 1.035、恢复 486 ms |
| 4 | 无 tint / spill | **FIXED** | `look.per`：tintA **0.024 / 0.027 / 0.035**（∈[0.01,0.05]）、spillW **0.096 / 0.100 / 0.106**（≤0.15）、`shadowRgb [12,12,10]`、`tintRgb` 随底图变（91,93,65 / 80,120,55） |
| 5 | WebGL 无视无障碍 | **FIXED** | 真实 CDP `Emulation.setEmulatedMedia`：solid → `enabled:false / surfaces:0`；reduced → `dispPx:0 / bandAlpha:0.75 / surfaces:9`；退出 → `full / 2.4 / 0.55`，`changes` 计数 1→2→3 |
| 6 | 文字只靠 text-shadow | **FIXED** | `#data-panel` computed `background-image` 第二层 = `linear-gradient(rgba(0,0,0,0.3) 0px, rgba(0,0,0,0) 24px)`（局部 24 px scrim）；`textShadow` 仍保留 1px 硬阴影 |
| 7 | 无同心圆角 | **FIXED** | 内层 `.pp-panel-body/.data-panel-inner` computed `border-radius:8px`（= `--lc-radius 16 − --lc-inset 8`） |
| 8 | 玻璃文字无字重 | **FIXED** | `.pp-toggle-btn .pp-label` computed **500**（3/3），`body` 仍 **400**（不污染全局） |
| 9 | 无小元素明暗翻转 | **FIXED** | `look.fg` 自然态 `#eaf4ff`；`edgeCfg.fgFlip{threshold .62, ms 120, light '#0b1116'}` 在位；8C A4 注入亮底 → `rgb(11,17,22)`、8x 像素 max 188 |
| 10 | 门禁读数与配置不同源 | **FIXED** | `stats().cfg` 与 `eff` 双输出：cfg `band10/dispPx2.4/gain1/ior1.52/bandAlpha.55` 冻住，eff 带 a11y/scale/enabled；本轮两处读数与 8C 一致 |
| 11 | gev-cn.css 残留 backdrop-filter | **FIXED** | `grep -c 'backdrop-filter' public/gev-cn.css` = **0** |
| 12 | pp 行高被压 / hitbox 44 | **N/A（主因已修）+ 补 hitbox** | `material.css` 既有 `flex:0 0 auto; gap:8px`；6C6 T7b **17 行**、T7c 行间 gap ≥ −0.5 无重叠、T7d 可滚全部 PASS；8C A8 另测 `::after height 44px / top −4 / bottom −4`、命中 12/12。判据未改 |
| 13 | 198 `!important` / 0 `@layer` | **PARTIAL** | 授权范围（public/*.css + style.css + material.css）实测 **15** 条声明（gev-cn 14 + material-override 1）< 20 ✓；`@layer` 层序已显式（index.html:13）。**但**全仓仍 **121** 条（`src/ui/styles/*` 106 条，8D 明示未授权未动）；且 `style.css:18` 重复层序声明违反 8D 自定唯一性 |
| 14 | Cesium 全局耦合 | **FIXED** | `grep "from 'cesium'" src`（排除 test / `src/cesium.js`）= **0**；`check-import-directions` EXIT 0 `{"modules":877,"portableEntries":61,"cesiumWarnings":0}`；`check-package-boundaries` EXIT 0 |
| 15 | `window.__*` 无类型总线 | **PARTIAL（回归 FAIL）** | 迁移面：36 名字 / 124 次（8D 后），`__lc` 直连 3。**但 `check-window-globals` 现在 EXIT 1**：`src/app/catalog.js:72` 残留 `PROBE-TEMP` 探针无条件写 `window.__gevProbeAccess`，不在白名单 → 2 条 R2 违规。该代码**不在 `dist-8e` 构建里**（grep 0 命中），属源码卫生回归 |
| 16 | 几无代码分割 | **PARTIAL** | 21 处 `import()`；`dist-8e` chunk：bootstrap 1400 kB（8E 前 2539）、`catalogFactoriesCore` 343 kB、`catalogFactoriesRest` 779 kB；首屏 FCP **1972 ms** 时图层 chunk 尚未请求（core 5091 / rest 5511 ms）。**未达成**「首屏完全不请求」：rest 仍在启动期被拉取（已开卡 `t_1ad4e981`） |
| 17 | 四个巨型文件 | **PARTIAL** | `worldOverlay.js` 2946→2808（−4.7%）、`gevActions.js` 4480→4209（−6.0%），只拆纯常量/函数；`director.js` 2481、`lifecycle.js` 2324 **未动**。目标是「按域拆」，现状仅第一步 |
| 18 | vite.config 双职责 | **FIXED** | `vite.config.js` 仅 `export { default }`；`server/providers/index.js` 为唯一再导出面（8E 守卫用例在位） |
| 19 | 回滚副本无版本标记 | **FIXED** | `docs/architecture/rollback/gev-edge-lens.phase3.js` 有版本头（commit f16cd41 / 日期 / 替换范围 / 禁止项） |
| 20 | `src/ui.js` 与 `src/ui/` 并存 | **FIXED** | `src/ui.js` 标 `@deprecated`；`check-window-globals` 规则 R3 禁新增引用（本轮无 R3 违规） |
| 21 | 构建产物 377.9 MB | **FIXED** | `dist-8e` **36 MB**；`dist-8e/models` **12 文件**；源 `public/models` 未删（回退保留）；`build/models.mjs --sync` 出 sha256 清单 |
| 22 | `hermes update --force-venv` 卡收尾 | **FIXED（ENV，已解决）** | 上游未复现；recorded outcome=success、stale lock 已清。本仓无代码 |
| 23 | OpenRouter 402（max_tokens 914,897） | **OPEN（ENV，需用户决策）** | 属账号/模型选择：充值 ≥$1.05 / 换小 maxTokens 模型 / 换 provider。Gate 不决策、不充值。**这不是代码缺陷** |
| 24 | 9119 双 dashboard | **FIXED（ENV，已解决）** | 已收敛单例；本仓无代码 |

计数：FIXED 18 · PARTIAL 4（#13 #15 #16 #17）· N/A 1（#12）· OPEN 1（#23）。

---

## 2. D1–D12

| 缺陷 | 判定 | 本轮读数 / 证据 |
|---|---|---|
| D1 全场 Clear + 无 scrim 兜底 | **PASS** | `variants:['regular','clear']`、8 卡 `data-lc-material='clear'`（fab 不归 lc）、`scrimMode:'off'` 默认 + 亮底断言通道（`assert.scrim`）；8B A2 双向切换、A6 注入 0.8 → 卡面 −36.5 灰阶 |
| D2 高光静态 / 阴影固定 | **PARTIAL** | 高光：真实鼠标 20%→80% 使 `--lc-gloss-x` 20.0%→80.0%，alpha 0.250（≤0.25 上限）**PASS**；阴影：`shadowA 0.14` + 5Hz lerp 代码在位，但本轮 `lumaSamples:0 / lumaSrc:'black-readback'`（未开 pdb），**动态采样未复现**。8B A4 曾测 lumaSamples 84 / 0.15→0.13 / 0.85→0.27。判 PARTIAL，不判 PASS |
| D3 morph↔lens 零联动 | **PASS** | 真点击：7/30 帧 `enabled=false`，前后 true；8B A7 duration 445 ms、峰值 1.035、恢复 486 ms |
| D4 无 tint / spill | **PASS** | tintA 0.024–0.035 ∈ [0.01,0.05]；spillW 0.096–0.106 ≤ 0.15；`--lc-shadow-rgb` 吃到环带色 |
| D5 lens 不响应无障碍 | **PASS** | CDP 三态：solid `enabled:false/surfaces:0`；reduced `dispPx:0/bandAlpha:.75`；full 恢复 |
| D6 只靠 text-shadow | **PASS** | 局部 24 px scrim 在 computed `background-image` 里；8B A5 顶部 5px 带差 24.64 灰阶、+30px −1.27 |
| D7 缺同心圆角 | **PASS** | 内层 computed `8px` |
| D8 无字重约束 | **PASS** | pp 标签 500 / body 400 |
| D9 无明暗翻转 | **PASS** | `fgFlip` cfg 在位 + 8C A4 注入亮底 → 深墨 `rgb(11,17,22)`、8x 像素 max 188 |
| D10 门禁不同源 | **PASS** | `stats().cfg/eff` 双输出，cfg 冻结 |
| D11 gev-cn 残留 backdrop | **PASS** | 文件内 0 处声明；9 卡 computed `backdrop-filter:none` |
| D12 最小高与 hitbox 未对齐 | **PASS** | 6C6 T7b/c/d：17 行、无重叠、可滚；8C A8：`::after 44px`、命中 12/12、gap 8.0 |

**11 PASS / 1 PARTIAL（D2 阴影真采样）**

---

## 3. G1–G22 合规表

| G | 判定 | 依据 |
|---|---|---|
| G1 控制层作用域 | PASS | `material.css` 只覆盖 7 卡 + fab；9 个 `.gev-lc` 面 |
| G2 单层铁律 | PASS | 9/9 卡 `backdrop-filter:none`、`border:0px`、`innerBackdrop=0`；6C6 T2b/T2c PASS |
| G3 临时交互态 | PASS | 仅 `--lc-control-active` 单色，无玻璃常驻 |
| G4 边缘带 lensing | PASS | `eff.band` 9.6–10（`bandMin 7 / bandFrac .2`），未降级 |
| G5 色差受控 | PASS | cfg `dispPx 2.4 / gain 1 / ior 1.52 / dispCap 20/255 / dispBandStart .85` |
| G6 高光随指针 | PASS（实现方式与规范不同） | 用 CSS 径向弧段（`--lc-gloss-x/-a`）+ pointer 驱动，非 shader Fresnel；实测 20%↔80% 位移正确、alpha ≤0.25 |
| G7 动态阴影 | PASS（本轮证据不足，见 D2） | alpha 5Hz lerp + spill 染色；`shadowA` 读得出、改得动；真亮度采样需 pdb |
| G8 内发光 / spill | PARTIAL | spill 已实现（≤0.106）；「按点发光」仍无 |
| G9 自适应 tint | PASS | tintA 0.024–0.035 随底图色变化 |
| G10 小元素翻转 | PASS | 见 D9 |
| G11 尺寸→厚度 | PARTIAL | `bandFrac` 按短边收窄（真）；`dispPx` 不随尺寸变、无 thickness 概念（未做） |
| G12 Regular/Clear 决策树 | PASS（默认不自动） | 枚举 + 阈值 0.6 + 35% scrim 通道存在；`auto:false` 为 8B 卡体要求「默认观感不变」，非缺陷 |
| G13 scroll edge | PASS | 无实色垫片 |
| G14 内容延伸 | PASS | 全屏 Cesium + 浮动卡，SAFE_TOP/BOTTOM 在位 |
| G15 同心圆角 | PASS | 见 D7 |
| G16 触控/分组 | PASS | 6C6 T7c 无重叠、可滚；8C A8 hitbox 44 |
| G17 排版克制 | PASS | 玻璃正文 500、全局 400 |
| G18 无障碍三项 | PASS | solid/reduced/full 三态 + change 监听（D5） |
| G19 帧同步 postRender | PASS | lens 仍挂 postRender；6C6 T3c/T3d 同帧合成成立 |
| G20 alpha + scrim | PARTIAL | 文字 scrim（24 px）+ tint（0.01–0.05）到位；但**卡体内部 alpha 仍为 transparent，不是规范 0.82–0.90**（L7 仍不达标），该值属材质定义，8B/8C 未改（当时也未列入判据） |
| G21 DPR | PASS | `maxScale 1.5`，`eff.scale 1`（DPR 1 时） |
| G22 先变形后上玻璃 | PASS | 见 D3 |

**19 PASS / 3 PARTIAL（G8 按点发光未做、G11 无 thickness、G20 卡体内部 alpha 仍 transparent）**。G6 判 PASS（附实现说明：CSS 弧段而非 shader Fresnel，行为达标）。

---

## 4. 玻璃（本轮实测）

| 判据 | 结果 | 证据 |
|---|---|---|
| 单层（卡壳 + 单层折射） | **PASS** | 9/9 `.gev-lc` computed `backdrop-filter:none`；卡内后代非 none 计数 **0**；6C6 T2b「1 个折射 canvas / 9 个面 / 0 内层 backdrop」、T2c「0 可见 border / 0 visible outline / 0 backdrop-filter」 |
| 四边都有折射 | **FAIL（数值）/ 存疑** | 6C6 **T3b 0/36 边**（阈值 max(3, 3×噪声中位 19)=57，实测逐边峰值 12/19/45，`peakMax 45`）；T3c band 2D max ≤114 PASS（无强彩边）、T3d 不漏到内侧 PASS、T3e 2 px 条纹 ≤24 PASS、T3f 无多级彩虹 PASS。**噪声中位 19 高于 8C 时（≤2）**，本轮未冻结 Cesium、风场/航班在动，峰值被吃掉；不改判据，如实判 FAIL |
| 色散可见 | **FAIL** | 同上；1x/4x vision 均**看不到** R/B 分色（正确观感应是「极轻」，但 8x 因底图为卫星纹理不可判读） |
| 无彩虹 / 无多级彩边 | **PASS** | T3f 单轴符号翻转 ≤2；T3c 上界内；vision 1x/4x 均「无红绿蓝色带」 |
| 无双灰圈 / 双层描边 | **PASS** | vision 1x：「只有一层极细白色描边，无双层、无双灰圈、无灰白环带」；4x 右栏：「看不到第二个玻璃层」；computed border 0 |
| 中心透明 | **PASS** | vision 1x/4x：「能透过面板看到后方城市纹理、河流、道路」；`bgImage` 无非透明填充层 |
| 未降级 | **PASS** | `cfg`：band 10 / dispPx 2.4 / gain 1 / ior 1.52 / bandAlpha .55 / rimAmt .8 / dispBandStart .85 / tint·spill·fgFlip on |

---

## 5. 文字 / pp / location / hover（6C6 本轮 20/21）

| 项 | 结果 |
|---|---|
| T6a data-panel 标题中心 \|dy\| ≤1 px | PASS |
| T6a2 scene-panel 标题中心 \|dy\| ≤1 px | PASS |
| T6b voice 无溢出 | PASS |
| T6c location 内容垂直居中 \|topGap−bottomGap\| ≤2 px | PASS |
| T5a hover Δmax ≥3 灰阶 | PASS |
| T5b hover Δmean ≥0.25 / 变亮占比 >1% | PASS |
| T5c 移开恢复 Δmean ≤0.6 | PASS |
| T7a/b/c/d pp 展开可见 / ≥17 行 / 不重叠 / 可滚 | PASS 4/4 |
| T2 参数固定 / T2b T2c 单层 | PASS |

视觉：1x 全图 vision 确认「标题无重影/裁切，FPS/GPU/中EN 排列整齐无压字，无越界/黑块/错误面板」；4x 右栏「显示/监控/上下文 三块单层玻璃，透明、无色带、无第二层」。

---

## 6. GPU / 启动 / FPS / 长帧 / reload

```
renderer  ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11)   ✓
启动(run2) lcMounted 674 ms / maskGone 10,525 ms / __gevBoot.inputReleased=true / state=ready-to-hide
启动(run1) bootInteractive 11,598 ms / lcMounted 14,558 ms / maskGone 17,064 ms（同一构建，冷缓存，方差与 7C 记录一致）
FPS 3×8s   49.5 (p50 12.3 / p95 54.6 / worst 145.5 / long>100ms 2)
           36.8 (p50 18.2 / p95 66.8 / worst 152.1 / long 5)   ← photoreal 未 ready
           62.2 (p50 12.1 / p95 42.6 / worst 121.3 / long 1)   ← photoreal ready 后稳态
reload      ready 后 reload：+100ms std 34.42 / +1s 54.99 / +4s 45.25 / +8s 46.54（中心 640×420）
            —— 无黑帧（黑帧判据 std ≈0.4），mean 97.9–105.97
console     pageerror 0 / console.error 0
```
- 卡片可点（真实鼠标）：`hit=panel-divider`，opened=true → closed=true（不是 `element.click` / `__gevLc.open`）。
- **FPS 判 PARTIAL**：AGENTS 要求「连续 8 s ≥50 且 ≤60」。2/3 窗不足 50，且都落在 photoreal 瓦片 ramp（第 3 窗 ready 后 62.2 达标但 >60 上限）。`nvidia-smi pmon` 显示仅 `ego.exe` 持上下文、sm 0%，GPU 利用率 0% → **不是第三方占用**；归因为 photoreal 加载期 + 本机稳态漂移（skill 已记录同代码逐轮 27–165 fps）。未优化、未降级效果换 FPS。
- 8E 报 87 fps，本轮同构建测不到 87；如实记录差异，不作 PASS 依据。

---

## 7. 代码卫生 / 出口 / 懒加载 / 产物

| 项 | 结果 |
|---|---|
| `!important`（授权范围） | **15** 条声明（gev-cn 14 + material-override 1）< 20 ✓；`material.css` 0 |
| `!important`（全仓） | **121**（`src/ui/styles/*` 106，8D 明示未授权）→ #13 PARTIAL |
| `@layer` 层序 | index.html:13 声明一次 ✓；**`style.css:18` 又声明一次**（同序，功能无害，但违反 8D §9.3 唯一性）→ 判偏差 |
| 未分层运行时 `<style>` | 8D 的 5 处已包 `@layer components`（本轮未逐处复扫） |
| Cesium 单一出口 | `src/cesium.js` 唯一；`from 'cesium'` 直连 **0**；`check-import-directions` EXIT 0（877 模块 / 61 入口 / 0 warn） |
| `check-package-boundaries` | EXIT 0（112/112） |
| `window.__*` | 36 名字 / 124 次；**`check-window-globals` EXIT 1**（`src/app/catalog.js:72` `PROBE-TEMP` → `window.__gevProbeAccess` 未登记，2 条 R2） |
| 懒加载 | 21 处 `import()`；FCP 1972 ms 时无图层 chunk；core 5091 ms / rest 5511 ms；bootstrap 1400 kB（−45%） |
| 构建产物 | `dist-8e` **36 MB**；`models` 12 文件 / 3.4 MB；源模型未删；`GEV_KEEP_ALL_MODELS=1` 逃生口在位 |
| 单测 | `node --test src/lc/*.test.mjs` → **81/81 PASS**；全量 5091/63（8E 记录）本轮未重跑（>8 min） |
| 控制台 | 0 pageerror / 0 console.error（三次运行一致） |

---

## 8. 门禁与结论

**判据未改**：本轮所有阈值均来自既有仪器（6C6 T3b/T3c/T3d/T3e/T3f/T5/T6/T7、8B A1–A8、8C A1–A11）与 AGENTS 的 FPS 50–60 区间；Gate 只读、不改判据、不改卡体。

**FAIL 4 条**（见 §0）+ **PARTIAL 8 条**（#13 #15 #16 #17、D2、G8 G11 G20、FPS）。

**建议退回批次**：
- T3b 色散 → 退回 8C（lens shader）：在**冻结 Cesium**、噪声 ≤3 的仪器口径下复测；若仍 0/36，需扩可见带/调 R–B 间距（8B/8C 记录 34/36 与本轮 0/36 必须解释）
- `window.__gevProbeAccess` → 退回 8D/后续卡：删除 `PROBE-TEMP` 或走 `bridge.register` + 白名单 reason；同时修 `check-window-globals` 的退出码链路（当前 EXIT 1 已生效，勿再放过）
- FPS → 退回 8E/性能卡：photoreal ramp 期长帧归因（LoAF 已可用），目标连续 8 s ≥50 不靠降级
- `style.css` 重复层序 → 退回 8D：删 `style.css:18` 一行（同序无害，但违反自定唯一性）

---

## 9. 视觉复核（强制项）

| 图 | 尺寸 | vision 结论 |
|---|---|---|
| `8f-steady-1x.png` | 1348×774 | 单层细高光、无双层/双灰圈/灰白环带；中心透明可透见城市/河流；无彩虹色带；文字无重影/裁切/压字；无越界/黑块/错误面板 → **PASS** |
| `8f-right-4x.png`（1x 裁剪 360×480 → 4x LANCZOS） | 1440×1920 | 「显示/监控/上下文」三卡：一层细高光、无双层描边；中心透明见城市纹理；无色带；文字无裁切；**看不到第二玻璃层** → **PASS** |
| `8f-card-4x.png`（mini 卡 182×106 → 4x） | 728×424 | 区域过小（mini 态），仅作单层/边缘参考，**不作为主判据** |
| 8x NEAREST | — | 卫星底图放大成像素块，**vision 不可判读 → 无效证据**（与 8D 同结论，如实记录） |

**口径限制（如实）**：真 `deviceScaleFactor=4` 会使 Cesium 大气 shader 编译失败（8D/8E 均记录，baseline 构建同样失败），故 4x/8x 为「1x 截图 + LANCZOS/NEAREST 放大」，与 8D/8E 同口径。

---

## 10. 证据路径

```
报告      docs/Phase8F-最终Gate-20261031.md
运行态    .gev-logs/lc/phase8f/gate.json（renderer/启动/一层玻璃/cfg/eff/FPS/点击/reload）
启动+FPS  .gev-logs/lc/phase8f/fps.json（3×8s 窗 + 启动口径）
D1–D12    .gev-logs/lc/phase8f/d1-d12.json（glass/edge/look/a11y/字重/圆角/gloss/morph）
6C6       .gev-logs/lc/phase8f/c6v-8f.log（20/21，T3b FAIL 原文）+ .gev-logs/lc/phase6c6/c6visual-8f.json
截图      .gev-logs/lc/phase8f/shot/8f-steady-1x.png / 8f-right-4x.png / 8f-left-4x.png
          / 8f-dock-4x.png / 8f-card-1x|4x|8x.png / 8f-open.png / 8f-reload.png
仪器      scripts/lc/_8f-gate.mjs / _8f-fps.mjs / _8f-d.mjs（只读，不改产品代码）
```

## 11. 未验证 / 未重跑（不隐瞒）

1. 全量单测 5091/63 未重跑（>8 min），仅 `src/lc/*.test.mjs` 81/81 本轮实跑。
2. 8B gate / 8C gate 全套未重跑；D2 阴影真采样、D9 8x 像素 A/B 引用其报告数值（本轮 spot-check 只拿到 cfg/字段与 natural 态）。
3. 移动端 390×844 指纹、7 卡全展开矩阵、8x 边缘矩阵未重跑（8D/8E 记录；本轮只做 1x + 3 个 4x 裁剪）。
4. 4x/8x 为放大口径，非真 DPR（环境限制）。
5. `dist-8e` 不含 `PROBE-TEMP`，故运行态读数不受其影响；源码卫生项仍判 FAIL。
