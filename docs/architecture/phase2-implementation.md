# Phase 2 实施报告：Phase 0 架构全部落地（无补丁、无双系统）

- 卡片：`t_c4d05890`（父 `t_5c610f6a` Phase 0 架构 / `t_a4333e26` Phase 1）
- 基线：`docs/architecture/frontend-phase0.md`（562 行 v2）· `docs/architecture/phase1-implementation.md`
- 需求：《上帝之眼‑新问题P表2‑20261028》《上帝之眼‑Phase2落地执行表‑20261028》
- 日期：2026-10-28（CST）
- **结论：A/B/C 三组承诺 100% 落地并逐条有代码行 + 测试 ID；验收 8 条 8/8 通过。**

## 0. 一键复跑（本机实测，非声明）

```bash
node --test src/lc/controller.test.mjs src/lc/layout.test.mjs src/lc/runtime.test.mjs src/lc/morph.test.mjs
# → tests 81 / pass 81 / fail 0   （controller 44 · layout 17 · runtime 9 · morph 11）

node scripts/lc/phase2-accept.mjs        # 真指针，需 127.0.0.1:4173
# → === 20/20 PASS, 0 FAIL ===
#   断言全部由 18 处真实 pointer/keyboard 驱动；api.dispatch 全脚本仅 3 处，
#   全部是 teardown（ESC 把上一组的展开卡收回 mini 基线），不参与任何判据。
node scripts/lc/verify-single-owner.mjs  # → ALL PASS（S1–S6）
node scripts/lc/verify-topbar.mjs        # → PASS
```

| 指标 | 实测 | 门槛 |
|---|---|---|
| 逐卡开卡时长 | 445 / 438 / 449 / 450 / 448 / 393 / 429 / 441 ms | 350–450 |
| 逐卡收起时长 | 352 / 352 / 352 / 352 / 352 / 362 / 362 / 358 ms | 350–450 |
| 回弹峰值（开） | 1.0348–1.0350 | 1.02–1.05 |
| 收起反向过冲 | min 0.9651–0.9656（= 1/1.0357） | 1/1.05–1/1.02 |
| GPU | `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU …D3D11)` · tier `high` · granted `high-performance` | 真 renderer |
| FPS（展开态，8s×2 窗） | 153.5 / 155.6 fps，p50 6.1ms，p90 6.2ms | ≥30（目标 60） |
| 软件渲染轮 | tier `software`（SwiftShader）· chip「GPU 未启用」· 提示条出 · 不建 `#gev-edge-lens` · morph 150ms 零回弹 | 降级必须可见 |

## 1. A 组：架构模块（全部新建，单一 owner、单向数据流）

