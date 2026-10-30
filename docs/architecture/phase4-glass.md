# Phase 4 · 恢复可控液态玻璃（无色带 / 无灰圈 / 中心透明）

- 日期：2026-10-29
- 任务：kanban `t_3a088d2e`（父：`t_35c3cbfa` Phase 3；子：`t_90fb56c3` Phase 5 Gate）
- 写入范围（严格按《最佳工作路径》S3）：`public/gev-edge-lens.js`（唯一行为改动）、`src/lc/material.css`（仅注释/token 文档）
- 验收工具：**Ego Lite 0.6.1.13**（chromium 156.0.8078.48 / node v24.22.1），`http://127.0.0.1:4173`
- 未提交 git。

---

## 1. 结论

液态玻璃回来了，而且是**受控的单层**：

| 验收项 | 结果 | 证据 |
|---|---|---|
| `dispPx` 在 0.8–1.5 | **1.2** ✅ | `__gevEdge.stats()` → `dispPx:1.2` |
| 8x 边缘可见液态折射 | **是** ✅ | `H2-pp-top-8x.png` / `H-data-tl-8x.png` / `p4-final-pp-tr-8x.png` |
| 无 R/G/B 大色带、无锯齿 | **是** ✅ | 白/灰测试纹理通道间距 0.48px；真实地图 8x 无可见彩边 |
| 无外圈+内圈双灰线 | **是** ✅ | 四边差值：上沿 +27.2 / 右沿 +5.1 / 左沿 +0.3 / 下沿 -0.1（未受光边没有线） |
| 中心透明、无磨砂/暗底 | **是** ✅ | 面板中心 60×20 区域差值 **0.00**；8 卡 DOM 扫描 0 个不透明填充/0 个 backdrop-filter/0 个 border |
| 动画/布局/旧按钮 P0 不破坏 | **旧按钮 0** ✅ / 7 卡开合往返 rect 逐像素回位 ✅ / 动画时长未动 ✅ / ⚠️ **pp 行重叠是 Phase 3 遗留布局缺陷（见 §7）** |
| FPS ≥30 | **⚠️ 本机无法复现** | 见 §6：透镜自身开销 ≈0–20%，绝对帧率被宿主（Intel UHD + 2.8GB 空闲内存）压到 9–19fps |
| 不提交 git | ✅ | `git status` 未 commit |

---

## 2. 参数（最终值，单一来源 `public/gev-edge-lens.js` CFG）

```js
band: 10,          // 高光带宽度 CSS px（不放大）
thick: 6,          // Snell 坡度尺度（Phase 3 是 4；倒角更明显）
ior: 1.52,         // 物理玻璃折射率
gain: 1.0,         // 折射位移（受控区间 0.6–1.0，取上限）
dispPx: 1.2,       // 边缘色散（受控区间 0.8–1.5）
blurPx: 0.7,       // 斜面柔化（只在 band 内，<1px）
rimAmt: 0.80,      // 镜面高光强度（单一光源）
bandAlpha: 0.55,   // band 半透（新增；1 = 实心替换底图 = 灰圈）
innerDark: 0, aa: 1.2, feather: 6, bandFrac: 0.20, bandMin: 7,
```

实际渲染：`scale = min(dpr,1.5) = 1.25`，画布 1685×958（视口 1348×766）。

---

## 3. 三个真根因（不是「参数调大调小」的问题）

### 3.1 灰圈真因：premultipliedAlpha 与输出不匹配（符号级 bug）

`gl.getContext('webgl2', { premultipliedAlpha: false })`，但着色器写的是**预乘**颜色
`o = vec4(col, a)`，且 `blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` 让
framebuffer 里落地的已经是 `col × a`。合成器按 straight-alpha 再乘一次 `a` ⇒
band 亮度被 **平方衰减**。

实测（白色测试纹理，band 核心应为 255）：

| bandAlpha | 修复前屏幕值 | 应有值 | 修复后屏幕值 |
|---|---|---|---|
| 1.0 | 172 | 255 | — |
| 0.55 | **117**（灰） | 183 | **181** ✅ |

`readPixels` 原始值 `140,140,140,140`（RGB == A，证明已是预乘）→ 4 条边一圈均匀变暗，
这就是「灰带/灰圈」在数值上的唯一来源，与 band 宽度、色散都无关。

**修复**：`premultipliedAlpha: true` + `o = vec4(col * a, a)` + `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`。

### 3.2 外圈亮线真因：全周恒定 5% 白线

