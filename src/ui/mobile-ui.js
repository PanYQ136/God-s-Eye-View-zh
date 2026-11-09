/* mobile-ui.js — 窄屏悬浮抽屉（兜底增强，配合 mobile-portrait.css）。
   仅在窗口 <=760px 且手机壳层（body.mobile-shell）未接管时创建两个悬浮按钮，
   点击把 #left-panel-stack / #right-context-rail 加 .mobile-open 滑出，点地图外收起。
   壳层自带底部 tab 栏覆盖同一批面板，两套导航并存既挤压底部又语义重复，
   因此壳层挂载时本增强自动退场（MutationObserver 监听 body class）。
   纯增强：不改变桌面/横屏行为。
   回滚：删 boot-defer.js 里对本文件的动态导入即可。 */
import { MOBILE_MEDIA_QUERY } from './viewport.js';

(() => {
  if (window.__gevMobileUI) return;
  window.__gevMobileUI = true;

  // Mirrors MOBILE_SHELL_CLASS in ./mobileShell.js; kept as a literal so this
  // fallback does not pull the shell module into the boot graph.
  const SHELL_CLASS = 'mobile-shell';
  const MQ = window.matchMedia(MOBILE_MEDIA_QUERY);
  const LEFT = 'left-panel-stack';
  const RIGHT = 'right-context-rail';
  let fabL = null;
  let fabR = null;
  let applied = null;

  const isPortrait = () =>
    MQ.matches && !document.body.classList.contains(SHELL_CLASS);

  function mkFab(id, icon, label) {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'gev-mfab';
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = '<span class="material-symbols-rounded">' + icon + '</span>';
    document.body.appendChild(b);
    return b;
  }

  function setOpen(id, open) {
    const e = document.getElementById(id);
    if (!e) return;
    if (open) {
      e.classList.add('mobile-open');
      e.style.setProperty('transform', 'translateX(0)', 'important');
      e.style.setProperty('opacity', '1', 'important');
      e.style.setProperty('pointer-events', 'auto', 'important');
    } else {
      e.classList.remove('mobile-open');
      e.style.removeProperty('transform');
      e.style.removeProperty('opacity');
      e.style.removeProperty('pointer-events');
    }
  }

  function closeDrawers() {
    setOpen(LEFT, false);
    setOpen(RIGHT, false);
    if (fabL) fabL.classList.remove('on');
    if (fabR) fabR.classList.remove('on');
    document.body.classList.remove('gev-drawer-open');
  }

  function toggleDrawer(id, fab, otherId, otherFab) {
    const e = document.getElementById(id);
    if (!e) return;
    const willOpen = !e.classList.contains('mobile-open');
    // 互斥先全收，再用内联 !important 强制打开（不受样式表层叠影响）
    setOpen(LEFT, false);
    setOpen(RIGHT, false);
    if (fabL) fabL.classList.remove('on');
    if (fabR) fabR.classList.remove('on');
    if (willOpen) {
      setOpen(id, true);
      if (fab) fab.classList.add('on');
      document.body.classList.add('gev-drawer-open');
    } else {
      document.body.classList.remove('gev-drawer-open');
    }
  }

  function build() {
    if (!isPortrait()) {
      teardown();
      return;
    }
    document.body.classList.add('gev-mobile-portrait');
    if (fabL) return;
    fabL = mkFab('gev-mfab-left', 'layers', '图层面板');
    fabR = mkFab('gev-mfab-right', 'tune', '工具面板');
    fabL.addEventListener('click', () => toggleDrawer(LEFT, fabL, RIGHT, fabR));
    fabR.addEventListener('click', () => toggleDrawer(RIGHT, fabR, LEFT, fabL));
  }

  function teardown() {
    document.body.classList.remove('gev-mobile-portrait', 'gev-drawer-open');
    setOpen(LEFT, false);
    setOpen(RIGHT, false);
    if (fabL) {
      fabL.remove();
      fabL = null;
    }
    if (fabR) {
      fabR.remove();
      fabR = null;
    }
  }

  // Idempotent state sync: build/teardown both mutate body classes, which
  // re-enters through the observer below, so the last applied value gates it.
  function sync() {
    const want = isPortrait();
    if (want === applied) return;
    applied = want;
    if (want) build();
    else teardown();
  }

  // 点抽屉/按钮之外（地图等）收起
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!document.body.classList.contains('gev-drawer-open')) return;
      const t = e.target;
      if (t.closest('#' + LEFT + ',#' + RIGHT + ',.gev-mfab')) return;
      closeDrawers();
    },
    true,
  );

  MQ.addEventListener('change', sync);
  new MutationObserver(sync).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  let _rt = null;
  window.addEventListener('resize', () => {
    if (_rt) clearTimeout(_rt);
    _rt = setTimeout(sync, 200);
  });

  function init() {
    if (document.getElementById(LEFT) && document.getElementById(RIGHT)) sync();
    else setTimeout(init, 400);
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
