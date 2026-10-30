# t_b37e6b4b — 交互修复：展开/切换唯一 owner、可点、不隐藏、不乱跳

日期：2026-10-27 · profile: deepseek · 代码：`src/gev-liquid-cards.js`（+ 唯一 CSS 无改动）

## 结论（先看这里）

- **5 项验收全过**，判定脚本用真实指针点击（CDP `Input.dispatchMouseEvent` → 走浏览器真实命中链），
  不使用 `__gevLc.open()`：`.gev-logs/t_b37e6b4b/final.log` → `PASS: 5 项验收全过（真实指针点击，console error=0）`。
- **12 组合布局不回归**：`scripts/verify-overlap12.mjs` → 12/12 `ovl=0`、header 全部可点、无隐藏、残留 placeholder 0、console error 0。
- **输入回归 A–G 全过**：拖拽/缩放/内部控件/内容区空白/Esc/键盘 Enter/100ms 双击 都没被唯一 owner 破坏。
- **第二 owner 已死透并用计数器取证**：在 App 自己的 click 落点（`.panel-header` / `.dock-tray-toggle` 元素 + document 委托）
  挂计数器，全程 7 步 + 7 次组内切换 + 连点 + 全关 = **App 收到 header click 次数 0**。

## 根因 → 改法

| # | 根因 | 改法（都落在 `src/gev-liquid-cards.js`） |
|---|------|------------------------------------------|
| 1 | 双 owner：App 的 `.dock-tray-toggle` / `.panel-header` 自带 `.collapsed` 切换，Hermes 又走 `toggleFloat` | 标题条命中一律由本层接管；**click 阶段只做灭口**（`preventDefault/stopPropagation/stopImmediatePropagation`，不再改状态） |
| 2 | 用 click 判定“点了 header”会丢点击 | 改成 **pointerdown 记候选 + document pointerup 结算**（位移 <6px、非拖拽/缩放/收尾才切换）。卡片在 morph/让位补间中滑走也不会丢点击 |
| 3 | 键盘路径是第三个 owner：App 在标题条按钮上 `keydown Enter → toggleDisclosure`（原生展开，不浮起） | 卡片 keydown(capture) 抢占 Enter/Space → 走 `activateFloat`；`st.kbToggled` 400ms 防合成 click 二次切换 |
| 4 | 互斥组把兄弟 header `visibility:hidden` → 用户想点的目标不可点 | 兄弟卡只 `.collapsed`（保持可见可点）+ 组内让位（`planGroupPush`），全程不用 `.gev-lc-hid` |
| 5 | dock 卡 header 是 `<button data-dock-toggle-target>`，被 `INTERACTIVE` 排除 → 只走 App 原地展开 | 新增 `HEAD_SEL` / `HEAD_NO_TOGGLE`：标题条（含 dock 的 button）算热区，内部控件（slider/toggle/pin/edge）不算 → dock 卡也浮起 |
| 6 | 浮层态下 App 的“收起小三角”会把 `.collapsed` 加回浮层卡（空壳） | 浮层态命中 `.panel-collapse-btn/.pp-collapse-btn` → 翻译成 `floatClose`（当前皮肤 CSS 已 `display:none`，属防御性兜底） |

组内切换顺序：**先 `retireInstant` 当前卡（退回迷你槽位）→ 同一 tick 内 `floatOpen` 目标卡 → 退场卡从旧大矩形补间滑进新槽位**
（没有“先 hidden 再出现”，也没有中间“都关着”的状态）。

## 验收证据（`.gev-logs/t_b37e6b4b/verify.json` + `final.log`）

### 1) 依次真实点击 7 张 header
7/7 第一次点击即打开（`1st=Y`），命中元素（按下时刻记录）：`span.panel-title` ×4、`span.pp-header-label`、
`span.dock-label-icon-location`、`button#control-panel-toggle.panel-header.dock-tray-toggle`。
每步 `overlaps=0`、`hidden=[]`、`consistency=[]`、`tooShort=[]`、`ghost=0`、`appHits=0`、滚动槽宽 `sbw=0 / scrollbar-width:none`。

