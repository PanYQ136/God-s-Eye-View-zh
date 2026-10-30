# P0-5 修复：「显示」面板 17 行互相叠压（`.pp-toggle-group` 被 flex 压扁）

- 日期：2026-10-29
- 任务：kanban `t_2fdb18f0`（父级链路：Phase 3 `t_35c3cbfa` → Phase 4 `t_3a088d2e` → 本卡 → Phase 5 Gate `t_90fb56c3`）
- 写入范围（严格）：`src/lc/material.css` §7 一行规则 + 注释；`scripts/lc/phase3-guards.mjs` G4 断言（护栏，非产品代码）
- 未改：`public/gev-edge-lens.js`（Phase 4 成果）、`src/lc/*.js`（几何/开合唯一所有者）
- 未提交 git

---

## 1. 现象

展开「显示」卡（`#pp-toggles`，300×430，`data-lc-phase=open`，`overflow-y:auto`）后，
17 条 `.pp-slider-row` 互相叠压：**最小相邻间距 −53px，12 组重叠对**。

Phase 4 用 Ego 实测发现，且与液态玻璃无关（`__gevEdge.off()` 下 rect 完全相同）。

## 2. 根因（属性级，非猜测）

DOM 结构：`#pp-toggles` → `.pp-header-row` + `.pp-panel-body{display:contents}` → 9 × `.pp-toggle-group` → 行。

- `.pp-panel-body` 是 `display: contents`（`src/ui/styles/controls.css:379`），所以 9 个 `.pp-toggle-group`
  **直接成为 `#pp-toggles` 的 flex 子项**；而 `#pp-toggles[data-lc-phase='open']` 是
  `display:flex; flex-direction:column`（`material.css:79`）。
- flex 子项默认 `flex-shrink: 1`，`material.css:80` 又写了 `min-height: 0`（自动最小尺寸保护被去掉），
  于是内容总高 1240 > 卡高 430 时，浏览器把组盒**压扁**，而组内行仍按自然高度绘制 → 组内行溢出到组盒外，
  与下方组的内容**交叠**：

```
组盒高度(修复前):    74 / 51 / 19 / 18 / 34 / 9 / 18 / 18 / 9
组 scrollHeight:    314 / 217 / 80 / 76 / 143 / 38 / 76 / 76 / 38
```

- `#pp-toggles` 自身的 `scrollHeight > clientHeight`，滚动本来是开着的 —— 所以问题不在滚动容器，
  只在组盒被收缩。cyber 主题其实早已用正确写法（`cyber.css` 把 `.pp-panel-body` 变回真容器并给
  `> * { flex-shrink: 0 }`），默认主题漏了这一条。

## 3. 改法（唯一 owner：`material.css` §7）

```css
/* 修复前 */
:is(#pp-toggles).gev-lc[data-lc-phase='open'] .pp-toggle-group { display:flex; flex-direction:column;
  align-items:stretch; gap:8px; height:auto; min-height:0; overflow:visible; }

/* 修复后（只加 flex: 0 0 auto，其余不动） */
:is(#pp-toggles).gev-lc[data-lc-phase='open'] .pp-toggle-group { display:flex; flex-direction:column;
  flex:0 0 auto; align-items:stretch; gap:8px; height:auto; min-height:0; overflow:visible; }
```

- 保留 `gap:8` / `height:auto` / `overflow:visible`；
- `.pp-slider-row` 的 `flex:0 0 auto` 与 `min-height:30`（`material.css:81`）未被覆盖，实测行高 30–57；
- `#pp-toggles` **没有**再加 `min-height:0`：加完上面一条后它已正常滚动（`scrollHeight 1240 / clientHeight 430`），
  加它只会重新打开压扁子项的入口。

### 护栏补齐（`scripts/lc/phase3-guards.mjs` G4）

Phase 3 的旧断言只比**同一 `.pp-toggle-group` 内**的行（`if (a.group !== b.group) continue`），
跨组压扁产生的重叠完全漏检，所以当时 5/5 全绿仍是坏的。现在 G4 改为跨组全量：

1. 全部可见行按 `top` 排序后**相邻 gap**（跨组也算）≥ 7.5；
2. **全量两两重叠**（不再按组过滤）= 0；
3. **组盒 `height` 必须 == `scrollHeight`**（`squashed.length === 0`）—— 这条才是直接盯住根因的断言，
   以后再有人动 flex/min-height 会立刻红；
4. 行高 ≥ 29、`scrollHeight > clientHeight`、滚到底末行完整可见。

## 4. 验证（Ego Lite 真指针，主证据）

