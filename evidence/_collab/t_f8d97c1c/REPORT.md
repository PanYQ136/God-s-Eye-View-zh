# t_f8d97c1c — 展开互斥修复（control-panel × 右栏卡）：报告

## 0. 结论

| 组合（原重叠） | 改前 overlap | 改后 overlap | 处理方式 |
|---|---|---|---|
| data + pp-toggles + control | **22,134 px²** | **0** | control 右边界从 1303 收到 1176（宽 465→338），留 8px 缝 |
| data + cctv-panel + control | **35,934 px²** | **0** | control 收到 1136（宽 465→298），留 8px 缝 |
| data + global-context-panel + control | **31,414 px²** | **0** | control 收到 1156（宽 465→318），留 8px 缝 |

- **12 个 combo（2 左栏 × 3 右栏 × 2 dock）全部 overlap = 0**；另加 6 个**倒序**复验也全部 0（证明与打开顺序无关）。
- 7 张卡单独展开 overlap = 0；展开态**没有任何按钮被其它卡盖住**（covered=0，命中测试 `elementFromPoint`）。
- 收起后 **7 卡 rect 与基线逐字段完全一致**（restore.identical = true，diff = []），无 placeholder/ghost。
- 玻璃材质 / 圆角 / 尺寸基准**未改**（expW/expH、16px 圆角、squircle、backdrop 参数全未动）。
- 未提交 git。

---

## 1. 根因（实测定位，不是猜）

复现：在同一 tick 里连开 data → pp → control（无帧间隔），control 会被放到 **465 宽**（= `(838,338) 465×380`），
而 pp 展开在 `(1184,94) 300×430` → 重叠 119×186 = **22,134 px²**，与复核数字一模一样。

原因不是在 `placeExpanded()` 的避让算法，而是**它采样的兄弟卡矩形是错的**：

1. `floatOpen()` 里 `runMorph()` 用 WAAPI 动画（`fill:none`），**动画首帧 = 折叠矩形**（translate+scale 反向），
   动画期间 `getBoundingClientRect()` 返回的是**插值中的矩形**；
2. 同一 tick 连开两张卡时，后开的那张去躲前一张 —— 但前一张此刻的 rect 还是折叠尺寸（176×50 贴在 1308），
   于是「没有碰撞」，control 只被右下角芯片限位到 465 就收工；
3. 动画 settle 后两张卡各自到位 → 互压。**没有任何一次事后复检**。

证据：`scripts/dbg-expand-overlap.mjs`（同一 tick 连开 → 465×380 重叠；分开点 → 338×380 无重叠）。

---

## 2. 改了什么（2 个文件 + 8 个 QA/证据脚本）

### `src/gev-liquid-cards.js`

1. **几何一律读目标矩形**：`rectOf(el)` 对浮层卡改用 `st.g`（已写入的最终盒子），不再读动画中的
   `getBoundingClientRect()` → 动画期间采样 = 采样真实落点。
2. **统一 reflow（单趟、固定优先级）**：新增 `reflow()`，按
   `data → scene → pp → cctv → global → location → control → voice` 的优先级**一次性**算完所有浮层卡；
   每张卡只把「优先级更高」的浮层卡当障碍（`skipIds = 低优先级`），所以：
   - 高优先级卡永远拿到 cfg 目标尺寸，低优先级卡收窄/让位；
   - **结果与打开顺序无关**（正序/倒序都得到同一组 rect）；
   - 不会出现「先算一次再跳一次」的二次跳位。
3. 接线：`floatOpen` 用 reflow 取代原来「pre → hideCovered → final」两次 `placeExpanded`；
   `floatClose` 落定后 reflow（腾出的空间还给其它卡）；窗口 resize 时 reflow（140ms 防抖）。
4. 保护用户操作：手动**拖动**（`st.userMoved`）/ 边缘**缩放**（`st.userSized`）过的卡不再被 reflow 改尺寸/位置，只当障碍。
5. 退化守卫：卡片尚未进入布局（宽<20 或 高<10，例如页面刚加载 / App 把它放进 `display:none`）时 `floatOpen` 直接返回，
   不再把浮层钳到左上角 `(8,84)`（顺带修掉一个「卡飞了」的边界 bug）。
6. 调试钩子新增 `__gevLc._reflow()` / `_ids()`。

让位规则本身沿用原有意图（`rails=dock` 收窄右边），只是现在算得准：
`w = hit.left - GAP - x`，`MIN_W=150` 兜底。

### `public/gev-liquid-cards.css`（新增 §11，**只在收窄态生效**）

control 收到 298–338 后，「地图源」那排 chip（`.map-stack-chip-row` 原本 `repeat(5, minmax(0,1fr))`）
列宽被压到 ~52px，`white-space:nowrap` 的文字会溢出到相邻 chip 上**互相压字**（实测 338 时 chip 矩形相交 5 对）。
收窄态改成按内容换行：

