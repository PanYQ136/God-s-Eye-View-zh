/* GEV 面板自由拖拽 / 缩放层（gev-panel-win.js）
   删除 index.html 中 <script src="/src/gev-panel-win.js"> 一行即完全回滚。
   作用单元 = 三个功能模块容器（左侧组 / 右侧组 / 命令坞）；内部面板承载独立功能。
   特性：鼠标/触摸拖拽(顶部把手区)、右下角缩放、半透明占位预览、边界吸附、最小尺寸、
         rAF 节流、禁止拖出可视区、localStorage 持久化+刷新还原、玻璃卡片、重置按钮。 */
(function () {
  'use strict';
  if (window.__gevPanelWin) return;
  window.__gevPanelWin = true;

  const KEY = 'gev-pw-v1';
  const SNAP = 8,
    MOVE_TOL = 8,
    HEADER_H = 46;
  const TARGETS = {
    // 左栈/右栏交由卡片层(src/lc)+App 原生布局管理；gev-panel-win 不再接管，
    // 否则其 applyGeom 会把容器 top 强设为捕获值，与卡片层的 translate 让位叠加导致卡片出屏。
    'command-dock': { minW: 300, minH: 70 },
  };
  const INTERACTIVE =
    'button,input,select,textarea,a,label,[role=slider],.pp-slider,.pp-select,.pp-mode-btn,#gev-pw-reset';

  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    store = {};
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch (e) {}
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const vw = () => window.innerWidth,
    vh = () => window.innerHeight;

  const ghost = document.createElement('div');
  ghost.className = 'gev-placeholder';
  ghost.style.cssText =
    'position:fixed;display:none;pointer-events:none;z-index:2147483000;border:1px solid rgba(0,212,255,.40);background:rgba(0,212,255,.06);border-radius:14px;';

  function applyGeom(el, g) {
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('left', g.l + 'px', 'important');
    el.style.setProperty('top', g.t + 'px', 'important');
    el.style.setProperty('width', g.w + 'px', 'important');
    el.style.setProperty('height', g.h + 'px', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    el.style.setProperty('transform', 'none', 'important'); // 关键：清掉 left:50%+translateX(-50%) 居中残留，否则偏移半宽
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('max-height', 'none', 'important');
  }
  function rectOf(el) {
    const b = el.getBoundingClientRect();
    return {
      l: Math.round(b.left),
      t: Math.round(b.top),
      w: Math.round(b.width),
      h: Math.round(b.height),
    };
  }

  function snap(g, el) {
    const vX = vw(),
      vY = vh();
    let { l, t } = g;
    const fns = [];
    if (Math.abs(l) <= SNAP) fns.push(() => (l = 0));
    if (Math.abs(l + g.w - vX) <= SNAP) fns.push(() => (l = vX - g.w));
    if (Math.abs(t) <= SNAP) fns.push(() => (t = 0));
    if (Math.abs(t + g.h - vY) <= SNAP) fns.push(() => (t = vY - g.h));
    document.querySelectorAll('.gev-win').forEach((o) => {
      if (o === el) return;
      const b = o.getBoundingClientRect();
      if (Math.abs(l - b.left) <= SNAP)
        fns.push(() => (l = Math.round(b.left)));
      if (Math.abs(l - b.right) <= SNAP)
        fns.push(() => (l = Math.round(b.right)));
      if (Math.abs(l + g.w - b.left) <= SNAP)
        fns.push(() => (l = Math.round(b.left - g.w)));
      if (Math.abs(t - b.top) <= SNAP) fns.push(() => (t = Math.round(b.top)));
      if (Math.abs(t - b.bottom) <= SNAP)
        fns.push(() => (t = Math.round(b.bottom)));
    });
    fns.forEach((f) => f());
    return { l, t, w: g.w, h: g.h };
  }
  const showGhost = (g) => {
    ghost.style.display = 'block';
    ghost.style.left = g.l + 'px';
    ghost.style.top = g.t + 'px';
    ghost.style.width = g.w + 'px';
    ghost.style.height = g.h + 'px';
  };
  const hideGhost = () => {
    ghost.style.display = 'none';
  };

  let rafId = 0,
    pendingFn = null;
  function raf(fn) {
    pendingFn = fn;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const f = pendingFn;
      pendingFn = null;
      if (f) f();
    });
  }

  /* dock 高度 = 最高子卡（语音卡 86px 常比 location/control 折叠高 60px 更高）。
     历史 bug(t_829dd186)：刷新后恰好在语音卡还没排版时量到 60px → top = 730-60-12 = 658，
     语音卡底边落到 744 被视口裁掉。
     注意：只认「卡片级」子节点，并且把结果夹在 60–260 之间 —— 否则任何以百分比跟随
     dock 高度的子层都会形成「量到 → 写高 → 再量到更高」的反馈（实测会放大到 1.6e6 px）。 */
  function dockHeight(el) {
    let hMax = 0;
    [...el.children].forEach((c) => {
      try {
        const b = c.getBoundingClientRect();
        const card = c.classList && c.classList.contains('gev-lc');
        // 只认「正常卡片高度」(44–140)：几何被污染时（历史 store 值异常）不采信
        if (card && b.height >= 44 && b.height <= 140 && b.height > hMax)
          hMax = b.height;
      } catch (e) {}
    });
    const own = el.getBoundingClientRect().height || 0;
    if (!hMax && own >= 44 && own <= 140) hMax = own;
    return Math.ceil(Math.min(140, Math.max(60, hMax || 86)));
  }

  /* dock 几何复核：init 时语音卡可能还没排版（它有 saved 走 500ms 快启动路径，
     那时量到的是 location/control 的 60px），导致 top = vh-60-12 把语音卡顶出屏幕。
     这里按当前真实子卡高度重算一次，只在几何真的变了时才写。 */
  function syncDock() {
    const el = document.getElementById('command-dock');
    if (!el || !el.classList.contains('gev-win')) return;
    if (
      el.classList.contains('gev-win-dragging') ||
      el.classList.contains('gev-win-resizing')
    )
      return;
    const min = TARGETS['command-dock'] || { minW: 300, minH: 70 };
    const w = Math.max(min.minW, Math.min(476, vw() - 24));
    const h = dockHeight(el);
    const g = {
      l: Math.round((vw() - w) / 2),
      t: Math.round(vh() - h - 12),
      w: Math.round(w),
      h: Math.round(h),
    };
    const cur = store['command-dock'];
    if (cur && cur.l === g.l && cur.t === g.t && cur.w === g.w && cur.h === g.h)
      return;
    applyGeom(el, g);
    store['command-dock'] = g;
    save();
  }

  function initPanel(el, min) {
    if (el.classList.contains('gev-win')) return;
    const b = el.getBoundingClientRect();
    if (b.width < 100 || b.height < 50) return;
    const id = el.id;
    el.dataset.gevWinId = id;
    el.classList.add('gev-win');
    let g;
    if (id === 'command-dock') {
      // P1-4 视口重排：命令坞固定居中贴底，宽度随视口收缩(左右各留12px)，避免窄屏贴右/不居中
      const w = Math.max(min.minW, Math.min(476, vw() - 24));
      const h = dockHeight(el);
      g = {
        l: Math.round((vw() - w) / 2),
        t: Math.round(vh() - h - 12),
        w: Math.round(w),
        h: Math.round(h),
      };
    } else {
      g = store[id] ? { ...store[id] } : rectOf(el);
      g.w = Math.max(min.minW, g.w);
      g.h = Math.max(min.minH, g.h);
      g.l = clamp(g.l, 0, Math.max(0, vw() - g.w));
      g.t = clamp(g.t, 0, Math.max(0, vh() - g.h));
    }
    el.style.setProperty('transition', 'none', 'important'); // 首帧不滑动
    applyGeom(el, g);
    store[id] = g;
    save();
    if (id === 'command-dock') {
      // 语音卡排版晚于 dock 首帧：补三次复核（不用 ResizeObserver —— 会和 dock 高度互相触发）
      [260, 900, 2200].forEach((t) => setTimeout(syncDock, t));
    }
    setTimeout(() => {
      if (
        !el.classList.contains('gev-win-dragging') &&
        !el.classList.contains('gev-win-resizing')
      )
        el.style.removeProperty('transition');
    }, 60);

    // P2-2：缩放手柄已移除（改由卡片级边缘缩放承担，不再整体缩放容器）
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest(INTERACTIVE)) return;
      if (e.target.closest('.gev-lc')) return; // P1-2：卡片区域归卡片交互（边缘缩放/展开），容器拖动只在卡片间隙
      const top = el.getBoundingClientRect().top;
      if (e.clientY - top > HEADER_H) return; // 仅顶部把手区内可拖，避免劫持内容滚动
      startDrag(e, el);
    });
  }

  function startDrag(e, el) {
    const cur = rectOf(el),
      sx = e.clientX,
      sy = e.clientY;
    el.style.touchAction = 'none'; // 触摸拖动时禁页面滚动
    let started = false;
    const g = { l: cur.l, t: cur.t, w: cur.w, h: cur.h };
    const onMove = (ev) =>
      raf(() => {
        const dx = ev.clientX - sx,
          dy = ev.clientY - sy;
        if (!started && Math.hypot(dx, dy) < MOVE_TOL) return;
        if (!started) {
          started = true;
          el.classList.add('gev-win-dragging');
          el.style.setProperty('z-index', '2147482000', 'important');
          if (!ghost.parentNode) document.body.appendChild(ghost);
        }
        g.l = clamp(cur.l + dx, 0, Math.max(0, vw() - g.w));
        g.t = clamp(cur.t + dy, 0, Math.max(0, vh() - g.h));
        showGhost(snap(g, el));
        el.style.setProperty('left', g.l + 'px', 'important');
        el.style.setProperty('top', g.t + 'px', 'important');
        el.style.setProperty('opacity', '0.9', 'important');
      });
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.style.removeProperty('touch-action');
      if (started) {
        const sg = snap(g, el);
        el.classList.remove('gev-win-dragging');
        el.style.removeProperty('opacity');
        applyGeom(el, sg);
        store[el.dataset.gevWinId] = sg;
        save();
        hideGhost();
        el.style.removeProperty('z-index');
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startResize(e, el, min) {
    e.preventDefault();
    e.stopPropagation();
    const cur = rectOf(el),
      sx = e.clientX,
      sy = e.clientY;
    el.classList.add('gev-win-resizing');
    el.style.setProperty('z-index', '2147482000', 'important');
    const onMove = (ev) =>
      raf(() => {
        const w = clamp(cur.w + (ev.clientX - sx), min.minW, vw() - cur.l);
        const h = clamp(cur.h + (ev.clientY - sy), min.minH, vh() - cur.t);
        el.style.setProperty('width', Math.round(w) + 'px', 'important');
        el.style.setProperty('height', Math.round(h) + 'px', 'important');
      });
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.classList.remove('gev-win-resizing');
      el.style.removeProperty('z-index');
      const b = rectOf(el);
      store[el.dataset.gevWinId] = b;
      save();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function addResetBtn() {
    if (document.getElementById('gev-pw-reset')) return;
    const b = document.createElement('button');
    b.id = 'gev-pw-reset';
    b.textContent = '重置布局';
    b.style.cssText =
      'position:fixed;right:18px;bottom:calc(2vh + 12rem);z-index:2147482500;padding:6px 12px;font:600 11px/1 system-ui,sans-serif;color:#cfeaff;background:rgba(10,20,30,.72);border:1px solid rgba(0,212,255,.35);border-radius:999px;backdrop-filter:blur(12px);cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.4);';
    b.addEventListener('click', () => {
      try {
        localStorage.removeItem(KEY);
      } catch (e) {}
      location.reload();
    });
    document.body.appendChild(b);
  }

  function initAll() {
    Object.keys(TARGETS).forEach((id) => {
      const el = document.getElementById(id);
      if (el) initPanel(el, TARGETS[id]);
    });
    window.addEventListener('resize', () => {
      document.querySelectorAll('.gev-win').forEach((el) => {
        if (el.id === 'command-dock') {
          // P1-4：命令坞随视口重排——居中贴底、宽度收缩(留12px边距)
          const min = TARGETS['command-dock'] || { minW: 300, minH: 70 };
          const w = Math.max(min.minW, Math.min(476, vw() - 24));
          const h = dockHeight(el);
          const g = {
            l: Math.round((vw() - w) / 2),
            t: Math.round(vh() - h - 12),
            w: Math.round(w),
            h: Math.round(h),
          };
          applyGeom(el, g);
          store[el.id] = g;
          save();
          return;
        }
        const b = el.getBoundingClientRect();
        el.style.setProperty(
          'left',
          Math.round(clamp(b.left, 0, Math.max(0, vw() - b.width))) + 'px',
          'important',
        );
        el.style.setProperty(
          'top',
          Math.round(clamp(b.top, 0, Math.max(0, vh() - b.height))) + 'px',
          'important',
        );
      });
    });
  }

  function sigOf(L, R) {
    const lb = L.getBoundingClientRect(),
      rb = R.getBoundingClientRect();
    return [
      Math.round(lb.left),
      Math.round(lb.top),
      Math.round(lb.width),
      Math.round(lb.height),
      Math.round(rb.left),
      Math.round(rb.top),
      Math.round(rb.height),
    ].join(',');
  }

  function boot() {
    addResetBtn();
    if (!ghost.parentNode) document.body.appendChild(ghost);
    const hasSaved = Object.keys(TARGETS).some((id) => store[id]);
    if (hasSaved) {
      setTimeout(initAll, 500);
      return;
    }
    let last = null,
      stable = 0,
      tries = 0;
    (function wait() {
      const L = document.getElementById('left-panel-stack'),
        R = document.getElementById('right-context-rail');
      let ok = false;
      if (L && R) {
        const lb = L.getBoundingClientRect(),
          rb = R.getBoundingClientRect();
        ok =
          document.querySelectorAll('canvas').length >= 6 &&
          lb.width > 50 &&
          rb.width > 50;
        if (ok) {
          const s = sigOf(L, R);
          if (s === last) stable++;
          else {
            stable = 0;
            last = s;
          }
        }
      }
      if ((ok && stable >= 8) || ++tries > 150) {
        initAll();
        return;
      } // 稳定 8×200ms=1.6s
      setTimeout(wait, 200);
    })();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
  else setTimeout(boot, 1200);
})();