旧着色器有 `line = smoothstep(1.5*uScale, 0.2*uScale, depth) * 0.05` —— 对四条边**一样**，
所以差值图上看就是一圈闭合外亮线（P0-1 的「外圈」）。已删除，只保留单向光源的镜面高光。

### 3.3 内圈暗线真因：band 实心替换底图 + 双向法线高光

- band `alpha=1` 会把底图按 1–2px 位移后的**重影**原样贴回来 → 外亮、内暗两条平行线。
  现在 band 是半透折射层（`bandAlpha 0.55`），重影只剩 ~50% 对比，读成玻璃斜面而不是描边。
- 旧高光是 `dot(n, d1) + dot(n, -d1)`（两条互为反向的 45°），四条边算出来都是 0.55 ⇒
  又变成一圈闭合亮线。现在改成**单一光源** `L = normalize(0.45, -0.89)`（上沿 + 右沿受光，
  左/下沿完全不出线），`rim` 还给一份不透明度 ⇒ 受光边是「擦亮的一条边」，四周不闭合。

---

## 4. 目视验收（Ego 真指针 + 真实地图纹理）

全部截图在 `.gev-logs/ego/p4/`，1x 为 Ego 原生截图（CSS px），4x/8x 为 NEAREST 放大
（Ego 截图是 1x，**放大用原图裁剪而非改 deviceScaleFactor**，避免重采样掩盖问题）。

| 文件 | 内容 | 目视结论 |
|---|---|---|
| `F-mini-1x.png` / `H-data-4x.png` / `H-data-tl-8x.png` | 迷你卡（数据图层）1x/4x/8x | 单层方向性高光，无外圈+内圈双线，无彩边，边缘内侧底图轻微位移 |
| `H2-pp-3x.png` / `H2-pp-top-8x.png` / `H2-pp-tr-8x.png` | 「显示」面板展开 3x/8x | 上沿 + 右沿可见玻璃高光；左/下沿干净；无闭合描边；中心透明无磨砂/暗底；无彩虹带；边缘内侧有轻微折射 |
| `p4-final-loc-3x.png` | 「位置」面板展开 3x | 同上（大幅面 dock 面板走同一规则，未单独放大位移） |
| `p4-open-*.png`（7 张） | data/scene/pp/cctv/context/location/control 逐卡截图 | 7 卡均可用真指针开合，展开态玻璃一致 |
| `K-pp-on/off/on2.png`、`F-loc-on/off/on2.png` | A/B 原图（同机位、同帧） | 差值分析见 §5 |

---

## 5. 数值验收（同机位 A/B：`lens on` − `lens off`）

「显示」面板 300×430（最终参数）：

| 边 | 平均 ΔL | 最大 ΔL | 最小 ΔL |
|---|---|---|---|
| 上沿 | **+27.2** | +53.3 | +4.3 |
| 右沿 | **+5.1** | +18.3 | −6.7 |
| 左沿 | +0.3 | +6.0 | −5.0 |
| 下沿 | −0.1 | +4.3 | −8.0 |
| 面板中心 60×20 | **+0.00** | **0.0** | — |

- 上/右受光、左/下无线 ⇒ **不是闭合描边**；
- 任何一条边都没有系统性变暗（min 只到 −8 的单像素噪声）⇒ **没有灰圈**；
- 中心差值精确为 0 ⇒ **完全透明，无 veil/无 blur/无 tint**；
- `on` 与 `on2` 两次独立渲染的面板区域漂移 0.24（地图噪声）⇒ 可复现。

「位置」面板 476×88（同一参数）：上 +22.3 / 右 +5.9 / 左 −1.1 / 下 +1.5。

### 色散量测（灰阶测试纹理，R=G=B，通道差异只能来自着色器）

着色器定义：`R/G/B` 采样系数 0.82 / 1.00 / 1.22 ⇒ 通道间距 = `0.4 × dispPx`
= **0.48 CSS px（0.6 device px）**。

硬边条纹实测（常数 alpha 区间内找每通道 50% 交叉点）：R−B = 2.15 device px =
**1.72 CSS px**（含 0.7px 模糊的斜坡展宽），**< 2px 上限**；真实地图上 8x 目视无彩边
（地图是软过渡，0.48px 的通道偏移落在同一像素内）。

---

## 6. FPS（诚实结论）

宿主：`ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11)`，RTX 3060 利用率 0%
（Cesium 落在核显），空闲物理内存 2.8GB/15.78GB，同机还有另一个 Cesium 页面（另一个 Ego space）。