```css
#control-panel.gev-lc-narrow .map-stack-chip-row {
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)) !important;
}
```

`.gev-lc-narrow` 由 JS 在 `applyBox()` 里挂/摘，条件是 `box.w < cfg.expW * 0.8`（520→416），
所以**默认展开（465）不会命中**：465 下 chip rect 与改动前逐字段相同（78,78,78,78,96 / 79,78），
收窄态变 2 列 × 4 行、7 个 chip 全部在卡内、两两相交 = 0。

---

## 3. 12 个 combo 表（overlap 全 0）

### 12 个 combo（正序：左→右→dock，同一 tick 连开）

| # | combo | 三卡 rect (x,y w×h) | overlap 面积 | 结果 |
|---|---|---|---|---|
| 1 | fwd data-panel + pp-toggles + location-bar | data (52,94) 320×380<br>pp-toggles (1184,94) 300×430<br>location-bar (530,478) 380×240 | 0 | ✅ |
| 2 | fwd data-panel + pp-toggles + control-panel | data (52,94) 320×380<br>pp-toggles (1184,94) 300×430<br>control (838,338) 338×380 | 0 | ✅ |
| 3 | fwd data-panel + cctv-panel + location-bar | data (52,94) 320×380<br>cctv (1144,152) 340×412<br>location-bar (530,478) 380×240 | 0 | ✅ |
| 4 | fwd data-panel + cctv-panel + control-panel | data (52,94) 320×380<br>cctv (1144,152) 340×412<br>control (838,338) 298×380 | 0 | ✅ |
| 5 | fwd data-panel + global-context-panel + location-bar | data (52,94) 320×380<br>global (1164,210) 320×354<br>location-bar (530,478) 380×240 | 0 | ✅ |
| 6 | fwd data-panel + global-context-panel + control-panel | data (52,94) 320×380<br>global (1164,210) 320×354<br>control (838,338) 318×380 | 0 | ✅ |
| 7 | fwd scene-panel + pp-toggles + location-bar | scene (52,145) 320×340<br>pp-toggles (1184,94) 300×430<br>location-bar (530,478) 380×240 | 0 | ✅ |
| 8 | fwd scene-panel + pp-toggles + control-panel | scene (52,145) 320×340<br>pp-toggles (1184,94) 300×430<br>control (838,338) 338×380 | 0 | ✅ |
| 9 | fwd scene-panel + cctv-panel + location-bar | scene (52,145) 320×340<br>cctv (1144,152) 340×412<br>location-bar (530,478) 380×240 | 0 | ✅ |
| 10 | fwd scene-panel + cctv-panel + control-panel | scene (52,145) 320×340<br>cctv (1144,152) 340×412<br>control (838,338) 298×380 | 0 | ✅ |
| 11 | fwd scene-panel + global-context-panel + location-bar | scene (52,145) 320×340<br>global (1164,210) 320×354<br>location-bar (530,478) 380×240 | 0 | ✅ |
| 12 | fwd scene-panel + global-context-panel + control-panel | scene (52,145) 320×340<br>global (1164,210) 320×354<br>control (838,338) 318×380 | 0 | ✅ |

### 6 个倒序复验（dock→右→左；结果与正序**完全相同** → 与打开顺序无关）

| # | 打开顺序 | control-panel rect | 右栏卡 rect | overlap |
|---|---|---|---|---|
| 13 | control-panel → pp-toggles → data-panel | (838,338) 338×380 | pp (1184,94) 300×430 | 0 |
| 14 | control-panel → cctv-panel → data-panel | (838,338) 298×380 | cctv (1144,152) 340×412 | 0 |
| 15 | control-panel → global-context-panel → data-panel | (838,338) 318×380 | global (1164,210) 320×354 | 0 |
| 16 | control-panel → pp-toggles → scene-panel | (838,338) 338×380 | pp (1184,94) 300×430 | 0 |
| 17 | control-panel → cctv-panel → scene-panel | (838,338) 298×380 | cctv (1144,152) 340×412 | 0 |
| 18 | control-panel → global-context-panel → scene-panel | (838,338) 318×380 | global (1164,210) 320×354 | 0 |

### 7 张卡单独展开

| 卡 | rect | overlap | 按钮命中/总数 | 被其它卡盖住 | 滚动可到底 | narrow 类 |
|---|---|---|---|---|---|---|
| data-panel | (52,94) 320×380 | 0 | 10/42 | 0 | true | false |
| scene-panel | (52,145) 320×340 | 0 | 11/63 | 0 | true | false |
| pp-toggles | (1184,94) 300×430 | 0 | 15/15 | 0 | – | false |
| cctv-panel | (1144,152) 340×412 | 0 | 8/19 | 0 | true | false |
| global-context-panel | (1164,210) 320×354 | 0 | 3/3 | 0 | true | false |
| location-bar | (530,478) 380×240 | 0 | 6/11 | 0 | true | false |
| control-panel | (838,338) 465×380 | 0 | 14/20 | 0 | true | **false**（465 不算收窄） |