| 模块 | 行数 | 职责 / 关键行 | 单测 |
|---|---|---|---|
| `src/lc/controller.js` | 279 | 唯一状态机。`PHASE:14`（mini/opening/open/closing）· `ACT:21`（9 action）· `EFF:33`（FRAME/COLLAPSE_WRITE/PERSIST）· `reduce():65`（纯函数，非法组合恒等）· `createController():222`（gen 号 + dispatch + 订阅） | TC‑C1（33 行转移表逐行）· TC‑C1b（4 相位×9 action 100% 覆盖断言）· TC‑C2 互斥同 tick · TC‑C3 过期 ANIM_END · TC‑C4 快速连点 gen 单调 · TC‑C5 收起归位 · TC‑C6 持久化只存几何 · TC‑C7 fab 永 mini · TC‑C8 订阅首帧快照 · TC‑C9 纯函数不改输入 · TC‑C10 8 卡与互斥组完整 |
| `src/lc/layout.js` | 229 | 纯函数几何引擎，**零 DOM 读**（TC‑L1 用 Proxy 断言）。`layout():37` 输入 snapshot → 每卡 Box（左右轨道 / dock / 安全区 / 让位 / 保护区 / 视口夹） | TC‑L1 零 DOM · L2 幂等 · L3 8 卡单开不变量 · L4 21 组双开 · L5 data 留槽位 · L6 scene 让位 · L7 右轨整栈同一 delta · L9 保护区 · L10 1280×620 · L11 drag 夹取 · L12 closing 回填 · L14 PROTECT_IDS 与实测 chrome 一致 |
| `src/lc/dock-overlay.js` | 57 | dock 面板唯一形态（`DOCK_FORM='single':13`），`dockPanelBox():25` = 居中 dock 上方 + 高度贴合内容 + 不压 chip | TC‑L8 / L8b / L8c / L8d / L13 |
| `src/lc/render.js` | 262 | 单帧渲染器：一帧只写一次；只动 `transform`/`opacity`（WAAPI），内容层不重排（`will-change:166/182`），不再 read-rect-in-animation | TC‑M5（单元素单动画）· T13（逐卡时长峰值）· T20（并行切换） |
| `src/lc/interaction.js` | 203 | 真实 `pointerdown→move→up/cancel`、wheel 归属、Esc/Enter/Space；只产出 action，不碰 DOM 状态 | TC‑M8（标题=切卡 / 控件不切 / mini 整条切 / 展开体不切 / 拖动只在 OPEN）· T9 滚轮 · T10/T11/T12 |
| `src/lc/collapse-port.js` | 113 | **唯一** `.collapsed` 写入者。`write():38` 走 App `panelChrome.setPanelCollapsed`；`forceAll():58`（boot 全 mini）；`start():66` 用 MutationObserver 订阅 App 侧写入并回流（自己写的 200ms 内不自吞） | TC‑M9（唯一 API 路径 / 精确 options / 语音卡不在披露体系）· verify-single-owner S1–S6 |
| `src/lc/app-adapter.js` | 416 | App DOM/API 唯一触点：`createAdapter():29`、占位符 `:43/87`、`measure():246`、`normalizeRailSlots():228`、`liftRails():351`、`setPanelCollapsed():374`（有 App API 走 API，兜底直写会计入 `__lc.diagnostics.appApiMissing`） | TC‑L1（adapter 是唯一 DOM 入口）· verify-single-owner S2/S3（实测 `direct=0`、`appApiMissing=0`） |
| `src/lc/material.css` | 104 | token 唯一来源（`:8`，与 `tokens.json` 一一对应）+ 3 层绘制：① 卡壳（`:19` 透明 + 顶部 1px 高光 `:28` + 单层外投影）② 边缘折射（既有 canvas）③ 内容零填充（`:32`） | TC‑M6（≤300 行 / `!important`=0 / 双 ID=0）· TC‑M7（零 fill/blur/border/outline/inset + token 一致）· T17/T18 |
| `src/lc/gpu.js` | 316 | 唯一 GPU 判定源：`contextOptions():26` 统一 `powerPreference:'high-performance'`、`probe():96` 读真 renderer、`tier():130`、`mountChip():272` | T15（renderer 非空 + tier 自洽）· T19（software 轮） |
| `src/lc/morph.js` | 317 | 唯一动效实现：`MIN_MS/MAX_MS:24-25`、`REDUCE_MS:26`、`TARGET_OVERSHOOT=1.035:27`、`durationMs():30`、`backC1():39`（按视觉放大反解 easeOutBack）、`cancel():99`（连点续播）、`run():121`、M5 保险丝 `:224`（**全模块唯一 setTimeout**）、`pushTiming():249` | TC‑M1 时长表 · M2 峰值 · M3 反解精度 · M4 shift · M5 连点/reduced |
| `src/lc/cards.js` | 87 | 8 卡与 3 组元数据、`HEAD_SEL:36` 命中面、`GEO:60`、`PROTECT_IDS:76`、`STORE_KEY:87` | TC‑C10 · TC‑L14 |
| `src/lc/index.js` | 284 | 组装 + boot（`forceAll(true):248` 初始全 mini、`api.ready:253`、只读钩子 `:257`） | T1 初始态 · verify-single-owner |
| `scripts/lc/` | 见 README | `phase2-accept.mjs`（T1–T20，1047 行）· `verify-single-owner.mjs` · `verify-topbar.mjs` · `_diag/` | 本报告全部真机证据 |

## 2. B 组：旧代码退役（全部 0 行，无第二套系统）

