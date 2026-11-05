/**
 * gev-cn-health — 数据源健康面板（A7）。
 *
 * 零侵入增强层：本文件独立，由 `boot-defer.js` 的 DEFERRED 动态装载，
 * 不改主链、不改路由、不改任何应用源码。删除该文件与 DEFERRED 里那一行即完全还原。
 *
 * 数据：`GET /api/sources/health`（server/providers/mini-sources.js 已实现，只读消费）：
 *   { at, stale, building, summary{layers,channels,okChannels,switched,down}, layers{} }
 *   layers[layerId] = {
 *     channels[]{ id, label, ok, ms, status, error, note },
 *     primary, primaryLabel, okCount, total, switched, down, unknown?
 *   }
 * `unknown:true` = 服务端探测超时未完成（down 被强制为 false），不是「确认挂了」。
 *
 * 行为：
 *  · 懒加载 —— 点 chip 才发首包；6s 超时；60s 缓存（命中直接渲染 + 后台静默刷新）。
 *  · building 轮询 —— 2s 一次，20s 预算且最多 8 次，任一先到即停；
 *    面板关闭 abort、后台标签暂停、可见补一次。
 *  · 位置 —— 布带（A5 `#gev-cn-band`）下方第二行；驾驶舱模式跟随布带底缘。
 */
