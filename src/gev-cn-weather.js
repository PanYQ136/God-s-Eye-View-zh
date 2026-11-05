/**
 * gev-cn-weather — 和风天气胶囊 + 中文气象预警浮层 + 预警→图层联动（A5 + B1）。
 *
 * 零侵入增强层：本文件独立，由 `boot-defer.js` 的 DEFERRED 动态装载，
 * 不走主链、不改路由、不改任何应用源码。删除该文件与 DEFERRED 里那一行即完全还原。
 *
 * 数据：`GET /api/cn/weather?lat=&lng=`（server/providers/cn-live.js 已实现，
 * 服务端 10min 缓存）。字段以该 handler 的实际返回为准：
 *   { source, at, ok, now{temp,text,icon,windDir,windScale,windSpeed,humidity,
 *     precip,pressure,vis,obsTime}, alerts[{id,title,severity,type,desc,sender,
 *     start,end}], alertsCount, daily[] }
 * 注意：服务端**没有**透出 `level` / `text` / `startTime` 这几个字段；预警等级
 * 只能从 `title` 的「蓝/黄/橙/红」字样或 `severity` 推断，`alerts` 最多 5 条，
 * 总数看 `alertsCount`。
 *
 * 边界（见 docs/CODE-BOUNDARIES.md / docs/小程序能力反向移植清单.md §3）：
 *  · 顶层不读 seam —— DEFERRED 与 bootstrap 并行求值，此时 `window.__godsEyeView`
 *    尚未设置；viewer 用 500ms×300 轮询等就绪（样板 src/gev-dossier.js 尾部）。
 *  · 首次天气请求放在 viewer 就绪之后，不在顶层发。
 *  · 不使用 npm `cesium`；相机飞行照 src/gev-locate.js 的 ellipsoid 写法。
 *  · 样式在运行时注入，且必须进 `@layer overrides`（不进层会整体压掉分层 App CSS），
 *    overrides 层内不使用 `!important`。
 */
import { gcj02ToWgs84 } from './layers/cnAdmin/model.js';
import { announceNavigationAuthority } from './navigationPolicy.js';