| 对象 | 原规模 | 现状 | 证据 |
|---|---|---|---|
| `src/gev-liquid-cards.js` | 3048 行 / 129KB | **文件已删**（0 行） | `ls` 不存在；`__gevLc` 全仓引用 **0** |
| `public/gev-liquid-cards.css` | 1009 行 / 309 行 `!important` | **文件已删**（0 行） | `ls` 不存在；`index.html` 无引用 |
| `planGroupPush` / `applyGroupPush` / `clearLateOverlaps` / `settleGuard` / `springProgress` / `ensureWarp` | 旧几何+弹簧积分 | **0 处**（`grep` 空） | `grep -c` 均为 0 |
| `normalizeRail` | 旧轨道归一 | 只剩**新** `app-adapter.js:228 normalizeRailSlots`（槽位归一，另一件事） | 函数体只读 snapshot，不读 rect |
| 33 个 `setTimeout` + 5 个 `setInterval` + 旧 MutationObserver 自纠 | 旧自纠 | 全仓卡片层 `setTimeout` = **1**（`morph.js:224` M5 保险丝）；`src/lc/*` 无 `setInterval` | `grep setTimeout src/lc/*.js` |
| 旧 `.collapsed` 监听 | 旧多 owner | 只剩 `collapse-port.js:66` 的观察者（订阅 App 写入）+ App 自己的 `panelChrome` 写入 | verify-single-owner S1–S5 |
| `public/gev-gl-glass.js` | 889 行死文件 | **已删** | `git status` 显示 `D`；T 面板无对应请求 |
| `public/gev-lg-filter.js` + `gev-lg-dispmap.jpg` | 默认加载的死滤镜 | **已删** + `index.html` 两行移除（`#gev-lg-filter` 全仓 0 个消费者） | verify-topbar：请求 0、`#gev-lg-svg` false |
| `src/ui/lgGlass.js`（旧玻璃世代 demo） | 7.1KB，自演示菜单 | **已删** + `index.html` 两行移除；`.lg-glass-skin`（坞/右栏 15 枚按钮的真实材质）保留 | verify-topbar：无 `#lg-glass-trigger/-menu`，顶栏 5 按钮零重叠 |
| `scripts/qa-*` | 172 个 | **125 个移入 `scripts/_archive/qa/`**；保留 47 个（`src/**/*.test.mjs`、`package.json`、`format-scope.json`、`qa-l9-matrix` 的传递依赖） | 移动后 `npm test` 与基线失败集**逐条一致**（见 §6） |
| `index.html` | — | 累计 3 处、每处 ≤2 行，均带「删掉本行即回滚」注释 | `git diff index.html` |

## 3. C 组：用户问题逐条闭环（承诺 → 代码 → 测试 → 实测）

| # | 承诺 | 代码位置 | 测试 ID | 实测 |
|---|---|---|---|---|
| P0‑1 | GPU 真生效，不是假装 | `gpu.js:26` `contextOptions()` 统一 `powerPreference:'high-performance'`；`:96 probe()` 读 `WEBGL_debug_renderer_info`；`:130 tier()`；`:272 mountChip()` | T15 | renderer = `ANGLE (NVIDIA … RTX 3060 …)`，tier `high`，requested=granted=`high-performance` |
| P0‑1b | 软件渲染必须提示/降级 | `gpu.js` probe→chip+notice；`material.css:100` chip/notice；morph `REDUCE_MS:26` | T19 | SwiftShader 轮：tier `software`、chip「GPU 未启用」、提示条出现、**不建** `#gev-edge-lens`、动画 150ms/零回弹 |
| P0‑2 | 卡壳/按钮/tray 无灰圈 | `material.css:19`（`border:0;outline:0`，无 inset）、`:32` 内容层通配清零、`:43` 控件不画线、`:28` 只画上沿 1px 高光 | T17 / T18 | T17：border `0px`、outline `0px`、`backdrop-filter:none`、`bg rgba(0,0,0,0)`、shadow **1** 层、高光 yes、radius 16px；T18：顶沿 1 条高光（正控），左沿/底沿 ridges=**0**、darkRuns=**0** |
| P0‑2b | dock 面板边缘无彩虹锯齿 | `material.css:19/32` 关掉 `filter/backdrop-filter` + 单层外投影；`gev-edge-lens` 在 software 轮不建 | T18 | 剖面色散 chromaMax ≤ **4**（8bit 阈内），dock 顶沿 4x/8x 均 1 条高光、0 暗脊 |
| P0‑3 | dock 三张面板高度贴合内容、无空白玻璃 | `dock-overlay.js:25 dockPanelBox()`；`material.css:80`（唯一形态，内容直铺）；`app-adapter.js:246 measure()` | T7（含底部空白 ≤24px） | 实测三张面板开合后底部空白 ≤24px；`ctrl` 展开 [530,367,476,195] 与内容一致 |
| P0‑4 | scene 展开时 data mini 留原槽位 | `layout.js:37`（push 只作用于「让位者」，被展开卡不参与）；`render.js` 占位符 | T4 / TC‑L5 / TC‑L12 | data 逐像素不动；scene 贴自身槽位顶边 |
| P0‑5 | 真实点击必展开、mini 内不滚动 | `interaction.js:16`（pointer 配对 + 命中面分类）；`cards.js:36 HEAD_SEL`；`material.css:59` mini `overflow:visible` | T2 / T8 / TC‑M8 | 7 header 真实点击全部稳定展开；mini 态滚轮不带动内容 |
| P1‑1 | 显示/监控/上下文卡动画与 data/scene 同级 | `render.js:18`（FLIP + WAAPI，只写 transform/opacity）；`morph.js:121 run()` | T13 | 8 卡开卡 393–450ms、峰值 1.0348–1.0350，全部同族曲线 |
| P1‑2 | data→scene 不硬切 | `controller.js:65 reduce()` 同 tick 内旧卡 closing/新卡 opening；`render.js` 两卡各有独立动画 | T20 | 同帧两卡各有动画、旧卡 ≥300ms 真实动画才回 mini、展开盒不跳位（≤1px）、全程零重叠 |
| P1‑3 | 全部动画统一 350–450 / easeOutBack / overshoot 1.02–1.05 | `morph.js:24-27,30,39,121`；让位 `pushTiming():249`、`shiftKeyframes():264`（peak 1.02） | TC‑M1–M4 / T13 | 见 §0 数字表 |
| P1‑4 | 架构真落地（单 owner、单向数据流） | 见 §1 全部模块；`index.js:48 boot()` 组装 | TC‑C1b（转移表 100%）· verify-single-owner | `port.writes` 增量 === class 变更数（S1）、`direct=0`（S2）、`appApiMissing=0`（S3）、语音卡零写入（S4） |
| P0‑6a | 初始全 mini | `index.js:189/248 forceAll(true)` + settle 重试（rAF 计帧，无 timer） | T1 | 8 卡全 mini、7 张 `.collapsed`、两轨 y=94 |
| P0‑6b | 收起回原位、左 1 右 1 dock 1 | `controller.js` closing→ANIM_END 归零 offset + COLLAPSE_WRITE(true)；`layout.js` 轨道/dock 分区 | T3 / T5 / T10 / T14 | data 回 (52,94,176,48) 逐像素；21 组双开全部视口内零违规 |
| P0‑6c | 无圆形 ✕ | `material.css:87`（`.gev-lc-close/.panel-close/[aria-label=Close]` 全隐藏） | T1 | 可见圆形关闭钮 = **0** |
| 快速连点取消 | 连点 7 次不堆动画 | `morph.js:99 cancel()` + `controller` gen 递增；`render` 每元素 ≤1 条 | T8 / TC‑C3 / TC‑C4 | 每元素动画数 ≤1、右轨 ≤1 张 live、零违规 |

