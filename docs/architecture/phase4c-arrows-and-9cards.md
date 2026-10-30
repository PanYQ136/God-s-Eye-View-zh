# Phase 4C：旧 ◀/▶ 字符清零 + 9 张卡定义核实

日期：2026-10-29 06:03–06:45 · 任务 `t_b2c96219` · 浏览器 Ego Lite (Chromium 156)，真实指针点击

## 1. 结论

| 验收项 | 结果 | 证据 |
|---|---|---|
| 页面 ◀/▶ 计数 = 0 | ✅ 0（改前 10 个文本节点 / 14 个字符） | 逐状态测量，见 §3 |
| 7 header 仍可开合 | ✅ 8 张卡全部 `mini→open`，`scene/global-context` 实测回 `mini` | 真实鼠标 `Input.dispatchMouseEvent` |
| 9 张卡定义明确 | ✅ 8 张可折叠卡 + `gev-gfx-fab`（chrome 轨、`expandable:false`） | 全部带 `.gev-lc` |
| 硬件 GPU | ✅ `ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)` | `WEBGL_debug_renderer_info` |

## 2. 为什么之前清不掉

1. 箭头是**模板里的 Unicode 字符 + JS `textContent` 字符赋值**，不是 CSS 生成的图形，按“旧折叠按钮 DOM”去找永远找不到。
2. G2 护栏（`scripts/lc/phase3-guards.mjs`）只扫 `#left-panel-stack / #right-context-rail / #command-dock / #lc-stage` 四个 root，且只认「整段文本全是符号」的节点 —— `◀ SEEK` 这种混合文本直接漏检，所以护栏长期显示 0。
3. `#cockpit-utility-controls`、`#radio-panel`（SDR）、`bhote-event` 面板都在上述 root 之外。

## 3. 测量（每态 DOM 文本节点数 / 可见数）

```
初始            dom 0 / visible 0 / innerText=false
data-panel      dom 0 / visible 0   (mini→open)
scene-panel     dom 0 / visible 0   (open→mini)
pp-toggles      dom 0 / visible 0   (mini→open→mini)
cctv-panel      dom 0 / visible 0
global-context  dom 0 / visible 0   (open→mini)
location-bar    dom 0 / visible 0
control-panel   dom 0 / visible 0
gev-voice-control dom 0 / visible 0
打开电台 dock 后 dom 0 / visible 0
```

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/ui/templates/cockpit.html` | 2 个展开开关去掉 `◀`；3 个 transport `◀◀ ▶ ▶▶` → `.lc-tri` |
| `src/ui/templates/context.html` | mini transport 3 个 + `◀ SEEK / SEEK ▶` → `.lc-tri` + 文本 |
| `src/ui/radioBindings.js` | 删除 `textContent = open ? '▶' : '◀'` 两处 |
| `src/ui/radioPresentation.js` | 播放/暂停 `Ⅱ/▶` → `PLAY_HTML/PAUSE_HTML` |
| `src/layers/launches/replay.js` | 回放按钮同样改图形 |
| `src/data/bhoteKoshiEvent.js` | `▶ PLAY/PLAY SHOT/PLAY SCENE`、`Ⅱ PAUSE` → 纯文字 |
| `src/ui/styles/cockpit.css` | 新增 `.lc-tri/.lc-pause/.cockpit-utility-glyph::after/#sdr-seek-*` |
| `src/cockpitMarkup.test.mjs` | 4 条断言 → “模板/绑定不得出现 \u25C0\u25B6” |
| `src/data/bhoteKoshiEvent.test.mjs` | 去掉箭头字符断言 |

未动：`gev-edge-lens.js`、`src/lc/*.js`、`material.css` 的 pp 段、FPS 相关任何参数。

## 5. 9 张卡定义（`src/lc/cards.js`）

| # | id | rail | expandable |
|---|---|---|---|
| 1 | data-panel | left | ✅ |
| 2 | scene-panel | left | ✅ |
| 3 | pp-toggles | right | ✅ |
| 4 | cctv-panel | right | ✅ |
| 5 | global-context-panel | right | ✅ |
| 6 | location-bar | dock | ✅ |
| 7 | control-panel | dock | ✅ |
| 8 | gev-voice-control | dock | ✅ |
| 9 | **gev-gfx-fab** | chrome | ❌ 只上玻璃皮、不展开 |

`CARD_IDS` 只含前 8 张（`expandable:true`），`start()` 对 `CARD_IDS.concat(['gev-gfx-fab'])` 统一加 `.gev-lc`。
「初始只命中 8 张」的两个真实原因：① 用 `[data-lc-id]` 探测（代码里根本没有该属性，卡是按 id + `.gev-lc` 标记）；② `#gev-voice-control` 由 dock 后注入，`waitReady` 未就绪前页面没有 `.gev-lc`。

## 6. 遗留

G2 护栏判据仍是「整段纯符号」。建议改成「任何可见文本含 `◀▶▸◂+/−` 即失败」，否则同类字符残留会再次漏检。