（「命中/总数」差值是**卡片滚动区外**的按钮，卡片 `overflow:auto` 滚到底后可见可点 —— 见 `bottomOk=true`；
这是改动前就有的既有行为，不是本次引入的裁切。）

### 收起后复位

```json
{ "restore_identical": true, "diff": [], "console_errors": 0 }
```

---

## 4. 真实鼠标点击路径复验（不只是 `__gevLc.open()`）

`scripts/qa-expand-click.mjs`：用 `page.mouse.click()` 点卡片空白区（走 App 自己的 pointer/click 逻辑），
data → 右栏 → control 依次展开，等动画 settle 后量：

```
data + pp-toggles + control      overlap 0 | control (838,338) 338×380 | pp (1184,94) 300×430
data + cctv-panel + control      overlap 0 | control (838,338) 298×380 | cctv (1144,152) 340×412
data + global-context-panel + control overlap 0 | control (838,338) 318×380 | global (1164,210) 320×354
console errors: 0
```

---

## 5. 部分收起「空间归还」复验

`scripts/qa-expand-reflow-close.mjs`：

```
OPEN3 (data+pp+control)  overlap=0  control=(838,338) 338×380
CLOSE pp                 overlap=0  control=(838,338) 465×380   ← 让位收窄的 control 自动长回目标宽
                         3 张全关   overlap=0  baselineIdentical=true (diff=[])
console errors: 0
```

即：右栏卡收起后，control 立即恢复 465（不用重新点开），全程无重叠、无抖动残留。

---

## 6. 截图 / 证据文件

| 文件 | 内容 |
|---|---|
| `combo-pp-toggles+control-2x.png` | data+pp+control 三卡展开（2x 全屏） |
| `combo-cctv-panel+control-2x.png` | data+cctv+control（2x 全屏） |
| `combo-global-context-panel+control-2x.png` | data+global+control（2x 全屏） |
| `cmp-seam-pp-toggles.png` | 接缝特写：**上=改前几何(465 压住)** / **下=改后(338 留缝)** |
| `cmp-seam-cctv-panel.png` | 同上（cctv 298） |
| `cmp-seam-global-context-panel.png` | 同上（global 318） |
| `ctrl-338-narrow-2x.png` / `-298-` / `-318-` | control 收窄态内容特写（chip 2 列 4 行、零压字） |
| `ctrl-alone-2x-after.png` | control 单开 465（narrow=false，排版与改前一致） |
| `expand-audit-after.json` | 全部原始数据（7 单开 + 18 combo + 基线/复位 + 每卡按钮/滚动/越界明细） |
| `audit.log` / `click.log` / `evidence.log` | 三次跑批的完整输出 |

截图里 `--hide-scrollbars` 只在 QA 截图里生效，实际浏览器有滚动条。

---

## 7. 回滚

- JS：`src/gev-liquid-cards.js` 里删掉 `reflow()/applyBox()/floatingIds()/PRIORITY` 一段并把 `floatOpen` 的
  定位换回原「`_pre` + `hideCoveredSiblings` + `_pl`」两趟写法即可（`rectOf` 若不回退，只会更准，不影响旧逻辑）。
- CSS：删 `public/gev-liquid-cards.css` 第 11 节（`── 11) 展开卡被横向让位收窄时的内容自保`）整段。
- 两者互不依赖：只回退 CSS → 收窄态 chip 会回到「挤成 5 列 + 压字」；只回退 JS → 回到 3 个 combo 互压。

---

## 8. 顺带发现（未改，仅记录）

1. `data-panel` / `scene-panel` 里「关」按钮每行成对出现且 `cut` 值很大 —— 是卡片滚动区外的内容（可滚），非裁切。
2. `#style-buttons`（视觉预设）是 `overflow:hidden` 的横向列表，465 宽时第 5 个之后的预设**无法滚动到**
   （sw 883 / cw 407）—— 改动前就如此，本次未动。
3. `pp-toggles` 内部有 8 对按钮矩形相交（`btnX=8`）、`scene-panel` 2 对、`location-bar` 1 对 —— 都是各自内部的
   嵌套控件（如 slider 与 track）叠加，与卡片互斥无关，改动前后数量一致。
4. 右栏卡（pp/cctv/global）展开时会把同组兄弟**整块** `visibility:hidden`（`.gev-lc-hid`，原有互斥组逻辑），
   收起时 100% 复原（见 `restore_identical`）。
5. **（既有行为，未改）** 点 dock 卡的标题条**按钮**（如 `#control-panel-toggle`）不会触发浮层展开
   —— `INTERACTIVE` 选择器含 `button`，pointerup 直接返回；只有点卡片空白区才会浮起。
   实测：点该按钮只切 App 的 `.collapsed`（卡片停在 168×86）。`scripts/dbg-dock-toggle.mjs` 可复现。
   与本次互斥修复无关（事件层未动），如需统一交互建议单独开卡。