环境：Ego Lite 0.6.1.13（Chromium 156），`http://127.0.0.1:4173`，视口 1360×780，dpr 1.25，截图 1x CSS px。
GPU：`ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)`，`__gevGpu.probe().tier = high`（硬件 GPU，非 SwiftShader）。

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 真指针点开「显示」等 ≥1.5s | ✅ | `page.click('#pp-toggles .pp-header-row')`，`data-lc-phase=open`，等 1800ms |
| 2 | 17 行按 top 排序后相邻 gap ≥ 8、重叠对 = 0 | ✅ **gap=[8,8,8,8,8,8,54,8,8,8,54,54,54,8,146,54]，min 8，overlap 0** | `report-round01.json → ppOpenTop` |
| 3 | 真滚轮滚到底，末行可见、无重叠 | ✅ `scrollTop 810 / scrollHeight 1240`，末行 `sharpen-slider-row` fullyVisible，`bottomSlack 54`，`elementFromPoint` 命中自身，滚后 overlap 0 / minGap 8 | `report-round01.json → lastRow / ppOpenBottom` |
| 4 | 关闭后 8 张卡 rect 回原位（逐像素） | ✅ 8/8 卡 `data-panel/scene-panel/pp-toggles/cctv-panel/global-context-panel/location-bar/control-panel/gev-voice-control` 差值全 **0** | `report-round01.json → rectDiffs` |
| 5 | 截图 1x + 8x 存 `.gev-logs/ego/pp-rows/` | ✅ `pp-rows-card-1x.png`(300×430) / `pp-rows-top-8x.png`(2400×1680 NEAREST) / `pp-rows-bottom-8x.png`(2400×2112) + before/after mini 对照 | 同目录 |
| 6 | `node --test src/lc/runtime.test.mjs` 9/9 | ✅ 9 pass / 0 fail（含 TC-M6 `material.css ≤300 行 / !important=0 / 双 ID=0`） | 见 §5 |
| 7 | 不提交 git | ✅ `git status` 未 commit | — |

组盒压扁的直接证据（修复后，`report-round01.json → ppOpenTop.groups`）：

```
hud        314 == 314   flex: 0 0 auto
detection  217 == 217   flex: 0 0 auto
models3d    80 ==  80   flex: 0 0 auto
scope       76 ==  76   flex: 0 0 auto
draw       143 == 143   flex: 0 0 auto
celestial   38 ==  38   flex: 0 0 auto
bloom       76 ==  76   flex: 0 0 auto
sharpen     76 ==  76   flex: 0 0 auto
gfx-launch  38 ==  38   flex: 0 0 auto
```

（修复前这里是 74/51/19/18/34/9/18/18/9，与证据表逐项一致。）

目视：`vision` 复核 1x 与 8x 放大图 —— 「各行独立、行间均匀留白、无文字/滑条交叠、无被压扁的行」。

## 5. 交叉验证（真实 Chrome + 新护栏）

`node scripts/lc/phase3-guards.mjs`（Chrome headful 1536×730，非 CDP 旁路）：**5/5 PASS**

```
PASS  G1 旧折叠按钮 DOM = 0
PASS  G2 页面无 + / ◀ / ▶ 文本
PASS  G3 位置面板展开不带动其它卡（≤1px）
PASS  G4 显示卡全量行距/零重叠/组盒不压扁/滚动到底
PASS  G5 中/EN 与 GPU chip 不重叠且各自可点（1536/1280/375）
=== 5/5 PASS ===
```

G4 详情（`.gev-logs/lc/phase3-guards.json`）：`rows 17 / groups 7(含行) / minGap 8 / minInnerGap 8 /
overlapCount 0 / squashed [] / minRowH 30 / scrollH 1240 / clientH 430 / scrolled.visible true`。

`node --test src/lc/runtime.test.mjs`：`tests 9 / pass 9 / fail 0`。

## 6. 复跑方法

```bash
# 1. 起服务（本机已有 4173）
npm run dev            # 或现有 preview 进程

# 2. Ego 真指针验收（1x/8x 截图 + JSON 报告）
ego-browser nodejs -e "await import('file:///C:/Users/13680/ego/pp-rows-20261029/round-02.mjs')"
# 产物：.gev-logs/ego/pp-rows/{report-round01.json,pp-rows-*.png}

# 3. 护栏（跨组全量断言）
"C:/Program Files/nodejs/node.exe" scripts/lc/phase3-guards.mjs
# 产物：.gev-logs/lc/{phase3-guards.json,phase3-guards-rerun.log}

# 4. 单测
node --test src/lc/runtime.test.mjs
```

## 7. 回滚

`src/lc/material.css` §7 删掉 `flex: 0 0 auto;` 一处即回到 Phase 3 状态（会立刻恢复 12 组重叠，
并让 G4 的新断言变红 —— 这正是期望行为）。`scripts/lc/phase3-guards.mjs` 的 G4 可保留，旧版本只
失去跨组覆盖能力，无副作用。

## 8. 遗留 / 边界

- 本卡只动布局与护栏断言，**没有**改 `public/gev-edge-lens.js`、没有改 `src/lc/*.js`。
- 工作树仍含 Phase 3/4 的未提交改动（历史状态），本卡未新增 commit。
- 顺带确认：`#pp-toggles` 展开态滚动条目 `scrollHeight 1240` 与组盒之和对得上，说明 9 个组的自然高度
  全部计入，不再有隐藏的压扁项。
