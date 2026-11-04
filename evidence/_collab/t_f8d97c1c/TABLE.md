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
| 13 | rev control-panel + pp-toggles + data-panel | control (838,338) 338×380<br>pp-toggles (1184,94) 300×430<br>data (52,94) 320×380 | 0 | ✅ |
| 14 | rev control-panel + cctv-panel + data-panel | control (838,338) 298×380<br>cctv (1144,152) 340×412<br>data (52,94) 320×380 | 0 | ✅ |
| 15 | rev control-panel + global-context-panel + data-panel | control (838,338) 318×380<br>global (1164,210) 320×354<br>data (52,94) 320×380 | 0 | ✅ |
| 16 | rev control-panel + pp-toggles + scene-panel | control (838,338) 338×380<br>pp-toggles (1184,94) 300×430<br>scene (52,145) 320×340 | 0 | ✅ |
| 17 | rev control-panel + cctv-panel + scene-panel | control (838,338) 298×380<br>cctv (1144,152) 340×412<br>scene (52,145) 320×340 | 0 | ✅ |
| 18 | rev control-panel + global-context-panel + scene-panel | control (838,338) 318×380<br>global (1164,210) 320×354<br>scene (52,145) 320×340 | 0 | ✅ |

### 6 个倒序复验（dock→右→左，验证与打开顺序无关）

| # | 打开顺序 | control-panel rect | 右栏卡 rect | overlap |
|---|---|---|---|---|
| 1 | control-panel → pp-toggles → data-panel | (838,338) 338×380 | pp-toggles (1184,94) 300×430 | 0 |
| 2 | control-panel → cctv-panel → data-panel | (838,338) 298×380 | cctv-panel (1144,152) 340×412 | 0 |
| 3 | control-panel → global-context-panel → data-panel | (838,338) 318×380 | global-context-panel (1164,210) 320×354 | 0 |
| 4 | control-panel → pp-toggles → scene-panel | (838,338) 338×380 | pp-toggles (1184,94) 300×430 | 0 |
| 5 | control-panel → cctv-panel → scene-panel | (838,338) 298×380 | cctv-panel (1144,152) 340×412 | 0 |
| 6 | control-panel → global-context-panel → scene-panel | (838,338) 318×380 | global-context-panel (1164,210) 320×354 | 0 |

### 7 张卡单独展开

| 卡 | rect | overlap | 按钮 (命中/总数) | 被其它卡盖住 | 滚动可到底 | narrow 类 |
|---|---|---|---|---|---|---|
| data-panel | (52,94) 320×380 | 0 | 10/42 | 0 | true | false |
| scene-panel | (52,145) 320×340 | 0 | 11/63 | 0 | true | false |
| pp-toggles | (1184,94) 300×430 | 0 | 15/15 | 0 | null | false |
| cctv-panel | (1144,152) 340×412 | 0 | 8/19 | 0 | true | false |
| global-context-panel | (1164,210) 320×354 | 0 | 3/3 | 0 | true | false |
| location-bar | (530,478) 380×240 | 0 | 6/11 | 0 | true | false |
| control-panel | (838,338) 465×380 | 0 | 14/20 | 0 | true | false |

### 收起全部后 vs 基线

```json
{
 "restore_identical": true,
 "diff": [],
 "console_errors": 0
}
```