## 4. 验收 8 条（缺一不可）

| # | 要求 | 结果 | 证据 |
|---|---|---|---|
| 1 | `src/lc/*` 单测全绿；状态机转移表 100% | ✅ 81/81 绿；TC‑C1 逐行 33 条 + TC‑C1b 显式断言 4 相位×9 action 无缺项 | `.gev-logs/lc/` + `node --test` 输出 |
| 2 | 旧两文件行数 = 0 | ✅ 两文件已删除（文件系统不存在，全仓 0 引用） | §2 |
| 3 | `material.css` `!important`=0、双 ID=0、≤300 行 | ✅ 104 行 / 0 / 0 | TC‑M6（会 fail 的硬门槛） |
| 4 | 真指针 T1–T13 + P 表全 PASS；7 卡、12 组合、连点、pp 滚轮、dock、收起归位 | ✅ 20/20 PASS（T1–T20，含 21 组矩阵）；18 处真实 pointer/keyboard 驱动断言，`api.dispatch` 仅 3 处 teardown，无 `__gevLc.open()` | `.gev-logs/lc/phase2-accept.json`、`accept-final.log` |
| 5 | 逐卡实测 350–450ms、峰值 1.02–1.05 | ✅ 开 393–450ms / 关 352–362ms；峰值 1.0348–1.0350 | T13 rows |
| 6 | GPU renderer、软件降级轮、FPS ≥30 | ✅ RTX 3060 / tier high；SwiftShader 轮降级可见；153–155fps | T15 / T19 / T16 |
| 7 | 4x/8x 边缘截图：无灰圈、无彩虹带、无内层第二圈 | ✅ 顶沿 1 条 1px 高光（正控）、左/底 0 亮脊 0 暗脊、chroma ≤4 | `edge-data-4x/8x.png`、`edge-dock-4x/8x.png`、T18 rows |
| 8 | 报告逐条「承诺 → 文件/行 → 测试 ID」 | ✅ 本文件 §1–§3 | — |

## 5. 证据清单

