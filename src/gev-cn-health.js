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
  /* chip 由 JS 追加进 #top-center-actions，直接继承既有顶行按钮的 36×36 玻璃与动效；
     这里只保留状态点的语义色与窄横屏隐藏。 */
  #top-center-actions #gev-cn-health-chip{ display:inline-flex; align-items:center; justify-content:center; }
  @media (orientation:landscape) and (max-height:560px) and (max-width:1023px){
    #top-center-actions #gev-cn-health-chip{ display:none; }
  }
  /* 注意：#top-center-actions #gev-cn-health-chip 是两个 id（2,0,0），
     隐藏规则必须同样带上 #top-center-actions，否则被它反压 */
  /* 净屏 / 录制 / 座舱 / 场景播放：顶中行会被 #scene-runtime(z105) 或座舱 HUD 盖住，
     chip 与面板一并隐藏（隐藏选择器必须带 #top-center-actions，否则被 base 的 2,0,0 反压） */
  body.ui-clean-view #top-center-actions #gev-cn-health-chip,
  body.recording-mode #top-center-actions #gev-cn-health-chip,
  body.cockpit-mode #top-center-actions #gev-cn-health-chip,
  body.scene-playback-mode #top-center-actions #gev-cn-health-chip{ display:none; }
  body.ui-clean-view #gev-cn-health-panel,
  body.recording-mode #gev-cn-health-panel,
  body.cockpit-mode #gev-cn-health-panel,
  body.scene-playback-mode #gev-cn-health-panel{ display:none; }

  .gev-hh-dot{ width:9px; height:9px; border-radius:50%; flex:0 0 auto;
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

  /* ── 面板 ─────────────────────────────────────────────── */
  #gev-cn-health-panel{
    position:fixed; top:88px; right:calc(var(--right-rail-x,52px) + 338px); width:330px;
    max-height:calc(100vh - 88px - 132px); z-index:var(--z-popup,200);
    display:flex; flex-direction:column; box-sizing:border-box;
    background:var(--glass-bg); border:1px solid var(--glass-border, rgba(255,255,255,.14));
    backdrop-filter:blur(18px) saturate(1.4);
    -webkit-backdrop-filter:blur(18px) saturate(1.4);
    border-radius:10px; box-shadow:0 16px 48px rgba(0,0,0,.48);
    color:#C9D6E2; font-family:var(--font-sans); font-size:12px; line-height:1.4;
  }
  #gev-cn-health-panel[hidden]{ display:none; }
  @media (min-width:1440px){ #gev-cn-health-panel{ width:380px; } }
  @media (max-width:760px) and (orientation:portrait){
    #gev-cn-health-panel{
      top:auto; left:12px; right:12px;
      bottom:calc(env(safe-area-inset-bottom,0px) + 104px);
      max-height:min(68vh, calc(100vh - 300px));
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
    return s
      ? s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
      : '—';
  }

  // ── DOM ───────────────────────────────────────────────────────
  function buildDom() {
    ensureStyle();

    const chip = document.createElement('button');
    chip.id = 'gev-cn-health-chip';
    chip.type = 'button';
    chip.className = 'gev-cn-health-chip';
    chip.setAttribute('data-state', 'idle');
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-controls', 'gev-cn-health-panel');
    chip.setAttribute('aria-label', '数据源健康，点按查看');
    chip.innerHTML = '<span class="gev-hh-dot" aria-hidden="true"></span>';

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

    // 面板挂 body（fixed 弹层），chip 由 mount() 追加进 #top-center-actions，
    // 直接继承既有顶行按钮的玻璃与动效。
    document.body.appendChild(panel);
    el.chip = chip;
    el.chipDot = chip.querySelector('.gev-hh-dot');
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
    const rank = {
      down: 0,
      switched: 1,
      unknown: 2,
      slow: 3,
      timeout: 4,
      ok: 5,
    };
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
      return (
        '全部不通' + (first && first.error ? ' · ' + String(first.error) : '')
      );
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
    el.chip.setAttribute(
      'aria-label',
      count
        ? '数据源健康：' + label + ' ' + count + '，点按查看'
        : '数据源健康，点按查看',
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
      return (
        '<span>数据源探测失败</span>' +
        '<button class="gev-hp-inline-btn" type="button" data-act="retry">重试</button>'
      );
    }
    if (state.phase === 'timeout') {
      return (
        '<span>探测超时</span>' +
        '<button class="gev-hp-inline-btn" type="button" data-act="retry">重试</button>'
      );
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
      row.kind === 'down'
        ? ' is-bad'
        : row.kind === 'switched' || row.kind === 'slow'
          ? ' is-warn'
          : '';
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
        (state.phase === 'loading'
          ? '正在读取 /api/sources/health'
          : '点按「重试」再取一次') +
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
    el.chip.setAttribute('aria-expanded', 'true');
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
      const btn =
        e.target && e.target.closest && e.target.closest('[data-act]');
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
        if (el.chip && el.chip.contains(t)) return;
        if (el.panel && el.panel.contains(t)) return;
        closePanel(false);
      },
      true,
    );

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (state.open && state.building) load({ silent: true });
    });
  }

  /** 等 #top-center-actions 出现（DEFERRED 与主链并行，顶中行可能还没建好）。 */
  function waitForHost() {
    return new Promise((resolve) => {
      const found = document.getElementById('top-center-actions');
      if (found) {
        resolve(found);
        return;
      }
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        const host = document.getElementById('top-center-actions');
        if (host) {
          clearInterval(timer);
          resolve(host);
          return;
        }
        if (tries > 300) {
          clearInterval(timer);
          resolve(null);
        }
      }, 500);
    });
  }

  function mount() {
    if (state.mounted) return;
    if (!document.body) return;
    buildDom();
    bind();
    render();
    waitForHost().then((host) => {
      if (!host || !el.chip) return;
      // chip 直接进入顶中按钮行，继承既有 36×36 玻璃按钮的样式与动效。
      if (el.chip.parentElement !== host) host.appendChild(el.chip);
      state.host = host;
    });
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