### 2) 组内切换（含反向，共 7 组）
`data→scene`、`scene→data`、`pp→cctv`、`cctv→global`、`global→pp`、`location→control`、`control→location`
全部 `toOpen=true / fromClosed=true`、落定 `overlap=0`、`hidden=[]`、`gev-lc-hid=0`。
切换过程逐 40ms 采样 ×14（每组）共 98 帧：**没有任何一帧出现 visibility:hidden 或可见 ghost**。

诚实标注一处：切换动画进行中（≤350ms）退场卡与「已展开的别组卡」存在**瞬时几何重叠**
（`traceOvlMax` 0–3，最大 ~16.4k px²，出现在 `global→pp` 那次；其它组 0–2）。
这是“不隐藏 + 位置连续”的必然代价：退场卡必须看得见地飞回自己的槽位，路径会扫过别组卡；落定后严格 0。

### 3) 快速连点 7 张（间隔 60ms）
落定 `overlap=0`、`hidden=[]`、`consistency=[]`；最终展开集合 = `["scene-panel","global-context-panel","control-panel"]`
= 每组“最后一次生效点击”的期望值（脚本按点击序列推导，逐字相等）。
`pressNoEffect=[]`：**每一次“按下确实落在目标 header 上”的点击都立即生效，没有一次被吞**。

诚实标注第二处：7 次点击里有 3 次（scene/cctv/control，都是组内第 2 张、正在被让位飞走的那张）
**按下那一刻 header 已经不在光标下**（脚本用 `__downs` 记录 pointerdown 的真实命中元素取证：`press=null`）。
补点一次即生效（`aimMiss=3`）。这是“人手追着 350ms 动画里的目标点”的物理极限，不是 App 吞事件——
对照组：只要按下命中 header，100% 立刻切换。

### 4) 全部关闭
7 卡 rect 与初始逐一对比 `[dx,dy,dw,dh] = [0,0,0,0]`，`push=(0,0)`，`overlap=0`，`hidden=[]`，无残留 placeholder。

### 5) 记录与报错
`verify.json` 每步含 `state`（x/y/w/h/vis/disp/op/collapsed/floating/push/nat/parent）、`hit`、`press`、`overlaps`、
`hidden`、`consistency`、`ghost`、`scroll`、`appHits`；`pageerror` + console error 全程 **0**。

## 附带回归（不破坏既有交互）

`scripts/qa-b37e6b4b-input.mjs`：

| 项 | 结果 |
|---|---|
| A 键盘 Enter 打开 dock 卡 | 浮起 318×380（改造前：App 原地展开、不浮起） |
| B 浮层 header 拖拽 +200/+40 | dx=192 dy=40，仍 floating，不误关 |
| C 边缘缩放 | 320×380 → 384×428，仍 floating，无 `.gev-lc-hid` |
| D 卡内控件（pp-slider） | 控件收到 click=1，卡片未被关 |
| E 内容区空白点击 | 不收起（避免“点空白就消失”） |
| F Esc | 收起且 `collapsed=true` |
| G 100ms 双击 header | 开 → 关（确定性） |
| H 浮层态收起小三角 | 当前皮肤 `display:none`，跳过（防御代码保留） |

## 复跑方法

```bash
# 4173 = vite dev（读 src/，改完刷新即生效）
node scripts/verify-interaction.mjs     # 5 项验收（真实指针）→ .gev-logs/t_b37e6b4b/verify.json
node scripts/verify-overlap12.mjs       # 12 组合布局 → overlap12.json
node scripts/qa-b37e6b4b-input.mjs      # 拖拽/缩放/键盘/内部控件回归 → input.json
```

## 改动文件

- `src/gev-liquid-cards.js`（唯一 owner 输入层重写；本任务新增/修改：pointerdown+pointerup 配对、click 灭口、
  Enter/Space 抢占、浮层态收起三角翻译、press 清理）
- `scripts/verify-interaction.mjs`（验收脚本强化：App-owner 计数器、按下真实命中归因、40ms 逐帧采样、
  consistency/ghost/scroll/tooShort 断言、最终状态推导）
- `scripts/qa-b37e6b4b-input.mjs`（新增：输入回归 A–H）
- `.gev-logs/t_b37e6b4b/`（证据：final.log / verify.json / overlap12.* / input*.log / 5 张截图）