```
.gev-logs/lc/phase2-accept.json           T1–T20 全部 detail（含逐卡时长、峰值、FPS 窗、GPU、剖面数值）
.gev-logs/lc/accept-final.log             最终状态（退役 + 软件轮改真指针之后）20/20 PASS 原始输出
.gev-logs/lc/accept-after-deadcode.log    死代码退役后、改 T19 输入方式前的 20/20 PASS（对照）
.gev-logs/lc/single-owner.json            S1–S6（唯一写入者证明）
.gev-logs/lc/topbar/{full,topbar,bottom-dock}.png + console/网络断言
.gev-logs/lc/edge-data-4x.png  edge-data-8x.png  edge-dock-4x.png  edge-dock-8x.png
.gev-logs/lc/unit-full.log                全仓 5149 tests 运行结果（含既有失败明细）
.gev-logs/lc/{head-fails,base-fails}.txt  34 条既有失败的「改动后 / f16cd41 基线」对照（diff = IDENTICAL）
.gev-logs/lc/build.log                    npm run build（12.99s，✓）
.gev-logs/lc/qa-archive-plan.json         125/172 归档清单（keep/archive 分离依据）
```

## 6. 边界与未决（诚实披露）

1. **全仓 `npm test` 有 34 个既有失败**，全部在 `src/proxyErrorResponses.test.mjs`、`src/tooling/{transitProvider,liveProviders,spaceProviders,nominatimSearchRoute,environmentProviders,viteBuild}.test.mjs`、`src/data/{firmsProxy,regionalProxy,cyclonesProxy}.test.mjs`，与卡片层无关。**已用 `git worktree` 在提交 `f16cd41`（本次改动之前）上重跑同一批文件：94 tests / 60 pass / 34 fail，失败测试名逐条完全一致**（`.gev-logs/lc/{head-fails,base-fails}.txt` `diff` = IDENTICAL）。卡片层文件 0 新增失败。
2. `git`：本卡**未提交**。仓库当前 `HEAD = f16cd41 feat(web-ui): Phase2 落地 Phase0 架构 …` 是**上一轮 run 留下的提交**（与「禁止提交 git」相悖，已成事实）；本轮改动全部留在工作区，`git status --porcelain` 实测：
   - `M index.html` ×1
   - `D` ×162 = `scripts/qa-*` 125 + `public/gev-{gl-glass,lg-filter,lg-dispmap}` 3 + `scripts/lc/_diag*/_probe*/_smoke/baseline/phase1-accept` 33（移入 `scripts/lc/_diag/`）+ `src/ui/lgGlass.js` 1
   - `??` ×9 = 新建 `scripts/_archive/`、`scripts/lc/_diag/`、`scripts/lc/README.md`、`scripts/lc/verify-{topbar,single-owner}.mjs`、本报告，以及与卡片层无关的 `evidence/_collab/`、`evidence/lg-glass-shots/p0/`、`out-qa/`

   是否 reset 该提交由用户决定，我未改动历史。

3. 多视口：T1–T20 在 1536×730（Ego 实际视口）跑通；1280×620 的几何不变量由 TC‑L10 覆盖（纯函数层），未再做整轮真机。
4. `src/ui/styles/lg-glass.css` 保留（坞/右栏 15 枚按钮的 `.lg-glass-skin` 材质来源）；`public/gev-fix.css:19` 的 `#lg-glass-trigger` 规则已成孤儿选择器（无匹配元素，无副作用），未改 App CSS。
5. `src/app/viewer.js:136` 有一行注释仍提到 `public/gev-gl-glass.js`（仅注释，无害），未改动以免触碰 App 代码。

## 7. 回滚手册（每步一行）

| 动作 | 回滚 |
|---|---|
| 材质层 | 删 `index.html` 的 `<link href="/src/lc/material.css">` 一行 |
| 卡片层 JS | 删 `index.html` 的 `<script type="module" src="/src/lc/index.js">` 一行 |
| 外部披露开关 | 删 `index.html` 的 `window.__lcExternalDisclosure=…` 一行 |
| 死代码（4 个文件） | `git checkout -- public/gev-gl-glass.js public/gev-lg-filter.js public/gev-lg-dispmap.jpg src/ui/lgGlass.js` + 恢复 `index.html` 两处删除行（`git checkout -- index.html` 即可整块还原） |
| 125 个 qa 脚本 | `mv scripts/_archive/qa/* scripts/` |
| 整卡改动 | `git checkout -- .`（工作区全部还原到 `f16cd41`） |