(function () {
  if (window.__gevCnHealth) return;

  const CACHE_MS = 60 * 1000;
  const FETCH_TIMEOUT_MS = 6000;
  const POLL_MS = 2000;
  const POLL_MAX = 8;
  const POLL_BUDGET_MS = 20000;
  const SLOW_MS = 1200;
  const DEFAULT_ROWS = 8;

  /** layerId → 面板显示名（密钥与 server/providers/mini-sources.js 的 CHANNELS 一致） */
  const LAYER_NAMES = {
    flights: '航班',
    militaryFlights: '军用航空',
    vessels: '舰船',
    satellites: '卫星',
    earthquakes: '地震',
    fires: '野火',
    cctv: '摄像头',
    traffic: '路况',
    wind: '风场',
    radio: '广播',
    launches: '航天发射',
    cyclones: '气旋',
    staticInfra: '静态设施',
    cables: '海底光缆',
    datacenters: '数据中心',
    dams: '水坝',
    perimeters: '火场边界',
    radar: '雷达',
    clouds: '卫星云图',
    lightning: '闪电',
    alpr: '车牌识别',
    installations: '设施检索',
    transit: '公共交通',
    bikeshare: '共享单车',
    recentImagery: '最新影像',
    directions: '路线',
    measure: '测距',
    awareness: '态势',
  };

  const STYLE = `
  #gev-cn-health{
    position:fixed; z-index:var(--z-hud,100); top:126px; right:var(--right-rail-x,52px);
    pointer-events:none; font-family:var(--font-sans); box-sizing:border-box;
  }
  #gev-cn-health > *{ pointer-events:auto; }
  #gev-cn-health.is-open #gev-cn-health-chip{ visibility:hidden; }

  @media (min-height:561px) and (min-width:761px){
    #gev-cn-health{ top:126px; right:52px; }
  }
  @media (orientation:landscape) and (max-height:560px) and (min-width:1024px){
    #gev-cn-health{ top:126px; right:calc(min(250px,38vw) + 24px); }
  }
  @media (orientation:landscape) and (max-height:560px) and (max-width:1023px){
    #gev-cn-health{ display:none; }
  }
  @media (max-width:760px) and (orientation:portrait){
    #gev-cn-health{
      top:calc(env(safe-area-inset-top,0px) + 132px); right:12px;
    }
  }
  body.ui-clean-view #gev-cn-health{ display:none; }

  /* ── 胶囊 ─────────────────────────────────────────────── */
  #gev-cn-health-chip{
    display:inline-flex; align-items:center; gap:6px;
    height:34px; min-height:34px; padding:0 11px; border-radius:999px;
    background:var(--glass-bg); border:1px solid var(--glass-border, rgba(255,255,255,.14));
    color:#C9D6E2; font-family:var(--font-sans); font-size:11.5px; line-height:1;
    cursor:pointer; -webkit-appearance:none; appearance:none; white-space:nowrap;
    text-shadow:0 1px 2px rgba(0,0,0,.55); box-sizing:border-box;
    transition:background .18s ease, border-color .18s ease;
  }
  #gev-cn-health-chip:hover{ background:rgba(20,26,36,.82); }
  #gev-cn-health-chip:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; }
  #gev-cn-health-chip[data-state='down']{ border-color:rgba(255,90,82,.55); }
  #gev-cn-health-chip[data-state='switched']{ border-color:rgba(255,180,77,.5); }
  #gev-cn-health-chip[data-state='error']{ color:var(--gev-unknown, #9AA3AD); background:rgba(8,14,20,.86); }
  .gev-hh-dot{ width:7px; height:7px; border-radius:50%; flex:0 0 auto;
    background:var(--gev-ok, #5EF1A6); box-shadow:0 0 6px currentColor; }
  #gev-cn-health-chip[data-state='idle'] .gev-hh-dot{ background:var(--gev-unknown, #9AA3AD); }
  #gev-cn-health-chip[data-state='loading'] .gev-hh-dot,
  #gev-cn-health-chip[data-state='building'] .gev-hh-dot{
    background:var(--gev-building, #8AE0FF); animation:gev-hh-pulse 1.4s ease-in-out infinite;
  }
  #gev-cn-health-chip[data-state='down'] .gev-hh-dot{ background:var(--gev-bad, #FF5A52); }
  #gev-cn-health-chip[data-state='switched'] .gev-hh-dot{ background:var(--gev-warn, #FFB44D); }
  #gev-cn-health-chip[data-state='error'] .gev-hh-dot{ background:var(--gev-unknown, #9AA3AD); }
  @keyframes gev-hh-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:.3; } }
  .gev-hh-count{ color:#9AA3AD; font-variant-numeric:tabular-nums; }

  /* ── 面板 ─────────────────────────────────────────────── */
  #gev-cn-health-panel{
    position:fixed; top:126px; right:var(--right-rail-x,52px); width:330px;
    max-height:calc(100vh - 126px - 132px); z-index:var(--z-popup,200);
    display:flex; flex-direction:column; box-sizing:border-box;
    background:rgba(8,14,20,.94); border:1px solid var(--glass-border, rgba(255,255,255,.14));
    border-radius:10px; box-shadow:0 16px 48px rgba(0,0,0,.48);
    color:#C9D6E2; font-family:var(--font-sans); font-size:12px; line-height:1.4;
  }
  #gev-cn-health-panel[hidden]{ display:none; }
  @media (min-width:1440px){ #gev-cn-health-panel{ width:380px; } }
  @media (max-width:760px) and (orientation:portrait){
    #gev-cn-health-panel{
      top:auto; left:12px; right:12px;
      bottom:calc(env(safe-area-inset-bottom,0px) + 76px); max-height:68vh;
    }
  }
  .gev-hp-head{
    display:flex; align-items:center; gap:8px; padding:9px 11px 7px;
    border-bottom:1px solid rgba(255,255,255,.08);
  }
  .gev-hp-head h2{
    margin:0; flex:1 1 auto; font-size:13px; font-weight:600; color:#EAF4FF;
    letter-spacing:.5px; outline:none;
  }
  .gev-hp-head h2:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; border-radius:4px; }
  .gev-hp-close{
    flex:0 0 auto; min-width:44px; min-height:34px; padding:0 8px;
    border:1px solid var(--glass-border, rgba(255,255,255,.14)); border-radius:6px;
    background:transparent; color:#9AA3AD; font-family:var(--font-sans); font-size:11px;
    cursor:pointer;
  }
  .gev-hp-close:hover{ color:#EAF4FF; }
  .gev-hp-close:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; }

  .gev-hp-summary{
    display:grid; grid-template-columns:repeat(5, 1fr); gap:4px;
    padding:8px 11px; border-bottom:1px solid rgba(255,255,255,.06);
  }
  .gev-hp-stat{ display:flex; flex-direction:column; gap:1px; min-width:0; }
  .gev-hp-stat b{ font-size:14px; font-weight:600; color:#EAF4FF;
    font-variant-numeric:tabular-nums; }
  .gev-hp-stat.bad b{ color:var(--gev-bad, #FF5A52); }
  .gev-hp-stat.warn b{ color:var(--gev-warn, #FFB44D); }
  .gev-hp-stat.ok b{ color:var(--gev-ok, #5EF1A6); }
  .gev-hp-stat span{ font-size:9.5px; color:#9AA3AD; white-space:nowrap; }

  .gev-hp-note{
    display:flex; align-items:center; gap:8px; padding:6px 11px;
    font-size:10.5px; color:#9AA3AD; border-bottom:1px solid rgba(255,255,255,.06);
  }
  .gev-hp-note:empty{ display:none; }
  .gev-hp-note .gev-hp-inline-btn{
    margin-left:auto; flex:0 0 auto; min-height:30px; padding:0 8px;
    border:1px solid rgba(255,255,255,.18); border-radius:6px; background:transparent;
    color:#C9D6E2; font-family:var(--font-sans); font-size:10.5px; cursor:pointer;
  }
  .gev-hp-note .gev-hp-inline-btn:hover{ border-color:rgba(255,255,255,.4); }
  .gev-hp-note .gev-hp-inline-btn:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; }

  .gev-hp-list{ overflow:auto; padding:4px 0; min-height:0; flex:1 1 auto; }
  .gev-hp-list:focus-visible{ outline:2px solid rgba(74,158,255,.6); outline-offset:-2px; }
  .gev-hp-row{
    display:grid; grid-template-columns:12px minmax(0,1fr) auto; align-items:center;
    gap:8px; padding:6px 11px;
  }
  .gev-hp-row + .gev-hp-row{ border-top:1px solid rgba(255,255,255,.04); }
  .gev-hp-dot{ width:9px; height:9px; border-radius:50%; box-sizing:border-box;
    background:var(--gev-ok, #5EF1A6); }
  .gev-hp-dot.is-unknown{ background:transparent;
    border:1.5px solid var(--gev-unknown, #9AA3AD); }
  .gev-hp-dot.is-timeout{ background:transparent;
    border:1.5px solid #6B7480; }
  .gev-hp-dot.is-down{ background:var(--gev-bad, #FF5A52); }
  .gev-hp-dot.is-switched,
  .gev-hp-dot.is-slow{ background:var(--gev-warn, #FFB44D); }
  .gev-hp-name{ min-width:0; display:flex; flex-direction:column; gap:1px; }
  .gev-hp-name b{ font-weight:600; color:#EAF4FF; font-size:12px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gev-hp-sub{ font-size:10px; color:#9AA3AD;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gev-hp-meta{ text-align:right; font-size:10.5px; color:#9AA3AD;
    font-variant-numeric:tabular-nums; white-space:nowrap; }
  .gev-hp-meta b{ color:#C9D6E2; font-weight:600; }
  .gev-hp-meta.is-bad b{ color:var(--gev-bad, #FF5A52); }
  .gev-hp-meta.is-warn b{ color:var(--gev-warn, #FFB44D); }

  .gev-hp-more{
    flex:0 0 auto; min-height:34px; margin:4px 11px 8px;
    border:1px solid var(--glass-border, rgba(255,255,255,.14)); border-radius:7px;
    background:transparent; color:#C9D6E2; font-family:var(--font-sans); font-size:11.5px;
    cursor:pointer;
  }
  .gev-hp-more:hover{ background:rgba(255,255,255,.06); }
  .gev-hp-more:focus-visible{ outline:2px solid rgba(74,158,255,.85); outline-offset:2px; }
  .gev-hp-more[hidden]{ display:none; }

  .gev-hp-foot{
    flex:0 0 auto; padding:7px 11px 9px; border-top:1px solid rgba(255,255,255,.08);
    display:flex; flex-direction:column; gap:2px; font-size:9.5px; color:#9AA3AD;
  }

  @media (prefers-reduced-motion: reduce){
    #gev-cn-health-chip, #gev-cn-health-chip .gev-hh-dot,
    .gev-hp-row, .gev-hp-more{ animation:none; transition:none; }
  }
  `;

  function ensureStyle() {
    if (document.getElementById('gev-cn-health-style')) return;
    const s = document.createElement('style');
    s.id = 'gev-cn-health-style';
    /* 运行时注入必须进层，否则未分层样式会整体压掉分层 App CSS。 */
    s.textContent = '@layer overrides {' + STYLE + '}';
    document.head.appendChild(s);
  }

  const state = {
    mounted: false,
    open: false,
    phase: 'idle', // idle | loading | ok | error | timeout
    data: null,
    at: 0,
    fetchedAt: 0,
    building: false,
    stale: false,
    showAll: false,
    resizeTimer: null,
    ro: null,
    error: '',
    pollTimer: null,
    pollCount: 0,
    pollStart: 0,
    abort: null,
    els: {},
  };

  const el = {
    root: null,
    chip: null,
    chipDot: null,
    chipLabel: null,
    chipCount: null,
    panel: null,
    title: null,
    close: null,
    summary: null,
    note: null,
    list: null,
    more: null,
  };

  const clampNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const two = (n) => String(n).padStart(2, '0');

  function hhmm(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const d = new Date(ms);
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function esc(s) {
    return String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  }

  function layerName(id) {
    if (LAYER_NAMES[id]) return LAYER_NAMES[id];
    const s = String(id || '');
    return s ? s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) : '—';
  }

  // ── DOM ───────────────────────────────────────────────────────
  function buildDom() {
    ensureStyle();

    const root = document.createElement('div');
    root.id = 'gev-cn-health';

    const chip = document.createElement('button');
    chip.id = 'gev-cn-health-chip';
    chip.type = 'button';
    chip.className = 'gev-cn-health-chip';
    chip.setAttribute('data-state', 'idle');
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-controls', 'gev-cn-health-panel');
    chip.setAttribute('aria-label', '数据源健康，点按查看');
    chip.innerHTML =
      '<span class="gev-hh-dot" aria-hidden="true"></span>' +
      '<span class="gev-hh-label">数据源</span>' +
      '<span class="gev-hh-count"></span>';

    const panel = document.createElement('div');
    panel.id = 'gev-cn-health-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'gev-cn-health-title');
    panel.hidden = true;
    panel.innerHTML =
      '<div class="gev-hp-head">' +
      '<h2 id="gev-cn-health-title" tabindex="-1">数据源健康</h2>' +
      '<button class="gev-hp-close" type="button">关闭</button>' +
      '</div>' +
      '<div class="gev-hp-summary"></div>' +
      '<div class="gev-hp-note"></div>' +
      '<div class="gev-hp-list" tabindex="0" aria-label="数据源健康明细"></div>' +
      '<button class="gev-hp-more" type="button" hidden></button>' +
      '<div class="gev-hp-foot">' +
      '<span>共 28 层 / 37 通道；unknown = 服务端探测未完成，不等于中断</span>' +
      '<span>数据仅供参考，不用于航行或应急决策</span>' +
      '</div>';

    root.append(chip, panel);
    document.body.appendChild(root);
    el.root = root;
    el.chip = chip;
    el.chipDot = chip.querySelector('.gev-hh-dot');
    el.chipLabel = chip.querySelector('.gev-hh-label');
    el.chipCount = chip.querySelector('.gev-hh-count');
    el.panel = panel;
    el.title = panel.querySelector('#gev-cn-health-title');
    el.close = panel.querySelector('.gev-hp-close');
    el.summary = panel.querySelector('.gev-hp-summary');
    el.note = panel.querySelector('.gev-hp-note');
    el.list = panel.querySelector('.gev-hp-list');
    el.more = panel.querySelector('.gev-hp-more');

    state.mounted = true;
    state.els = el;
  }

  // ── 派生 ──────────────────────────────────────────────────────
  function layerRows() {
    const layers = (state.data && state.data.layers) || {};
    const rows = [];
    for (const id of Object.keys(layers)) {
      const L = layers[id] || {};
      const chans = Array.isArray(L.channels) ? L.channels : [];
      const total = clampNum(L.total) ?? chans.length;
      const okCount = clampNum(L.okCount) ?? chans.filter((c) => c.ok).length;
      const ms = chans.reduce(
        (m, c) => (Number.isFinite(c && c.ms) ? Math.max(m, c.ms) : m),
        0,
      );
      const unknown = L.unknown === true;
      const down = L.down === true && !unknown;
      const switched = L.switched === true && !down && !unknown;
      const slow = !down && !unknown && !switched && ms > SLOW_MS;
      let kind = 'ok';
      if (unknown) kind = 'unknown';
      else if (down) kind = 'down';
      else if (switched) kind = 'switched';
      else if (slow) kind = 'slow';
      else if (ms === 0 && total === 0) kind = 'timeout';
      rows.push({
        id,
        name: layerName(id),
        kind,
        ms,
        total,
        okCount,
        primaryLabel: String(L.primaryLabel || ''),
        channels: chans,
      });
    }
    const rank = { down: 0, switched: 1, unknown: 2, slow: 3, timeout: 4, ok: 5 };
    rows.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
    return rows;
  }

  function summaryOf() {
    const s = (state.data && state.data.summary) || null;
    if (!s) return null;
    return {
      layers: clampNum(s.layers) || 0,
      channels: clampNum(s.channels) || 0,
      okChannels: clampNum(s.okChannels) || 0,
      switched: clampNum(s.switched) || 0,
      down: clampNum(s.down) || 0,
    };
  }

  function rowStatusText(row) {
    if (row.kind === 'unknown') return '未探测';
    if (row.kind === 'down') {
      const first = row.channels.find((c) => c && c.error);
      return '全部不通' + (first && first.error ? ' · ' + String(first.error) : '');
    }
    if (row.kind === 'switched') {
      return '已切备用' + (row.primaryLabel ? ' · ' + row.primaryLabel : '');
    }
    if (row.kind === 'timeout') return '探测超时';
    if (row.kind === 'slow') return '响应偏慢';
    return row.primaryLabel || '正常';
  }

  // ── 渲染 ──────────────────────────────────────────────────────
  function renderChip() {
    if (!el.chip) return;
    const sum = summaryOf();
    let st = 'idle';
    let label = '数据源';
    let count = '';

    if (state.phase === 'loading') {
      st = 'loading';
      label = '数据源';
      count = '探测中';
    } else if (state.phase === 'error') {
      st = 'error';
      label = '数据源';
      count = '不可用';
    } else if (state.building) {
      st = 'building';
      label = '数据源';
      count = '探测中';
    } else if (sum) {
      if (sum.down > 0) st = 'down';
      else if (sum.switched > 0) st = 'switched';
      label = '在线';
      count = sum.okChannels + '/' + sum.channels;
    }

    el.chip.setAttribute('data-state', st);
    el.chipLabel.textContent = label;
    el.chipCount.textContent = count;
    el.chip.setAttribute(
      'aria-label',
      count ? '数据源健康：' + label + ' ' + count + '，点按查看' : '数据源健康，点按查看',
    );
  }

  function renderSummary() {
    const sum = summaryOf();
    const dash = '—';
    const cell = (label, value, cls) =>
      '<div class="gev-hp-stat' +
      (cls ? ' ' + cls : '') +
      '"><b>' +
      value +
      '</b><span>' +
      label +
      '</span></div>';
    const building = state.building || !sum;
    const v = (n) => (building ? dash : String(n));
    el.summary.innerHTML =
      cell('层', v(sum ? sum.layers : 0)) +
      cell('通道', v(sum ? sum.channels : 0)) +
      cell('在线', v(sum ? sum.okChannels : 0), 'ok') +
      cell('切换', v(sum ? sum.switched : 0), 'warn') +
      cell('中断', v(sum ? sum.down : 0), 'bad');
  }

  function noteMarkup() {
    if (state.phase === 'error') {
      return '<span>数据源探测失败</span>' +
        '<button class="gev-hp-inline-btn" type="button" data-act="retry">重试</button>';
    }
    if (state.phase === 'timeout') {
      return '<span>探测超时</span>' +
        '<button class="gev-hp-inline-btn" type="button" data-act="retry">重试</button>';
    }
    if (state.building) {
      const elapsed = state.pollStart ? Date.now() - state.pollStart : 0;
      const left = Math.max(0, Math.ceil((POLL_BUDGET_MS - elapsed) / 1000));
      let text;
      if (elapsed < 4000) text = '探测中 ' + state.pollCount + '/' + POLL_MAX;
      else if (elapsed < 12000) text = '上游响应较慢';
      else text = '仍在探测，最多再等 ' + left + ' 秒';
      const stop =
        elapsed >= 12000
          ? '<button class="gev-hp-inline-btn" type="button" data-act="stop">停止并显示已有结果</button>'
          : '';
      return '<span>' + esc(text) + '</span>' + stop;
    }
    if (state.stale && state.at) {
      return '<span>数据为上次探测结果 · ' + esc(hhmm(state.at)) + '</span>';
    }
    return '';
  }

  function rowMarkup(row) {
    const dotCls =
      row.kind === 'unknown'
        ? 'is-unknown'
        : row.kind === 'timeout'
          ? 'is-timeout'
          : row.kind === 'down'
            ? 'is-down'
            : row.kind === 'switched'
              ? 'is-switched'
              : row.kind === 'slow'
                ? 'is-slow'
                : '';
    const metaCls =
      row.kind === 'down' ? ' is-bad' : row.kind === 'switched' || row.kind === 'slow' ? ' is-warn' : '';
    const msText = row.ms > 0 ? Math.round(row.ms) + 'ms' : '—';
    return (
      '<div class="gev-hp-row">' +
      '<span class="gev-hp-dot ' +
      dotCls +
      '" aria-hidden="true"></span>' +
      '<span class="gev-hp-name"><b>' +
      esc(row.name) +
      '</b><span class="gev-hp-sub">' +
      esc(rowStatusText(row)) +
      '</span></span>' +
      '<span class="gev-hp-meta' +
      metaCls +
      '"><b>' +
      row.okCount +
      '/' +
      row.total +
      '</b> · ' +
      msText +
      '</span>' +
      '</div>'
    );
  }

  function renderPanel() {
    renderSummary();
    el.note.innerHTML = noteMarkup();

    const rows = layerRows();
    const shown = state.showAll ? rows : rows.slice(0, DEFAULT_ROWS);
    el.list.innerHTML = shown.length
      ? shown.map(rowMarkup).join('')
      : '<div class="gev-hp-row"><span class="gev-hp-dot is-unknown" aria-hidden="true"></span>' +
        '<span class="gev-hp-name"><b>' +
        (state.phase === 'loading' ? '探测中…' : '暂无数据') +
        '</b><span class="gev-hp-sub">' +
        (state.phase === 'loading' ? '正在读取 /api/sources/health' : '点按「重试」再取一次') +
        '</span></span><span class="gev-hp-meta">—</span></div>';

    el.more.hidden = rows.length <= DEFAULT_ROWS;
    el.more.textContent = state.showAll
      ? '收起'
      : '展开全部 ' + rows.length + ' 层';
  }

  function render() {
    renderChip();
    if (!state.open) return;
    renderPanel();
  }

  // ── 数据 ──────────────────────────────────────────────────────
  function abortCurrent() {
    if (state.abort) {
      try {
        state.abort.abort();
      } catch {
        /* ignore */
      }
      state.abort = null;
    }
  }

  function applyPayload(d) {
    state.data = d && typeof d === 'object' ? d : null;
    state.at = Number(d && d.at) || 0;
    state.fetchedAt = Date.now();
    state.building = !!(d && d.building);
    state.stale = !!(d && d.stale);
    state.phase = 'ok';
    state.error = '';
    if (state.building && state.open) startPolling();
    else stopPolling();
    render();
  }

  function load(opts) {
    const silent = !!(opts && opts.silent);
    abortCurrent();
    const ac = new AbortController();
    state.abort = ac;
    const timer = setTimeout(() => {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
    }, FETCH_TIMEOUT_MS);

    if (!silent) {
      state.phase = 'loading';
      state.error = '';
      render();
    }

    fetch('/api/sources/health', {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (state.abort !== ac) return;
        if (!d || typeof d !== 'object') {
          if (!silent) {
            state.phase = 'error';
            state.error = 'health_unavailable';
            render();
          }
          return;
        }
        applyPayload(d);
      })
      .catch(() => {
        if (state.abort !== ac) return;
        if (silent) return;
        state.phase = 'error';
        state.error = 'health_unavailable';
        stopPolling();
        render();
      })
      .finally(() => {
        clearTimeout(timer);
        if (state.abort === ac) state.abort = null;
      });
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollStart = Date.now();
    state.pollCount = 0;
    state.pollTimer = setInterval(() => {
      if (!state.open) {
        stopPolling();
        return;
      }
      if (document.hidden) return;
      state.pollCount += 1;
      const elapsed = Date.now() - state.pollStart;
      if (state.pollCount > POLL_MAX || elapsed >= POLL_BUDGET_MS) {
        stopPolling();
        if (state.building) {
          state.phase = 'timeout';
          render();
        }
        return;
      }
      load({ silent: true });
      render();
    }, POLL_MS);
    render();
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ── 开合 ──────────────────────────────────────────────────────
  function openPanel() {
    if (!state.mounted) return;
    if (state.open) return;
    state.open = true;
    el.panel.hidden = false;
    el.root.classList.add('is-open');
    el.chip.setAttribute('aria-expanded', 'true');
    syncCockpitPosition();
    render();

    const fresh = state.data && Date.now() - state.fetchedAt < CACHE_MS;
    if (fresh) {
      // 60s 内重开：先渲染缓存，再后台静默刷新
      load({ silent: true });
    } else {
      load();
    }

    try {
      el.title.focus();
    } catch {
      /* ignore */
    }
  }

  function closePanel(returnFocus) {
    if (!state.open) return;
    state.open = false;
    el.panel.hidden = true;
    el.root.classList.remove('is-open');
    el.chip.setAttribute('aria-expanded', 'false');
    stopPolling();
    abortCurrent();
    if (returnFocus) {
      try {
        el.chip.focus();
      } catch {
        /* ignore */
      }
    }
  }

  function retry() {
    stopPolling();
    state.data = null;
    state.fetchedAt = 0;
    load();
  }

  // ── 驾驶舱 / 视口 ─────────────────────────────────────────────
  /**
   * 布带第二行的落点不是常量：
   *  · 右栏（#right-context-rail，z 110）在 top≈94 处就占住了 right:52 的列，
   *    固定 top:126 会被它盖住且点不到 → 取右栏底缘 + 8；
   *  · 竖屏时布带自身就在 safe+132 起、可能折成两排 → 取布带底缘 + 8；
   *  · 驾驶舱模式下布带被抬到 top-line 之下 → 跟随其底缘。
   * 都没有可测障碍时清掉内联 top，回落到断点 CSS 的兜底值。
   */
  function syncCockpitPosition() {
    if (!el.root) return;
    const cockpit = document.body.classList.contains('cockpit-mode');
    const portrait =
      window.innerWidth <= 760 && window.innerHeight > window.innerWidth;

    let top = null;

    const band = document.getElementById('gev-cn-band');
    if (band) {
      const r = band.getBoundingClientRect();
      if (r.height > 0) top = r.bottom + 8;
    }

    if (!portrait) {
      const base = cockpit ? 0 : 126;
      top = top == null ? base : Math.max(top, base);
      if (!cockpit) {
        const rail = document.getElementById('right-context-rail');
        if (rail) {
          const rr = rail.getBoundingClientRect();
          const rightGap = window.innerWidth - rr.right;
          // 只认真正落在右侧列里的右栏；抽屉/离屏状态不参与
          if (rr.height > 0 && rr.width > 0 && rightGap >= 0 && rightGap <= 120) {
            top = Math.max(top, rr.bottom + 8);
          }
        }
      }
    }

    if (top == null || !Number.isFinite(top) || top <= 0) {
      el.root.style.removeProperty('top');
    } else {
      const maxTop = Math.max(96, window.innerHeight - 140);
      el.root.style.top = Math.round(Math.min(top, maxTop)) + 'px';
    }

    syncPanelEdge(portrait);
  }

  /**
   * 竖屏时面板是底部抽屉：CSS 的 `bottom: safe+76` 在手机 dock 抬高时会压住指令坞，
   * 这里按 dock 实际顶边把面板底缘再抬 8px；非竖屏清掉内联值走断点 CSS。
   */
  function syncPanelEdge(portrait) {
    if (!el.panel) return;
    if (!portrait) {
      el.panel.style.removeProperty('bottom');
      return;
    }
    const dock = document.getElementById('command-dock');
    if (!dock) {
      el.panel.style.removeProperty('bottom');
      return;
    }
    const r = dock.getBoundingClientRect();
    if (r.height <= 0) {
      el.panel.style.removeProperty('bottom');
      return;
    }
    el.panel.style.bottom = Math.round(window.innerHeight - r.top + 8) + 'px';
  }

  // ── 事件 ──────────────────────────────────────────────────────
  function bind() {
    el.chip.addEventListener('click', () => {
      if (state.open) closePanel(true);
      else openPanel();
    });

    el.close.addEventListener('click', () => closePanel(true));

    el.more.addEventListener('click', () => {
      state.showAll = !state.showAll;
      renderPanel();
    });

    el.note.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'retry') retry();
      else if (act === 'stop') {
        stopPolling();
        state.phase = 'timeout';
        render();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) {
        e.stopPropagation();
        closePanel(true);
      }
    });

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!state.open) return;
        const t = e.target;
        if (!(t instanceof Node)) return;
        if (el.root && el.root.contains(t)) return;
        closePanel(false);
      },
      true,
    );

    window.addEventListener('gev:cockpit-mode-changed', syncCockpitPosition);
    window.addEventListener('resize', () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(syncCockpitPosition, 120);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (state.open && state.building) load({ silent: true });
    });
  }

  /** 右栏 / 布带的尺寸变化都要重新落位（面板展开、预警出现都会改变底缘）。 */
  function observeLayout() {
    if (typeof ResizeObserver !== 'function' || state.ro) return;
    state.ro = new ResizeObserver(() => syncCockpitPosition());
    const rail = document.getElementById('right-context-rail');
    if (rail) state.ro.observe(rail);
    const dock = document.getElementById('command-dock');
    if (dock) state.ro.observe(dock);
    const attachBand = () => {
      const band = document.getElementById('gev-cn-band');
      if (band && state.ro) state.ro.observe(band);
    };
    attachBand();
    setTimeout(attachBand, 1500);
  }

  function mount() {
    if (state.mounted) return;
    if (!document.body) return;
    buildDom();
    bind();
    syncCockpitPosition();
    observeLayout();
    setTimeout(syncCockpitPosition, 600);
    setTimeout(syncCockpitPosition, 2500);
    render();
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });

  window.__gevCnHealth = {
    refresh: () => retry(),
    state,
    get panel() {
      return el.panel;
    },
  };
})();