(function () {
  if (window.__gevCnWeather) return;

  const RAD = Math.PI / 180;
  const REFRESH_MS = 10 * 60 * 1000; // 与小程序 10min 定时器 / 服务端 10min TTL 对齐
  const STALE_MS = 60 * 60 * 1000; // 观测时间 > 60min 视为过期
  const FETCH_TIMEOUT_MS = 6000;
  const CAMERA_MOVE_DEG = 0.5; // 相机移动超过 0.5° 才重取
  const JUMP_BUDGET_MS = 2500; // 点位解析总预算（从点击起算）
  const LAYER_SOFT_MS = 1200; // 图层启用软超时（超时继续走回退）
  const JUMP_TTL_MS = 30 * 60 * 1000;
  const JUMP_NEAR_KM = 50;
  const REPEAT_GUARD_MS = 3000; // 同 alert id 3s 内不重复触发
  const ALERT_MAX = 5; // 服务端 alerts 上限

  // 中国包络，与 layers/cnAdmin/model.js 的 outOfChina 保持同一组数
  const CN = { minLng: 73.66, maxLng: 135.05, minLat: 3.86, maxLat: 53.55 };

  const LEVEL_RANK = { blue: 1, yellow: 2, orange: 3, red: 4 };
  const LEVEL_CHAR = { blue: '蓝', yellow: '黄', orange: '橙', red: '红' };

  /** 台风 / 地震（有图层）/ 无图层但可定位 / 其他 */
  const TYPHOON_RE = /台风|热带风暴|强热带风暴|超强台风|飓风/;
  const QUAKE_RE = /地震|余震/;
  const PLACE_RE =
    /暴雨|强对流|雷电|冰雹|大风|高温|大雾|霾|寒潮|暴雪|沙尘|道路结冰|山洪|地质灾害/;
  const PLACE_NAME_RE = /[\u4e00-\u9fa5]{2,8}(?:市|县|区|州|盟|旗|镇|乡)/;

  const LAYER_LABEL = { 'cn-typhoon': '台风', 'cn-quakes': '地震' };
  const FLY = {
    typhoon: { height: 1200000, duration: 2.4 },
    quake: { height: 200000, duration: 2.2 },
    place: { height: 55000, duration: 2.2 },
  };
  const FLY_REDUCED_DURATION = 0.35;

  const ICON_SVG = {
    sun: '<circle cx="7" cy="7" r="2.5"/><path d="M7 1.1v1.4M7 11.5v1.4M1.1 7h1.4M11.5 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1"/>',
    cloudy:
      '<circle cx="5.1" cy="4.7" r="2.1"/><path d="M3.5 10.9h6a2.2 2.2 0 0 0 .2-4.4 3 3 0 0 0-5.7-.5 2.2 2.2 0 0 0-.5 4.9Z"/>',
    overcast:
      '<path d="M3.4 11h6.3a2.3 2.3 0 0 0 .2-4.6 3.1 3.1 0 0 0-5.9-.5 2.3 2.3 0 0 0-.6 5.1Z"/>',
    rain: '<path d="M3.4 9.3h6.3a2.3 2.3 0 0 0 .2-4.6 3.1 3.1 0 0 0-5.9-.5 2.3 2.3 0 0 0-.6 5.1Z"/><path d="M4.4 11.1l-.7 1.6M7 11.1l-.7 1.6M9.6 11.1l-.7 1.6"/>',
    snow: '<path d="M3.4 9.1h6.3a2.3 2.3 0 0 0 .2-4.6 3.1 3.1 0 0 0-5.9-.5 2.3 2.3 0 0 0-.6 5.1Z"/><path d="M4.6 11.2h.01M7 12.2h.01M9.4 11.2h.01" stroke-width="1.8"/>',
    thunder:
      '<path d="M3.4 8.9h6.3a2.3 2.3 0 0 0 .2-4.6 3.1 3.1 0 0 0-5.9-.5 2.3 2.3 0 0 0-.6 5.1Z"/><path d="M7.6 9.4l-1.5 2.1h1.3l-.7 1.7"/>',
    fog: '<path d="M2.4 5.2h9.2M3.4 7.6h7.2M2.4 10h9.2"/>',
    wind: '<path d="M2.2 5.4h6.1a1.7 1.7 0 1 0-1.7-1.7M2.2 8.6h7.9a1.6 1.6 0 1 1-1.6 1.6M2.2 11.6h4.4"/>',
    unknown:
      '<circle cx="7" cy="7" r="5.2"/><path d="M5.6 5.6a1.5 1.5 0 0 1 2.9.4c0 1-1.4 1.2-1.4 2.1"/><path d="M7 10.4h.01"/>',
  };

  /* 布局段与设计规范逐条对齐（四条互斥泳道）；组件皮肤在本段之后。
     overrides 层内不使用 !important —— 同层靠先后顺序与特异性取胜。 */
  const STYLE = `
  :root{
    --gev-ok:#5EF1A6; --gev-warn:#FFB44D; --gev-bad:#FF5A52; --gev-unknown:#9AA3AD;
    --gev-building:#8AE0FF;
    --gev-alert-blue:#4A9EFF; --gev-alert-yellow:#FFC53D;
    --gev-alert-orange:#FF8A2B; --gev-alert-red:#FF5A52;
  }

  /* 左上锚定簇：天气胶囊 + 预警横幅并排，不再跨全宽，避免与右栏 / 顶中按钮行相撞 */
  #gev-cn-band{ position:fixed; top:64px; left:var(--left-stack-x,52px); right:auto;
    width:max-content; max-width:calc(100vw - 104px);
    display:flex; align-items:flex-start; gap:8px; z-index:var(--z-hud,100);
    pointer-events:none; font-family:var(--font-sans); box-sizing:border-box; }
  #gev-cn-band>*{ pointer-events:auto; }
  /* 列表打开时抬到弹窗层，避免被侧栏（--z-panel:110）盖住 */
  #gev-cn-band.has-popover{ z-index:var(--z-popup,200); }

  .gev-wx-alerts{ max-width:560px; }
  @media (min-height:561px) and (min-width:761px) and (max-width:1123px){
    .gev-wx-alerts{ max-width:420px; }
  }
  /* 横屏矮屏但宽度 ≥1024：左右两条窄侧栏仍在，簇整体让到左栏右侧 */
  @media (orientation:landscape) and (max-height:560px) and (min-width:1024px){
    #gev-cn-band{ top:88px; left:calc(min(250px,38vw) + 24px); right:auto; }
    .gev-wx-alerts{ max-width:560px; }
  }
  @media (orientation:landscape) and (max-height:560px) and (max-width:1023px){
    #gev-cn-band{ top:6px; left:50%; right:auto; transform:translateX(-50%);
      max-width:min(240px, calc(100vw - 520px)); justify-content:center; gap:8px; }
    .gev-wx-alerts{ flex:0 1 auto; max-width:240px; }
    #gev-cn-band .gev-wx-wind, #gev-cn-band .gev-wx-text, .gev-hl-label{ display:none; }
  }
  @media (orientation:landscape) and (max-height:560px) and (max-width:759px){
    #gev-cn-band .gev-hl{ display:none; }
  }
  @media (orientation:landscape) and (max-height:560px) and (max-width:639px){
    #gev-cn-band .gev-wx-temp, .gev-wx-alert-title, .gev-wx-alert-meta{ display:none; }
    .gev-wx-alert-go{ display:none; }
  }
  @media (orientation:landscape) and (max-height:560px) and (max-width:599px){
    #gev-cn-band .gev-wx-summary{ display:none; }
  }
  @media (max-width:760px) and (orientation:portrait){
    #gev-cn-band{ top:calc(env(safe-area-inset-top,0px) + 132px); left:12px; right:12px;
      flex-wrap:wrap; row-gap:6px; }
    #gev-cn-band .gev-wx-wind{ display:none; }
    #gev-cn-band .gev-wx-temp{ font-size:16px; }
    /* 预警独占第二排 */
    #gev-cn-alert{ flex:1 1 100%; }
  }
  body.cockpit-mode #gev-cn-band:not(.has-popover){
    top:max(var(--gev-band-top, calc(env(safe-area-inset-top,0px) + 64px)),
      calc(env(safe-area-inset-top,0px) + 64px));
    /* 座舱 HUD 是 z145：不抬高层级会被整块盖住；打开弹层时交给下面的 popup 规则 */
    z-index:148;
  }
  /* 座舱里打开详情/列表：148 的特异性会压过 .has-popover，这里显式抬回弹窗层 */
  body.cockpit-mode #gev-cn-band.has-popover{
    top:max(var(--gev-band-top, calc(env(safe-area-inset-top,0px) + 64px)),
      calc(env(safe-area-inset-top,0px) + 64px));
    z-index:var(--z-popup,200);
  }
  body.ui-clean-view #gev-cn-band,
  body.recording-mode #gev-cn-band{ display:none; }
  @media (prefers-reduced-motion: reduce){
    #gev-cn-band *, #traffic-sync-chip, #cctv-sync-chip, #top-center-actions #gev-cn-health-chip{
      animation:none; transition:none; transform:none;
    }
  }

  /* ── 天气胶囊容器 ───────────────────────────────────────── */
  .gev-wx{ position:relative; flex:0 0 auto; display:flex; align-items:flex-start; }
  #gev-cn-band .gev-wx-summary{
    display:inline-flex; align-items:center; gap:7px;
    height:30px; min-width:118px; padding:0 10px; border-radius:999px;
    background:var(--glass-bg); border:1px solid var(--glass-border, rgba(255,255,255,.14));
    backdrop-filter:blur(16px) saturate(1.4);
    -webkit-backdrop-filter:blur(16px) saturate(1.4);
    color:#C9D6E2; font-family:var(--font-sans); font-size:12px; line-height:1;
    cursor:pointer; -webkit-appearance:none; appearance:none;
    box-sizing:border-box; white-space:nowrap;
    transition:
      background-color var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast),
      transform var(--transition-fast);
  }
  #gev-cn-band .gev-wx-summary:hover{
    background:rgba(255,255,255,.06);
    border-color:var(--glass-border-hover, rgba(255,255,255,.28));
    transform:scale(1.1);
  }
  #gev-cn-band .gev-wx-summary:active{ transform:scale(.95); }
  #gev-cn-band .gev-wx-summary:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; }
  #gev-cn-band .gev-wx-summary[aria-disabled='true']{ cursor:default; }
  #gev-cn-band .gev-wx-summary[data-state='stale']{ border-bottom:1px dashed rgba(255,180,77,.85); }
  #gev-cn-band .gev-wx-summary[data-state='stale'] .gev-wx-temp{ color:#FFE0B0; }
  #gev-cn-band .gev-wx-summary[data-state='error'],
  #gev-cn-band .gev-wx-summary[data-state='empty']{
    color:var(--gev-unknown); background:rgba(8,14,20,.86);
  }
  #gev-cn-band .gev-wx-summary[data-state='error'] .gev-wx-text,
  #gev-cn-band .gev-wx-summary[data-state='empty'] .gev-wx-text{ color:var(--gev-unknown); }
  #gev-cn-band .gev-wx-ico{ width:14px; height:14px; flex:0 0 auto; display:inline-flex;
    color:var(--gev-building); }
  #gev-cn-band .gev-wx-ico svg{ width:14px; height:14px; display:block; }
  #gev-cn-band .gev-wx-temp{ font-size:17px; font-weight:600; color:#EAF4FF;
    font-variant-numeric:tabular-nums; }
  #gev-cn-band .gev-wx-text{ color:#C9D6E2; }
  #gev-cn-band .gev-wx-wind{ color:var(--gev-unknown); font-size:11px; }
  #gev-cn-band .gev-wx-caret{ width:0; height:0; margin-left:1px; opacity:.7;
    border-left:3.5px solid transparent; border-right:3.5px solid transparent;
    border-top:4px solid currentColor; transition:transform .18s ease; }
  #gev-cn-band .gev-wx-summary[aria-expanded='true'] .gev-wx-caret{ transform:rotate(180deg); }

  .gev-wx-detail{
    position:absolute; left:0; top:36px; z-index:2;
    display:grid; gap:6px; width:238px; box-sizing:border-box;
    padding:9px 10px; border-radius:10px;
    background:var(--glass-bg); border:1px solid var(--glass-border, rgba(255,255,255,.14));
    backdrop-filter:blur(18px) saturate(1.4);
    -webkit-backdrop-filter:blur(18px) saturate(1.4);
    color:#C9D6E2; font-family:var(--font-sans); font-size:11px; line-height:1.35;
    box-shadow:0 10px 28px rgba(0,0,0,.42);
  }
  .gev-wx-detail[hidden]{ display:none; }
  .gev-wx-grid{ display:grid; grid-template-columns:1fr 1fr; gap:5px 10px; margin:0; }
  .gev-wx-grid > div{ display:flex; justify-content:space-between; gap:6px; min-width:0; }
  .gev-wx-grid dt{ color:var(--gev-unknown); white-space:nowrap; }
  .gev-wx-grid dd{ margin:0; color:#EAF4FF; text-align:right; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .gev-wx-src{ font-size:10px; color:var(--gev-unknown);
    border-top:1px solid rgba(255,255,255,.08); padding-top:5px; }

  /* ── 预警横幅 ───────────────────────────────────────────── */
  .gev-wx-alerts{ position:relative; flex:0 1 auto; min-width:0;
    display:flex; align-items:center; gap:6px; }
  .gev-wx-alerts[hidden]{ display:none; }
  #gev-cn-band .gev-wx-alert-main{
    display:inline-flex; align-items:center; gap:8px; height:30px; min-width:0;
    padding:0 10px 0 13px; box-sizing:border-box; position:relative; overflow:hidden;
    border:0; border-radius:8px;
    background:color-mix(in srgb, var(--gev-alert,var(--gev-unknown)) 12%, rgba(8,14,20,.72));
    backdrop-filter:blur(16px) saturate(1.4);
    -webkit-backdrop-filter:blur(16px) saturate(1.4);
    color:#C9D6E2; font-family:var(--font-sans); font-size:12px; line-height:1;
    cursor:pointer; text-align:left;
    transition:
      background-color var(--transition-fast),
      border-color var(--transition-fast),
      transform var(--transition-fast);
  }
  #gev-cn-band .gev-wx-alert-main::before{
    content:''; position:absolute; left:0; top:0; bottom:0; width:3px;
    background:var(--gev-alert,var(--gev-unknown)); border-radius:8px 0 0 8px;
  }
  #gev-cn-band .gev-wx-alert-main:hover{
    background:color-mix(in srgb, var(--gev-alert,var(--gev-unknown)) 20%, rgba(8,14,20,.72));
    transform:scale(1.04);
  }
  #gev-cn-band .gev-wx-alert-main:active{ transform:scale(.97); }
  #gev-cn-band .gev-wx-alert-main:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; }
  #gev-cn-band .gev-wx-alert-main.is-jumping{
    background:color-mix(in srgb, var(--gev-alert,var(--gev-unknown)) 30%, rgba(8,14,20,.72));
  }
  #gev-cn-alert[data-level='blue']{ --gev-alert:var(--gev-alert-blue); }
  #gev-cn-alert[data-level='yellow']{ --gev-alert:var(--gev-alert-yellow); }
  #gev-cn-alert[data-level='orange']{ --gev-alert:var(--gev-alert-orange); }
  #gev-cn-alert[data-level='red']{ --gev-alert:var(--gev-alert-red); }
  #gev-cn-alert[data-level='none']{ --gev-alert:var(--gev-unknown); }
  #gev-cn-alert[data-level='red'] .gev-wx-alert-main::before{
    animation:gev-alert-pulse 2.4s ease-in-out infinite;
  }
  @keyframes gev-alert-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:.32; } }
  .gev-wx-alert-badge{
    flex:0 0 auto; width:18px; height:18px; border-radius:4px;
    display:inline-flex; align-items:center; justify-content:center;
    font-size:10px; font-weight:700; line-height:1;
    color:#08121B; background:var(--gev-alert,var(--gev-unknown));
  }
  .gev-wx-alert-title{ flex:0 1 auto; min-width:0; max-width:38vw; color:#EAF4FF;
    font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gev-wx-alert-meta{ flex:0 1 auto; min-width:0; color:var(--gev-unknown); font-size:11px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gev-wx-alert-go{ flex:0 0 auto; color:#C9D6E2; font-size:11px; opacity:.85; }
  .gev-cn-status{ flex:0 1 auto; min-width:0; color:var(--gev-warn); font-size:11px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gev-cn-status:empty{ display:none; }
  .gev-wx-alert-more{
    flex:0 0 auto; height:30px; padding:0 9px; border-radius:8px;
    border:1px solid var(--glass-border, rgba(255,255,255,.14));
    background:rgba(8,14,20,.92); color:var(--gev-unknown);
    font-family:var(--font-sans); font-size:11px; line-height:1; cursor:pointer;
    transition:color .18s ease, border-color .18s ease;
  }
  .gev-wx-alert-more[hidden]{ display:none; }
  .gev-wx-alert-more:hover{ color:#EAF4FF; }
  .gev-wx-alert-more:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; }

  /* 失败态：中性灰 */
  #gev-cn-alert[data-level='none'] .gev-wx-alert-main{
    background:rgba(8,14,20,.62); border:1px solid rgba(255,255,255,.1);
  }
  #gev-cn-alert[data-level='none'] .gev-wx-alert-title{ color:var(--gev-unknown); font-weight:400; }

  /* ── 右侧等级标注（≥1024 显示文字，760–1023 只留色点，横屏矮屏 ≤759 整条隐藏）── */
  .gev-hl{ flex:0 0 auto; display:inline-flex; align-items:center; gap:5px; height:30px;
    padding:0 9px; border-radius:8px; box-sizing:border-box;
    background:rgba(8,14,20,.72); border:1px solid var(--glass-border, rgba(255,255,255,.12));
    color:var(--gev-alert,var(--gev-unknown)); font-family:var(--font-sans); font-size:11px;
    line-height:1; white-space:nowrap; pointer-events:none; }
  .gev-hl[hidden]{ display:none; }
  .gev-hl-dot{ width:8px; height:8px; border-radius:50%; flex:0 0 auto;
    background:var(--gev-alert,var(--gev-unknown));
    box-shadow:0 0 6px var(--gev-alert,var(--gev-unknown)); }
  .gev-hl-label{ color:var(--gev-unknown); }

  /* ── 预警列表 popover ──────────────────────────────────── */
  #gev-cn-alert-list{
    position:absolute; top:calc(100% + 6px); left:0; z-index:3;
    width:min(360px, calc(100vw - 24px)); max-height:min(280px, 50vh); overflow:auto;
    box-sizing:border-box; padding:6px; border-radius:10px;
    background:var(--glass-bg); border:1px solid var(--glass-border, rgba(255,255,255,.14));
    backdrop-filter:blur(18px) saturate(1.4);
    -webkit-backdrop-filter:blur(18px) saturate(1.4);
    box-shadow:0 16px 48px rgba(0,0,0,.48);
    color:#C9D6E2; font-family:var(--font-sans); font-size:12px; line-height:1.4;
  }
  #gev-cn-alert-list[hidden]{ display:none; }
  .gev-wx-alert-item{ display:flex; align-items:flex-start; gap:8px; width:100%;
    padding:7px 8px; border:0; border-radius:7px; background:transparent;
    color:inherit; font-family:var(--font-sans); font-size:12px; text-align:left;
    cursor:pointer; }
  .gev-wx-alert-item:hover{ background:rgba(255,255,255,.06); }
  .gev-wx-alert-item:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:-2px; }
  .gev-wx-alert-item[data-level='blue']{ --gev-alert:var(--gev-alert-blue); }
  .gev-wx-alert-item[data-level='yellow']{ --gev-alert:var(--gev-alert-yellow); }
  .gev-wx-alert-item[data-level='orange']{ --gev-alert:var(--gev-alert-orange); }
  .gev-wx-alert-item[data-level='red']{ --gev-alert:var(--gev-alert-red); }
  .gev-wx-alert-item-body{ min-width:0; flex:1 1 auto; display:flex; flex-direction:column; }
  .gev-wx-alert-item-title{ color:#EAF4FF; font-weight:600; word-break:break-word; }
  .gev-wx-alert-item-meta{ color:var(--gev-unknown); font-size:11px; }
  .gev-wx-alert-foot{ margin-top:4px; padding:5px 8px 2px;
    border-top:1px solid rgba(255,255,255,.08); display:flex; flex-direction:column; gap:2px;
    color:var(--gev-unknown); font-size:10px; }
  .gev-wx-alert-foot strong{ color:#C9D6E2; font-weight:600; }

  /* 屏幕阅读器专用 live region（挂 body，避免随 ui-clean-view 一起隐藏） */
  #gev-cn-alert-live{
    position:fixed; width:1px; height:1px; margin:-1px; padding:0;
    overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%);
    white-space:nowrap; border:0;
  }

  /* 窄屏补充：popover 左对齐铺满，避免被 translate 挤出视口 */
  @media (max-width:760px) and (orientation:portrait){
    #gev-cn-alert-list{ left:0; width:100%; }
  }
  `;

  function ensureStyle() {
    if (document.getElementById('gev-cn-weather-style')) return;
    const s = document.createElement('style');
    s.id = 'gev-cn-weather-style';
    /* 运行时注入的样式表必须进层，否则未分层样式会整体压掉分层 App CSS。 */
    s.textContent = '@layer overrides {' + STYLE + '}';
    document.head.appendChild(s);
  }

  // ── 状态 ──────────────────────────────────────────────────────
  const state = {
    viewer: null,
    started: false,
    band: null,
    wxBtn: null,
    wxDetail: null,
    alertBox: null,
    alertMain: null,
    alertMore: null,
    alertList: null,
    alertLive: null,
    hl: null,
    // 天气
    wxState: 'loading', // loading | ok | stale | error | empty
    wxData: null,
    wxLat: null,
    wxLng: null,
    wxAt: 0,
    wxInChina: null,
    // 预警
    alerts: [],
    alertsCount: 0,
    alertsStatus: 'loading', // loading | ok | error
    alertFails: 0,
    fingerprint: '',
    coldStart: true,
    // UI
    expanded: false,
    listOpen: false,
    jumpBusy: false,
    statusTimer: null,
    liveTimer: null,
    // 定时器
    refreshTimer: null,
    moveTimer: null,
    resizeTimer: null,
    // 联动
    lastTriggerId: '',
    lastTriggerAt: 0,
    jumped: new Map(),
  };

  // ── 小工具 ────────────────────────────────────────────────────
  const clampNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  function esc(s) {
    return String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  }

  const two = (n) => String(n).padStart(2, '0');

  function hhmm(iso) {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function mmddhhmm(iso) {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return (
      two(d.getMonth() + 1) +
      '-' +
      two(d.getDate()) +
      ' ' +
      two(d.getHours()) +
      ':' +
      two(d.getMinutes())
    );
  }

  const timeOf = (iso) => {
    const t = Date.parse(String(iso || ''));
    return Number.isFinite(t) ? t : 0;
  };

  function inChina(lng, lat) {
    return (
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      lng > CN.minLng &&
      lng < CN.maxLng &&
      lat > CN.minLat &&
      lat < CN.maxLat
    );
  }

  function kmBetween(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * RAD;
    const dLng = (b.lng - a.lng) * RAD;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function dataManager() {
    return window.__godsEyeView && window.__godsEyeView.dataManager;
  }

  function layerModule(id) {
    try {
      const dm = dataManager();
      const entry = dm && dm.layers && dm.layers.get && dm.layers.get(id);
      return (entry && entry.module) || null;
    } catch {
      return null;
    }
  }

  function analystRecords(id) {
    try {
      const mod = layerModule(id);
      if (!mod || typeof mod.getAnalystRecords !== 'function') return [];
      const rows = mod.getAnalystRecords();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function cameraPoint() {
    const v = state.viewer;
    if (!v || !v.camera) return null;
    try {
      const c = v.camera.positionCartographic;
      if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
        return { lat: c.latitude / RAD, lng: c.longitude / RAD };
      }
    } catch {
      /* fall through */
    }
    try {
      const g = v.scene && v.scene.globe;
      if (g && g.ellipsoid && v.camera.positionWC) {
        const c = g.ellipsoid.cartesianToCartographic(v.camera.positionWC);
        if (c && Number.isFinite(c.latitude)) {
          return { lat: c.latitude / RAD, lng: c.longitude / RAD };
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function getJson(url, signal) {
    return fetch(url, { signal, headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  // ── 预警等级 ──────────────────────────────────────────────────
  /**
   * 服务端只透出 title / severity / type / desc —— 没有 level 字段。
   * 中文预警惯例把颜色写进标题（"暴雨橙色预警信号"），优先用它；
   * 其次按 QWeather 的 severity（Minor/Moderate/Severe/Extreme）兜底。
   */
  function alertLevel(a) {
    const text = [a && a.title, a && a.type, a && a.desc]
      .filter(Boolean)
      .join(' ');
    if (/红色/.test(text)) return 'red';
    if (/橙色/.test(text)) return 'orange';
    if (/黄色/.test(text)) return 'yellow';
    if (/蓝色/.test(text)) return 'blue';
    const sev = String((a && a.severity) || '').toLowerCase();
    if (sev === 'extreme') return 'red';
    if (sev === 'severe') return 'orange';
    if (sev === 'moderate') return 'yellow';
    if (sev === 'minor') return 'blue';
    return 'yellow';
  }

  function alertId(a) {
    const id = a && a.id;
    if (id) return String(id);
    return String((a && a.title) || '') + '|' + String((a && a.start) || '');
  }

  function dedupeAlerts(list) {
    const out = [];
    const seen = new Set();
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || typeof a !== 'object') continue;
      const key = alertId(a);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  }

  /** 等级红>橙>黄>蓝，同级取最新（effectiveTime 大者优先）。 */
  function rankAlerts(list) {
    return list.slice().sort((a, b) => {
      const d =
        (LEVEL_RANK[alertLevel(b)] || 0) - (LEVEL_RANK[alertLevel(a)] || 0);
      if (d) return d;
      return timeOf(b.start) - timeOf(a.start);
    });
  }

  function alertKind(a) {
    const type = String((a && a.type) || '');
    const title = String((a && a.title) || '');
    if (TYPHOON_RE.test(type) || TYPHOON_RE.test(title)) return 'typhoon';
    if (QUAKE_RE.test(type) || QUAKE_RE.test(title)) return 'quake';
    if (PLACE_RE.test(type) || PLACE_RE.test(title)) return 'place';
    return 'other';
  }

  function placeNameFromAlert(a) {
    const hits = String((a && a.title) || '').match(PLACE_NAME_RE);
    return hits && hits[0] ? hits[0] : '';
  }

  // ── 天气图标 ──────────────────────────────────────────────────
  function iconKey(now) {
    const text = String((now && now.text) || '');
    const code = Number((now && now.icon) || 0);
    if (/雷/.test(text)) return 'thunder';
    if (/雪|冰|冻|霰/.test(text)) return 'snow';
    if (/雨/.test(text)) return 'rain';
    if (/雾|霾|沙|尘|浮/.test(text)) return 'fog';
    if (/风/.test(text)) return 'wind';
    if (/阴/.test(text)) return 'overcast';
    if (/云/.test(text)) return 'cloudy';
    if (/晴/.test(text)) return 'sun';
    if (code >= 300 && code < 400) return 'rain';
    if (code >= 400 && code < 500) return 'snow';
    if (code >= 500 && code < 516) return 'fog';
    if (code === 104) return 'overcast';
    if (code >= 101 && code <= 103) return 'cloudy';
    if (code >= 100 && code < 104) return 'sun';
    return 'unknown';
  }

  function iconMarkup(key) {
    return (
      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" ' +
      'stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      (ICON_SVG[key] || ICON_SVG.unknown) +
      '</svg>'
    );
  }

  // ── DOM ───────────────────────────────────────────────────────
  function buildDom() {
    ensureStyle();

    const band = document.createElement('div');
    band.id = 'gev-cn-band';

    const wxWrap = document.createElement('div');
    wxWrap.className = 'gev-wx';

    const wx = document.createElement('button');
    wx.id = 'gev-cn-wx';
    wx.className = 'gev-wx-summary';
    wx.type = 'button';
    wx.setAttribute('data-state', 'loading');
    wx.setAttribute('aria-expanded', 'false');
    wx.setAttribute('aria-controls', 'gev-cn-wx-detail');
    wx.innerHTML =
      '<span class="gev-wx-ico" aria-hidden="true">' +
      iconMarkup('unknown') +
      '</span>' +
      '<span class="gev-wx-temp">--°</span>' +
      '<span class="gev-wx-text">加载中</span>' +
      '<span class="gev-wx-wind"></span>' +
      '<span class="gev-wx-caret" aria-hidden="true"></span>';

    const detail = document.createElement('div');
    detail.id = 'gev-cn-wx-detail';
    detail.className = 'gev-wx-detail';
    detail.hidden = true;
    detail.innerHTML =
      '<dl class="gev-wx-grid"></dl>' +
      '<div class="gev-wx-src">数据来源：和风天气（QWeather）</div>';

    wxWrap.append(wx, detail);

    const alertBox = document.createElement('div');
    alertBox.id = 'gev-cn-alert';
    alertBox.className = 'gev-wx-alerts';
    alertBox.setAttribute('role', 'region');
    alertBox.setAttribute('aria-label', '气象预警');
    alertBox.setAttribute('data-level', 'none');
    alertBox.hidden = true;
    alertBox.innerHTML =
      '<button class="gev-wx-alert-main" type="button">' +
      '<span class="gev-wx-alert-badge" aria-hidden="true"></span>' +
      '<span class="gev-wx-alert-title"></span>' +
      '<span class="gev-wx-alert-meta"></span>' +
      '<span class="gev-cn-status"></span>' +
      '<span class="gev-wx-alert-go">查看 ›</span>' +
      '</button>' +
      '<button class="gev-wx-alert-more" type="button" hidden></button>' +
      '<div id="gev-cn-alert-list" role="dialog" aria-modal="false" ' +
      'aria-label="气象预警列表" hidden></div>';

    const hl = document.createElement('div');
    hl.className = 'gev-hl';
    hl.hidden = true;
    hl.innerHTML =
      '<span class="gev-hl-dot"></span><span class="gev-hl-label"></span>';

    band.append(wxWrap, alertBox, hl);
    document.body.appendChild(band);

    const live = document.createElement('div');
    live.id = 'gev-cn-alert-live';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    document.body.appendChild(live);

    state.band = band;
    state.wxBtn = wx;
    state.wxDetail = detail;
    state.alertBox = alertBox;
    state.alertMain = alertBox.querySelector('.gev-wx-alert-main');
    state.alertMore = alertBox.querySelector('.gev-wx-alert-more');
    state.alertList = alertBox.querySelector('#gev-cn-alert-list');
    state.alertLive = live;
    state.hl = hl;
  }

  // ── 渲染：天气胶囊 ────────────────────────────────────────────
  function renderWeather() {
    const wx = state.wxBtn;
    if (!wx) return;
    const now = state.wxData;
    const icoEl = wx.querySelector('.gev-wx-ico');
    const tempEl = wx.querySelector('.gev-wx-temp');
    const textEl = wx.querySelector('.gev-wx-text');
    const windEl = wx.querySelector('.gev-wx-wind');
    const st = state.wxState;

    wx.setAttribute('data-state', st);

    if (st === 'loading') {
      icoEl.innerHTML = iconMarkup('unknown');
      tempEl.textContent = '--°';
      textEl.textContent = '加载中';
      windEl.textContent = '';
      wx.setAttribute('aria-label', '天气数据加载中');
      wx.setAttribute('aria-disabled', 'false');
      return;
    }
    if (st === 'empty') {
      icoEl.innerHTML = iconMarkup('unknown');
      tempEl.textContent = '--°';
      textEl.textContent = '本区域无天气数据';
      windEl.textContent = '';
      wx.setAttribute('aria-label', '本区域无天气数据');
      wx.setAttribute('aria-disabled', 'true');
      return;
    }
    if (st === 'error') {
      icoEl.innerHTML = iconMarkup('unknown');
      // 保持温度占位，尺寸不跳动
      tempEl.textContent = '--°';
      textEl.textContent = '天气不可用 · 点按重试';
      windEl.textContent = '';
      wx.setAttribute('aria-label', '天气不可用，点按重试');
      wx.setAttribute('aria-disabled', 'false');
      return;
    }

    // ok / stale
    const stale = st === 'stale';
    const temp = clampNum(now && now.temp);
    const text = String((now && now.text) || '—');
    const windDir = String((now && now.windDir) || '');
    const windScale = String((now && now.windScale) || '');
    const wind = (windDir + (windScale ? ' ' + windScale + '级' : '')).trim();

    icoEl.innerHTML = iconMarkup(iconKey(now));
    tempEl.textContent =
      (stale ? '~' : '') + (temp == null ? '--' : temp) + '°';
    textEl.textContent = text;
    windEl.textContent = wind;
    wx.setAttribute('aria-disabled', 'false');

    const label =
      '天气：' +
      text +
      '，' +
      (temp == null ? '温度未知' : temp + ' 摄氏度') +
      (wind ? '，' + wind : '') +
      (stale
        ? '，观测时间 ' + hhmm(now && now.obsTime) + '，数据可能过期'
        : '') +
      '。点按展开详情';
    wx.setAttribute('aria-label', label);

    renderWeatherDetail(now);
  }

  function renderWeatherDetail(now) {
    const detail = state.wxDetail;
    if (!detail) return;
    const grid = detail.querySelector('.gev-wx-grid');
    if (!now) {
      grid.innerHTML = '';
      return;
    }
    const num = (v, unit, digits) => {
      const n = clampNum(v);
      if (n == null) return '—';
      const s =
        digits === 0 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
      return s + (unit || '');
    };
    const rows = [
      ['湿度', num(now.humidity, '%', 0)],
      ['降水', num(now.precip, ' mm', 1)],
      ['气压', num(now.pressure, ' hPa', 0)],
      ['能见度', num(now.vis, ' km', 0)],
      ['风速', num(now.windSpeed, ' km/h', 0)],
      ['观测', hhmm(now.obsTime) || '—'],
    ];
    grid.innerHTML = rows
      .map(
        ([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>',
      )
      .join('');
  }

  function setStatus(msg, ttl) {
    const el = state.alertBox && state.alertBox.querySelector('.gev-cn-status');
    if (!el) return;
    clearTimeout(state.statusTimer);
    el.textContent = msg || '';
    if (msg && ttl) {
      state.statusTimer = setTimeout(() => {
        el.textContent = '';
      }, ttl);
    }
  }

  // ── 渲染：预警横幅 ────────────────────────────────────────────
  function renderAlerts() {
    const box = state.alertBox;
    if (!box) return;
    // 横幅出现/消失会改变簇宽度 → 下一帧重新计算让位
    setTimeout(syncBandTop, 0);

    const badge = state.alertMain.querySelector('.gev-wx-alert-badge');
    const title = state.alertMain.querySelector('.gev-wx-alert-title');
    const meta = state.alertMain.querySelector('.gev-wx-alert-meta');
    const go = state.alertMain.querySelector('.gev-wx-alert-go');

    if (state.alertsStatus === 'loading') {
      box.hidden = true;
      state.hl.hidden = true;
      return;
    }
    if (state.alertsStatus === 'error') {
      box.hidden = false;
      box.setAttribute('data-level', 'none');
      badge.textContent = '!';
      title.textContent = '预警数据获取失败 · 重试';
      meta.textContent = '';
      go.textContent = '重试 ›';
      setStatus('');
      state.alertMore.hidden = true;
      state.hl.hidden = true;
      state.alertMain.setAttribute('aria-label', '预警数据获取失败，点按重试');
      return;
    }

    const current = state.alerts[0];
    if (!current) {
      box.hidden = true;
      state.alertMore.hidden = true;
      state.hl.hidden = true;
      return;
    }

    const level = alertLevel(current);
    box.hidden = false;
    box.setAttribute('data-level', level);

    badge.textContent = LEVEL_CHAR[level] || '警';
    title.textContent = String(current.title || '气象预警');
    const sender = String(current.sender || '气象台');
    const when = mmddhhmm(current.start);
    meta.textContent = when ? sender + ' · ' + when : sender;
    go.textContent = '查看 ›';
    state.alertMain.setAttribute(
      'aria-label',
      (LEVEL_CHAR[level] || '') +
        '色' +
        String(current.title || '气象预警') +
        '，' +
        meta.textContent +
        '，点按定位',
    );

    const more = state.alerts.length - 1;
    state.alertMore.hidden = more <= 0;
    state.alertMore.textContent = '还有 ' + more + ' 条';

    state.hl.hidden = false;
    state.hl.setAttribute('data-level', level);
    state.hl.style.setProperty('--gev-alert', 'var(--gev-alert-' + level + ')');
    state.hl.querySelector('.gev-hl-label').textContent =
      (LEVEL_CHAR[level] || '') + '色预警';
  }

  // ── 预警列表 popover ─────────────────────────────────────────
  function buildAlertList() {
    const list = state.alertList;
    if (!list) return;
    const items = state.alerts.slice(0, ALERT_MAX);
    const rows = items
      .map((a, i) => {
        const level = alertLevel(a);
        const meta = [String(a.sender || ''), mmddhhmm(a.start)]
          .filter(Boolean)
          .join(' · ');
        return (
          '<button class="gev-wx-alert-item" type="button" data-index="' +
          i +
          '" data-level="' +
          level +
          '">' +
          '<span class="gev-wx-alert-badge" aria-hidden="true">' +
          (LEVEL_CHAR[level] || '警') +
          '</span>' +
          '<span class="gev-wx-alert-item-body">' +
          '<span class="gev-wx-alert-item-title">' +
          esc(a.title || '气象预警') +
          '</span>' +
          (meta
            ? '<span class="gev-wx-alert-item-meta">' + esc(meta) + '</span>'
            : '') +
          '</span>' +
          '</button>'
        );
      })
      .join('');
    const foot =
      '<div class="gev-wx-alert-foot">' +
      '<span>共 <strong>' +
      esc(String(state.alertsCount || items.length)) +
      '</strong> 条</span>' +
      '<span>数据仅供参考，不用于航行或应急决策</span>' +
      '</div>';
    list.innerHTML = rows + foot;
    list.querySelectorAll('.gev-wx-alert-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.getAttribute('data-index'));
        const alert = state.alerts[idx];
        if (alert) runJump(alert, el);
      });
    });
  }

  function openList() {
    if (state.alertsStatus !== 'ok' || !state.alerts.length) return;
    buildAlertList();
    state.alertList.hidden = false;
    state.listOpen = true;
    syncPopoverLayer();
    const first = state.alertList.querySelector('.gev-wx-alert-item');
    if (first) {
      try {
        first.focus();
      } catch {
        /* ignore */
      }
    }
  }

  function closeList(returnFocus) {
    if (!state.listOpen) return;
    state.alertList.hidden = true;
    state.listOpen = false;
    syncPopoverLayer();
    if (returnFocus) {
      const back = state.alertMore.hidden ? state.alertMain : state.alertMore;
      try {
        back.focus();
      } catch {
        /* ignore */
      }
    }
  }

  function onListKeydown(e) {
    if (!state.listOpen) return;
    const items = Array.from(
      state.alertList.querySelectorAll('.gev-wx-alert-item'),
    );
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = idx < 0 ? 0 : (idx + delta + items.length) % items.length;
      items[next].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  }

  // ── 天气详情开合 ─────────────────────────────────────────────
  function toggleDetail(force) {
    const open =
      typeof force === 'boolean' ? force : state.wxDetail.hidden === true;
    if (open && (state.wxState === 'loading' || state.wxState === 'empty')) {
      return;
    }
    state.wxDetail.hidden = !open;
    state.expanded = open;
    state.wxBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    // 详情气泡与预警列表都在 band 的 100 层里，打开时抬到弹窗层
    syncPopoverLayer();
  }

  function syncPopoverLayer() {
    if (!state.band) return;
    state.band.classList.toggle(
      'has-popover',
      Boolean(state.expanded || state.listOpen),
    );
  }

  // ── 数据：天气 + 预警 ─────────────────────────────────────────
  async function fetchWeather(lat, lng) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(
        '/api/cn/weather?lat=' +
          encodeURIComponent(lat.toFixed(4)) +
          '&lng=' +
          encodeURIComponent(lng.toFixed(4)),
        { signal: ac.signal, headers: { Accept: 'application/json' } },
      );
      if (!r.ok) return { kind: r.status === 400 ? 'empty' : 'error' };
      const data = await r.json();
      return { kind: 'ok', data };
    } catch {
      // 网络失败 / 超时 / 中止 —— 一律按灰态，不进 error 日志
      return { kind: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(reason) {
    if (!state.viewer || !state.band) return;
    if (document.hidden && reason !== 'manual') return;
    // 连续 2 次失败后停自动重试，只有手动点按恢复
    if (state.alertFails >= 2 && reason !== 'manual') return;

    const p = cameraPoint();
    if (!p) return;

    if (!inChina(p.lng, p.lat)) {
      // 境外：不发请求，按空态处理
      state.wxState = 'empty';
      state.wxData = null;
      state.wxInChina = false;
      state.wxLat = p.lat;
      state.wxLng = p.lng;
      state.wxAt = Date.now();
      state.alertsStatus = 'ok';
      state.alerts = [];
      state.alertsCount = 0;
      renderWeather();
      renderAlerts();
      scheduleNext();
      return;
    }

    state.wxInChina = true;
    if (state.wxState !== 'ok' && state.wxState !== 'stale') {
      state.wxState = 'loading';
      renderWeather();
    }

    const { kind, data } = await fetchWeather(p.lat, p.lng);
    const now = Date.now();

    if (kind === 'empty') {
      state.wxState = 'empty';
      state.wxData = null;
      state.alertsStatus = 'ok';
      state.alerts = [];
      state.alertsCount = 0;
      state.alertFails = 0;
    } else if (kind === 'error' || !data || !data.ok || !data.now) {
      state.wxState = 'error';
      state.wxData = null;
      state.alertsStatus = 'error';
      state.alerts = [];
      state.alertsCount = 0;
      state.alertFails += 1;
    } else {
      state.wxData = data.now;
      state.wxAt = now;
      state.wxLat = p.lat;
      state.wxLng = p.lng;
      const obs = Date.parse(String(data.now.obsTime || ''));
      const age = Number.isFinite(obs) ? now - obs : 0;
      state.wxState = age > STALE_MS ? 'stale' : 'ok';
      const list = dedupeAlerts(data.alerts);
      state.alerts = rankAlerts(list);
      state.alertsCount = Number.isFinite(Number(data.alertsCount))
        ? Number(data.alertsCount)
        : state.alerts.length;
      state.alertsStatus = 'ok';
      state.alertFails = 0;
      announceAlerts();
    }

    renderWeather();
    renderAlerts();
    scheduleNext();
  }

  /** 独立 live region：仅指纹变化时播一条合成句；冷启动首次只记指纹不播报。 */
  function announceAlerts() {
    const fp = state.alerts
      .map((a) => alertId(a))
      .sort()
      .join('|');
    if (fp === state.fingerprint) return;
    const wasCold = state.coldStart;
    state.fingerprint = fp;
    state.coldStart = false;
    if (wasCold || !fp || !state.alertLive) return;
    const top = state.alerts[0];
    if (!top) return;
    const level = alertLevel(top);
    const sentence =
      '新预警：' +
      (LEVEL_CHAR[level] || '') +
      '色' +
      String(top.title || '气象预警') +
      '，共 ' +
      String(state.alertsCount || state.alerts.length) +
      ' 条';
    state.alertLive.textContent = '';
    clearTimeout(state.liveTimer);
    state.liveTimer = setTimeout(() => {
      if (state.alertLive) state.alertLive.textContent = sentence;
    }, 60);
  }

  function scheduleNext() {
    clearTimeout(state.refreshTimer);
    if (state.alertFails >= 2) return; // 连续失败：停自动重试
    state.refreshTimer = setTimeout(() => refresh('timer'), REFRESH_MS);
  }

  // ── B1：预警 → 图层联动 ───────────────────────────────────────
  /** 先启用图层（1.2s 软超时，超时不算失败），返回 { available, on }。 */
  async function enableLayer(id) {
    const dm = dataManager();
    let entry = null;
    try {
      entry = dm && dm.layers && dm.layers.get && dm.layers.get(id);
    } catch {
      entry = null;
    }
    if (!entry) return { available: false, on: false };
    let already = false;
    try {
      already = dm.isEnabled ? dm.isEnabled(id) === true : false;
    } catch {
      already = false;
    }
    if (already) return { available: true, on: true };

    await Promise.race([
      Promise.resolve()
        .then(() => dm.setEnabled(id, true, { origin: 'cn-alert-jump' }))
        .catch(() => null),
      sleep(LAYER_SOFT_MS),
    ]);
    let on = false;
    try {
      on = dm.isEnabled ? dm.isEnabled(id) === true : false;
    } catch {
      on = false;
    }
    return { available: true, on };
  }

  /** 已启用台风图层的实况末点（记录 id 形如 `${storm.id}:live`）。 */
  function lastTyphoonPoint(stormId) {
    const recs = analystRecords('cn-typhoon');
    if (!recs.length) return null;
    const prefix = String(stormId || '') + ':live';
    let best = null;
    for (const r of recs) {
      if (!r || typeof r.id !== 'string' || !r.id.startsWith(prefix)) continue;
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      const t = Number.isFinite(r.timeMs) ? r.timeMs : 0;
      if (!best || t >= best.t) best = { lat: r.lat, lng: r.lng, t };
    }
    return best ? { lat: best.lat, lng: best.lng } : null;
  }

  async function resolveTyphoonPoint(alert, signal) {
    const body = await getJson('/api/cn/typhoon', signal);
    const storms = body && Array.isArray(body.storms) ? body.storms : [];
    if (!storms.length) return null;
    const hay = (
      String(alert.title || '') +
      ' ' +
      String(alert.type || '')
    ).toUpperCase();
    const hit = storms.find((s) => {
      const cn = String(s.nameCn || '');
      const en = String(s.nameEn || '');
      return (
        (cn && hay.includes(cn.toUpperCase())) ||
        (en && hay.includes(en.toUpperCase()))
      );
    });
    const storm = hit || storms[0];
    if (!storm) return null;
    // ① 已启用图层的实况末点（更实时）；② API 的 points 末点
    let point = lastTyphoonPoint(storm.id);
    if (!point && Array.isArray(storm.points) && storm.points.length) {
      const p = storm.points[storm.points.length - 1];
      if (Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
        point = { lat: Number(p.lat), lng: Number(p.lng) };
      }
    }
    if (!point) return null;
    return {
      lat: point.lat,
      lng: point.lng,
      label: String(storm.nameCn || storm.nameEn || storm.id || '台风'),
    };
  }

  function resolveQuakePoint() {
    const recs = analystRecords('cn-quakes');
    if (!recs.length) return null;
    const cam = cameraPoint();
    const cands = recs.filter(
      (r) => Number.isFinite(r.lat) && Number.isFinite(r.lng),
    );
    if (!cands.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const r of cands) {
      const mag = Number.isFinite(r.magnitude) ? r.magnitude : 0;
      const dist = cam ? kmBetween(cam, r) : 0;
      // 震级最高且最近：震级每 1 级值 1000km 的等效距离
      const score = mag * 1000 - dist;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) return null;
    const mag = Number.isFinite(best.magnitude) ? best.magnitude : null;
    return {
      lat: best.lat,
      lng: best.lng,
      label: (mag == null ? '' : 'M' + mag + ' ') + String(best.place || '地震'),
    };
  }

  async function resolvePlacePoint(alert, signal) {
    const name = placeNameFromAlert(alert);
    if (!name) return null;
    const cam = cameraPoint();
    let url = '/api/mini/geocode?q=' + encodeURIComponent(name) + '&limit=3';
    if (cam) url += '&near=' + cam.lng.toFixed(4) + ',' + cam.lat.toFixed(4);
    const body = await getJson(url, signal);
    const rows = body && Array.isArray(body.results) ? body.results : [];
    const first = rows[0];
    if (!first || !Number.isFinite(Number(first.lat))) return null;
    let lat = Number(first.lat);
    let lng = Number(first.lon);
    if (!Number.isFinite(lng)) return null;
    const crs = String(body.crs || first.crs || 'wgs84').toLowerCase();
    if (crs === 'gcj02') {
      const conv = gcj02ToWgs84(lng, lat);
      lng = conv[0];
      lat = conv[1];
    }
    return { lat, lng, label: String(first.name || name) };
  }

  function flyTo(point, kind) {
    const v = state.viewer;
    if (!v || !v.camera || !v.scene || !v.scene.globe) return false;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
    const spec = FLY[kind] || FLY.place;
    const duration = prefersReducedMotion()
      ? FLY_REDUCED_DURATION
      : spec.duration;
    try {
      const ellipsoid = v.scene.globe.ellipsoid;
      const dest = ellipsoid.cartographicToCartesian({
        longitude: point.lng * RAD,
        latitude: point.lat * RAD,
        height: spec.height,
      });
      v.camera.flyTo({
        destination: dest,
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration,
      });
      return true;
    } catch {
      return false;
    }
  }

  async function runJump(alert, sourceEl) {
    if (!alert) return;
    const now = Date.now();
    if (state.jumpBusy) return;
    const id = alertId(alert);
    if (
      id === state.lastTriggerId &&
      now - state.lastTriggerAt < REPEAT_GUARD_MS
    )
      return;
    state.lastTriggerId = id;
    state.lastTriggerAt = now;
    state.jumpBusy = true;

    // 1) 0ms 视觉反馈
    if (sourceEl) sourceEl.classList.add('is-jumping');
    if (state.alertBox) state.alertBox.setAttribute('aria-busy', 'true');
    setStatus('定位中…');

    const finish = () => {
      if (sourceEl) sourceEl.classList.remove('is-jumping');
      if (state.alertBox) state.alertBox.removeAttribute('aria-busy');
      state.jumpBusy = false;
    };

    // 2) 驾驶舱模式：不飞
    if (document.body.classList.contains('cockpit-mode')) {
      setStatus('退出驾驶舱后才能飞到预警位置', 5000);
      finish();
      return;
    }
    announceNavigationAuthority('cn-alert-jump');

    const started = Date.now();
    const deadline = started + JUMP_BUDGET_MS;
    const ac = new AbortController();
    const budgetTimer = setTimeout(() => ac.abort(), JUMP_BUDGET_MS);

    const kind = alertKind(alert);
    const layerId =
      kind === 'typhoon' ? 'cn-typhoon' : kind === 'quake' ? 'cn-quakes' : null;

    try {
      // 3) 先启用图层
      let layer = { available: false, on: false };
      if (layerId) layer = await enableLayer(layerId);

      // 4) 解析点位（总预算 2.5s）
      let point = null;
      if (Date.now() < deadline) {
        if (kind === 'typhoon') {
          point = await resolveTyphoonPoint(alert, ac.signal);
        } else if (kind === 'quake') {
          point = resolveQuakePoint();
          if (!point && Date.now() < deadline)
            point = await resolvePlacePoint(alert, ac.signal);
        } else if (kind === 'place') {
          point = await resolvePlacePoint(alert, ac.signal);
        }
      }

      if (point) {
        // 5) 去重：同 id 且相机仍在 50km 内 → 只提示不飞
        const memo = state.jumped.get(id);
        const cam = cameraPoint();
        if (
          memo &&
          Date.now() - memo.ts < JUMP_TTL_MS &&
          cam &&
          kmBetween(cam, { lat: memo.lat, lng: memo.lng }) < JUMP_NEAR_KM
        ) {
          setStatus('已在预警位置附近', 3600);
          finish();
          return;
        }
        if (flyTo(point, kind === 'other' ? 'place' : kind)) {
          state.jumped.set(id, {
            ts: Date.now(),
            lat: point.lat,
            lng: point.lng,
            label: point.label,
          });
          closeList(false);
          // 焦点归还横幅，不抢到画布
          try {
            (state.alertMore.hidden ? state.alertMain : state.alertMore).focus();
          } catch {
            /* ignore */
          }
          setStatus('');
          if (state.alertLive) {
            state.alertLive.textContent = '';
            clearTimeout(state.liveTimer);
            state.liveTimer = setTimeout(() => {
              if (state.alertLive)
                state.alertLive.textContent = '已定位：' + point.label;
            }, 60);
          }
          finish();
          return;
        }
      }

      // 6) 收尾：部分成功 / 全失败都不动相机
      if (layer.on && layerId) {
        setStatus(
          '未找到该预警的具体位置，已打开' +
            (LAYER_LABEL[layerId] || layerId) +
            '图层',
          5000,
        );
      } else {
        setStatus('该预警没有对应的位置数据，已保持当前视野', 5000);
      }
      finish();
    } catch {
      setStatus('该预警没有对应的位置数据，已保持当前视野', 5000);
      finish();
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  // ── 驾驶舱：把 band 压到 top-line 下方 ────────────────────────
  function syncCockpitBand() {
    const band = state.band;
    if (!band) return;
    if (!document.body.classList.contains('cockpit-mode')) {
      band.style.removeProperty('--gev-band-top');
      return;
    }
    let top = 64;
    const line = document.querySelector('#cockpit-hud .cockpit-topline');
    if (line) {
      const r = line.getBoundingClientRect();
      if (r.height > 0) top = Math.max(r.bottom + 8, 64);
    }
    band.style.setProperty('--gev-band-top', Math.round(top) + 'px');
  }

  /**
   * 左上锚定簇的落点。固定 `top:64; left:52` 在 1440×900 会压住标题栏（32–90）
   * 与左栏栈（94–724），1024–1200 宽时还会撞居中的 #top-center-actions。
   * 按实测矩形依次让位：
   *  · 水平让开标题栏（left = 标题右缘 +12）；
   *  · 与顶中按钮行相交则下压到其底缘 +8；
   *  · 与 #global-loading-status（z102 > 本带 z100）相交再下压；
   *  · 仍与左栏栈相交则右移到栏右缘 +12（放不下才下压）。
   * 让位会改 max-width，进而改变簇宽度 —— 所以用「预测宽度算一遍 → 落盘 →
   * 读回真实 offsetWidth 再算一遍」，避免同一趟里用旧宽度多判一次相交而抖动。
   */
  function syncBandTop() {
    const band = state.band;
    if (!band) return;
    const clear = () => {
      band.style.removeProperty('top');
      band.style.removeProperty('left');
      band.style.removeProperty('max-width');
    };
    if (document.body.classList.contains('cockpit-mode')) {
      clear();
      return;
    }
    const desktop = window.matchMedia(
      '(min-height:561px) and (min-width:761px)',
    ).matches;
    const portrait = window.matchMedia(
      '(max-width:760px) and (orientation:portrait)',
    ).matches;
    if (!desktop || portrait) {
      clear();
      return;
    }

    const baseLeft = 52;
    const baseTop = 64;

    const compute = (startWidth) => {
      let left = baseLeft;
      let top = baseTop;
      let width = Math.max(160, startWidth || 200);
      // 高度随宽度变化（窄到折两排时 30 → ~66），每趟都要重读，不能用旧快照
      const height = Math.max(
        30,
        Math.round(band.getBoundingClientRect().height) || 30,
      );

      const overlaps = (r) =>
        r &&
        r.height > 0 &&
        r.width > 0 &&
        left < r.right &&
        left + width > r.left &&
        top < r.bottom &&
        top + height > r.top;

      const rectOf = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
      };

      const title = rectOf('#title-bar');
      if (title && overlaps(title)) {
        left = Math.round(title.right + 12);
        width = Math.min(width, window.innerWidth - left - 52);
      }

      const actions = rectOf('#top-center-actions');
      if (actions && overlaps(actions)) top = Math.round(actions.bottom + 8);

      const status = rectOf('#global-loading-status');
      if (status && overlaps(status)) top = Math.round(status.bottom + 8);

      const stack = rectOf('#left-panel-stack');
      if (stack && overlaps(stack)) {
        const rightShift = Math.round(stack.right + 12);
        if (rightShift + 160 < window.innerWidth) {
          left = rightShift;
          width = Math.min(width, window.innerWidth - left - 52);
        } else {
          top = Math.round(stack.bottom + 12);
        }
      }
      return { left, top, width: Math.max(160, width) };
    };

    const write = (res) => {
      if (res.left === baseLeft) band.style.removeProperty('left');
      else band.style.left = res.left + 'px';
      if (res.top === baseTop) band.style.removeProperty('top');
      else band.style.top = res.top + 'px';
      if (res.left === baseLeft) band.style.removeProperty('max-width');
      else
        band.style.maxWidth =
          Math.max(160, window.innerWidth - res.left - 52) + 'px';
    };

    const first = compute(band.offsetWidth);
    write(first);
    // 落盘后宽度可能被 max-width 收窄 → 用真实宽度再收敛一次
    const settled = band.offsetWidth;
    if (settled > 0 && settled !== first.width) {
      const second = compute(settled);
      if (second.left !== first.left || second.top !== first.top) write(second);
    }
  }

  // ── 事件绑定 ─────────────────────────────────────────────────
  function bind() {
    state.wxBtn.addEventListener('click', () => {
      if (state.wxState === 'error') {
        state.alertFails = 0;
        refresh('manual');
        return;
      }
      if (state.wxBtn.getAttribute('aria-disabled') === 'true') return;
      toggleDetail();
    });

    state.alertMain.addEventListener('click', () => {
      if (state.alertsStatus === 'error') {
        // 手动重试预警（失败横幅整行可点）
        state.alertFails = 0;
        refresh('manual');
        return;
      }
      const alert = state.alerts[0];
      if (alert) runJump(alert, state.alertMain);
    });

    state.alertMore.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.listOpen) closeList(true);
      else openList();
    });

    state.alertList.addEventListener('keydown', onListKeydown);

    // Esc：先关列表（焦点归还），再收天气详情
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (state.listOpen) {
        e.stopPropagation();
        closeList(true);
        return;
      }
      if (state.expanded) {
        e.stopPropagation();
        toggleDetail(false);
      }
    });

    // 点外部判定：捕获阶段 pointerdown + band.contains（不用 pointer-events 技巧）
    document.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target;
        if (!(t instanceof Node)) return;
        if (state.band && state.band.contains(t)) return;
        if (state.listOpen) closeList(false);
        if (state.expanded) toggleDetail(false);
      },
      true,
    );

    // 加载状态条（z102）出现/消失会改变可用的左上空间 → 重新让位
    try {
      const attachStatusObserver = () => {
        const st = document.getElementById('global-loading-status');
        if (!st) return false;
        const mo = new MutationObserver(() => {
          clearTimeout(state.statusSyncTimer);
          state.statusSyncTimer = setTimeout(syncBandTop, 80);
        });
        // 显隐是改 hidden 属性（shellFeedback.js），class/style 不会变，必须一并观察
        mo.observe(st, {
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'data-state'],
        });
        state.statusObserver = mo;
        return true;
      };
      if (!attachStatusObserver()) setTimeout(attachStatusObserver, 2000);
    } catch {
      /* ignore */
    }

    // 相机停稳去抖 → 移动 >0.5° 才重取
    try {
      state.viewer.camera.moveEnd.addEventListener(() => {
        clearTimeout(state.moveTimer);
        state.moveTimer = setTimeout(() => {
          const p = cameraPoint();
          if (!p) return;
          const moved =
            !Number.isFinite(state.wxLat) ||
            !Number.isFinite(state.wxLng) ||
            Math.abs(p.lat - state.wxLat) > CAMERA_MOVE_DEG ||
            Math.abs(p.lng - state.wxLng) > CAMERA_MOVE_DEG;
          if (moved) refresh('camera');
        }, 600);
      });
    } catch {
      /* ignore */
    }

    // 后台挂起，可见且超过 10min 补一次
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(state.refreshTimer);
        return;
      }
      if (Date.now() - state.wxAt > REFRESH_MS) refresh('visible');
      else scheduleNext();
    });

    // 驾驶舱模式 / 视口变化 → 重新定位 band
    const syncBoth = () => {
      syncCockpitBand();
      syncBandTop();
    };
    window.addEventListener('gev:cockpit-mode-changed', syncBoth);
    window.addEventListener('resize', () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(syncBoth, 120);
    });
  }

  // ── 启动 ─────────────────────────────────────────────────────
  function start(viewer) {
    if (state.started) return;
    state.started = true;
    state.viewer = viewer;
    buildDom();
    renderWeather();
    renderAlerts();
    bind();
    syncCockpitBand();
    syncBandTop();
    setTimeout(syncBandTop, 800);
    // 首帧之后再取，避免和首屏抢带宽
    setTimeout(() => refresh('init'), 400);
  }

  let tries = 0;
  const bootTimer = setInterval(() => {
    tries += 1;
    const v =
      (window.__godsEyeView && window.__godsEyeView.viewer) ||
      window.__gevViewer;
    if (v) {
      start(v);
      clearInterval(bootTimer);
      return;
    }
    if (tries > 300) clearInterval(bootTimer);
  }, 500);

  window.__gevCnWeather = {
    refresh: (reason) => refresh(reason || 'manual'),
    state,
    get band() {
      return state.band;
    },
  };
})();