| 测法 | lens on | lens off | 结论 |
|---|---|---|---|
| 交错 A/B（静止相机 + 每帧 requestRender，各 4s ×3 轮） | 8.7 / 11.5 / 9.2（中位 9.2） | 10 / 10.5 / 6.7（中位 10） | 透镜开销 ≤ ~20%，绝对帧率被宿主压住 |
| 会话早期（宿主较空，单页） | 33（lens 自测 p50） | 30.4（页面 rAF） | 透镜不掉帧 |
| 当前空闲/拖动 | 18.6 / 14.5 | — | ≥30 目标本机不可复现 |

**结论**：Phase 4 没有引入 FPS 回归（lens on/off 差值在噪声内），但「≥30fps」这条在本机
无法作为通过证据 —— 与 Phase 3 的 T16 红项同因（宿主内存 + 核显）。留 Phase 5 Gate 判定。

---

## 7. 顺带发现（不属于 S3 范围，已开后续卡）

**「显示」面板行重叠是真的**：9 个 `.pp-toggle-group` 作为 `#pp-toggles[data-lc-phase=open]`
（固定 430px 高、`overflow-y:auto`）的 flex 子项被压缩 —— 例如某组盒子高 74px 而
`scrollHeight=314`，于是组内行按自然高度绘制、彼此叠压：

```
17 行 .pp-slider-row，最小相邻间距 -53px，重叠对 12 组
组盒高度: 74 / 51 / 19 / 18 / 34 / 9 / 18 / 18 / 9
组 scrollHeight: 314 / 217 / 80 / 76 / 143 / 38 / 76 / 76 / 38
```

`material.css` 当前规则 `… .pp-toggle-group { display:flex; flex-direction:column; gap:8px;
height:auto; min-height:0; overflow:visible }` 缺一个 `flex: 0 0 auto`（禁止收缩）。
与 Phase 4 无关（本卡只改 canvas 着色器与注释；`__gevEdge.off()` 下 rect 完全相同），
属于 S2 布局所有权，已另开卡给 `default`，并要求 Phase 5 Gate 等它完成。

---

## 8. P0 回归检查

- 旧折叠按钮 `.panel-collapse-btn/.pp-collapse-btn`：**0**；可见文本里 `+ / ◀ / ▶`：**0**。
- 7 卡真指针开合一轮后，8 张卡 rect 与初始**逐像素一致**（`accept-round11.json`：BEFORE == AFTER）。
- 8 卡 DOM 扫描：0 个 ≥40×40 的不透明填充、0 个 `backdrop-filter`、0 个 border；
  卡壳统一 `background: rgba(0,0,0,0)` / `backdrop-filter:none` / `border:0` / 单层投影 `0 2px 10px rgba(0,0,0,.14)`。
- `src/lc` 单测：`node --test src/lc/runtime.test.mjs` → **9/9 pass**（TC-M6 硬门槛、TC-M7 零填充/零 blur/零描边 + token 一致 均绿）。
- 旧 `lg-glass` / `gev-liquid-cards`：运行时代码 0 引用（仅历史注释与 `scripts/_archive` 遗留脚本）。

---

## 9. 回滚

1. `cp docs/architecture/rollback/gev-edge-lens.phase3.js public/gev-edge-lens.js`
   —— 已按 Phase 3 的 13 处编辑逐条反转重建，`node --check` 通过，`Phase 4`/`uBandAlpha`/
   `premultipliedAlpha: true` 出现次数均为 0，行为等价于 Phase 3（纯平面 + 极淡高光）。
2. `src/lc/material.css` 本阶段只加了 §2 注释块，删除该注释块即可回滚（无行为差异）。
3. 不改 git（工作树含 Phase 3 未提交改动，禁止 stash/checkout 整文件）。

---

## 10. 给 Phase 5 Gate 的操作提示

- 透镜只有在 **Cesium postRender** 时才会重绘（纹理直传）。脚本里调用 `__gevEdge.off()/on()`
  之后**必须**踢一帧（`viewer.scene.requestRender()` 若干次）否则画布是空的，A/B 会得到全 0 差值。
- Ego 截图是 **1x CSS px**；4x/8x 用「截图裁剪 + NEAREST 放大」，不要改 deviceScaleFactor。
- Ego 窗口被最小化时 `screenshot()` 直接报 `Cannot capture a screenshot while the window is minimized`，
  用 `ShowWindow(hwnd, SW_SHOW)` + `SetWindowPos` 恢复，不要新建 space。
- Ego 的 tab 在关闭最后一个 tab 后整个窗口会被隐藏，`task.newPage()` 会拿到 0×0 视口 —— 先恢复窗口再开页。
