/* ============================================================================
   GEV 液态玻璃卡片交互层（gev-liquid-cards.js）
   —— 9 个功能卡：玻璃皮标记(.gev-lc) + 边框悬停缩放 + 空白点击展开/收起(浮层) +
      WAAPI 350ms 弹簧对角拉伸 + 占位防挤动兄弟 + localStorage 持久化。
   配套 gev-liquid-cards.css；删 index.html 的 <link>/<script> 即回滚。
   不侵入内部逻辑：展开沿用原生 .collapsed（显示/隐藏 body），只换外壳尺寸与玻璃。
   ========================================================================== */
(function () {
  'use strict';

  /* ── 弹簧参数（硬编码固定） ─────────────────────────────────────────── */
  const SPRING = { duration: 350, stiffness: 260, damping: 20, mass: 1, samples: 26 };
  const MIN_W = 150, MIN_H = 44, EDGE_T = 6, CORNER = 14;

  /* ── 9 张卡配置：expanded 目标尺寸（展开后大卡） ─────────────────────── */
  const CARDS = {
    'data-panel':          { expW: 320, expH: 380 },
    'scene-panel':         { expW: 320, expH: 340 },
    'pp-toggles':          { expW: 300, expH: 430 },
    'cctv-panel':          { expW: 340, expH: 430 },
    'global-context-panel':{ expW: 320, expH: 400 },
    'location-bar':        { expW: 380, expH: 240 },
    'control-panel':       { expW: 520, expH: 380 },
    'gev-voice-control':   { expW: 260, expH: 240 },
    'gev-gfx-fab':         { expW: 0,   expH: 0   }, // 齿轮按钮：仅玻璃皮，不展开
  };
  const EDGES = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
  const INTERACTIVE = 'button,input,select,textarea,a,label,[role=slider],.pp-slider,.pp-select,.pp-mode-btn,' +
    '.gev-lc-edge,.panel-collapse-btn,.pp-collapse-btn,.dock-pin-btn,[data-no-toggle],.style-btn,.pp-toggle-btn,.scene-btn';

  const KEY = 'gev-liquid-cards:v2';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const vw = () => window.innerWidth, vh = () => window.innerHeight;
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; }
  const reg = {}; // 每卡 {el,st,cfg} 注册表（供确定性测试/调试）
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }, 160); };

  /* ── 弹簧 keyframes（FLIP：倒置变换→恒等，对角拉伸回弹） ─────────────── */
  function springProgress() {
    const { stiffness, damping, mass, samples, duration } = SPRING;
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    const wd = zeta < 1 ? w0 * Math.sqrt(1 - zeta * zeta) : 0;
    const T = duration / 1000, out = [];
    for (let i = 0; i <= samples; i++) {
      const t = (i / samples) * T; let p;
      if (zeta < 1) p = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
      else p = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
      out.push({ offset: i / samples, p });
    }
    return out;
  }
  function springKf(dx, dy, sx, sy) {
    return springProgress().map(({ offset, p }) => ({
      offset,
      transform: `translate(${(dx * (1 - p)).toFixed(2)}px,${(dy * (1 - p)).toFixed(2)}px) ` +
        `scale(${(sx + (1 - sx) * p).toFixed(4)},${(sy + (1 - sy) * p).toFixed(4)})`,
    }));
  }
  function runMorph(el, first) {
    const last = el.getBoundingClientRect();
    const sx = last.width ? first.width / last.width : 1;
    const sy = last.height ? first.height / last.height : 1;
    const dx = first.left - last.left, dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.004 && Math.abs(sy - 1) < 0.004) return null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce ? 0 : SPRING.duration;
    // 动画期给玻璃层「透镜调制」信号（gev-gl-glass 读 __gevGlassAnim：透镜带/厚度/色散增强 + 降载）
    if (!reduce) window.__gevGlassAnim = { t0: performance.now(), dur };
    window.__gevGlassAnimCount = (window.__gevGlassAnimCount || 0) + 1;
    setTimeout(() => { window.__gevGlassAnimCount = Math.max(0, (window.__gevGlassAnimCount || 0) - 1); }, dur + 120);
    return el.animate(springKf(dx, dy, sx, sy), { duration: dur, easing: 'linear', fill: 'none' });
  }

  /* ── P0-1：旧折射层（.gev-lg-warp + 逐卡 SVG 位移滤镜 + 位移图）已彻底删除 ────
     玻璃只由 public/gev-gl-glass.js 的 WebGL SDF 透镜着色器绘制；
     卡片本体保持透明，不再有任何内层玻璃/双描边。 */

  const ghost = document.createElement('div'); ghost.className = 'gev-lc-ghost'; document.body.appendChild(ghost);

  function initCard(el, cfg) {
    if (el.dataset.gevLc) return;
    el.dataset.gevLc = '1';
    el.classList.add('gev-lc');

    // 玻璃只由 WebGL 透镜层绘制；卡片内部不再插 warp/位移滤镜（P0-1）

    const expandable = cfg.expW > 0 && cfg.expH > 0;
    const st = { floating: false, miniRect: null, g: null, placeholder: null, dragMoved: false, closing: false, origParent: null };
    // 一致性守卫：浮层态绝不能同时 collapsed（否则外壳留白 / 与别卡重叠）
    try {
      new MutationObserver(function () {
        if (el.classList.contains('gev-lc-floating') && el.classList.contains('collapsed') && !st.closing) {
          el.classList.remove('collapsed');
        }
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
    reg[el.id] = { el, st, cfg };

    // 边框缩放热区（无可见把手）
    EDGES.forEach((d) => {
      const zone = document.createElement('div');
      zone.className = 'gev-lc-edge gev-lc-edge-' + d;
      zone.addEventListener('pointerdown', (e) => startResize(e, el, st, d));
      el.appendChild(zone);
    });

    // 持久化恢复（仅展开态 + 仅"带视口尺寸/sane坐标"的合法记录；脏记录直接清掉，杜绝刷新跳到左上角）
    const saved = store[el.id];
    if (saved && saved.floating && expandable && saved.x != null && saved.vw != null && saved.vh != null) {
      const sane = saved.x > 40 && saved.y > 40 && saved.x < vw() - 40 && saved.y < vh() - 40;
      const sameVp = Math.abs(saved.vw - vw()) <= vw() * 0.15 && Math.abs(saved.vh - vh()) <= vh() * 0.15;
      if (sane && sameVp) {
        setTimeout(() => { if (!st.floating) floatOpen(el, st, cfg, saved); }, 200);
      } else { delete store[el.id]; save(); }
    } else if (saved && saved.floating) {
      delete store[el.id]; save(); // 旧版记录(无 vw)或脏浮层 → 清除，回右栏，不再自动浮
    }

    // 空白点击：切换展开/收起（点内部控件/热区/拖动不触发）
    el.addEventListener('pointerdown', () => { st.dragMoved = false; });
    // 捕获阶段拦截：空白区的原生 click（面板自带折叠会双重触发），只让本层 toggle 生效
    el.addEventListener('click', (e) => {
      if (e.target.closest(INTERACTIVE)) return;
      e.stopPropagation(); e.preventDefault();
    }, true);
    el.addEventListener('pointerup', (e) => {
      if (!expandable) return;
      if (st.resizing) return;
      if (e.target.closest(INTERACTIVE)) return;
      if (st.dragMoved) { st.dragMoved = false; return; }
      toggleFloat(el, st, cfg);
    });

    // #1 面板内滚轮滚动：阻止冒泡穿透地图(缩放)，并直接驱动卡片 scrollTop（绕开内层滚动链断裂）
    el.addEventListener('wheel', (e) => {
      if (!el.classList.contains('gev-lc-floating')) return;
      e.stopPropagation();
      if (el.scrollHeight > el.clientHeight + 2) {
        el.scrollTop += (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
        e.preventDefault();
      }
    }, { passive: false });

    // 头部拖拽（仅浮层态可拖；迷你态由分组层负责）
    el.addEventListener('pointerdown', (e) => {
      const head = e.target.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.panel-inner');
      if (!head || e.target.closest(INTERACTIVE)) return;
      if (!st.floating) return;
      startDrag(e, el, st);
    });
  }

  function currentRect(el) { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; }

  // 互斥托盘组：同组是"同一 dock/rail 的互斥弹层"，展开其一自动隐藏组内兄弟（APP 原用 :has 实现），避免叠盖
  const EXCLUSIVE_GROUPS = [
    ['location-bar', 'control-panel', 'gev-voice-control'],   // #command-dock
    ['pp-toggles', 'cctv-panel', 'global-context-panel'],     // 右侧 rail
    ['data-panel', 'scene-panel'],                            // 左侧 rail（展开其一隐藏另一，消除叠盖/互斥展开）
  ];
  function otherRects(selfEl) {
    const out = [];
    for (const id in CARDS) {
      if (id === selfEl.id) continue;
      const e = document.getElementById(id);
      if (!e) continue;
      // 仅跳过"同源(左栈 data/scene)的折叠 mini tab"，其它组折叠 tab(右栏等)仍作障碍
      const sameOrigin = (selfEl.id === 'data-panel' || selfEl.id === 'scene-panel') && (id === 'data-panel' || id === 'scene-panel');
      if (e.classList.contains('collapsed') && sameOrigin) continue;
      const r = e.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    // 底部安全区：整条底部状态栏(定位/FPS/性能模式/中EN/版权/引擎)不可被浮层覆盖
    const safeTop = vh() - 158;
    out.push({ left: -9999, top: safeTop, right: vw() + 9999, bottom: vh() + 9999 });
    // 顶部安全区：左上 Logo(0–90) 与右上「当前风格」(y32) 不可被展开面板覆盖（#4/#5）
    out.push({ left: -9999, top: -9999, right: vw() + 9999, bottom: 84 });
    return out;
  }
  // 求不与其它卡片重叠的位置（级联外扩搜索 + 视口钳制）；无解则返回钳制后原位
  function resolvePos(selfEl, x, y, w, h) {
    const maxX = Math.max(0, vw() - w), maxY = Math.max(0, vh() - h);
    const cl = (v, m) => Math.max(0, Math.min(m, v));
    x = cl(x, maxX); y = cl(y, maxY);
    const others = otherRects(selfEl), M = 8;
    const hit = (px, py) => others.some(r => px < r.right + M && px + w > r.left - M && py < r.bottom + M && py + h > r.top - M);
    if (!hit(x, y)) return { x, y };
    const step = 28;
    for (let ring = 1; ring <= 48; ring++) {
      const cands = [[x + ring * step, y], [x - ring * step, y], [x, y + ring * step], [x, y - ring * step],
        [x + ring * step, y + ring * step], [x - ring * step, y - ring * step], [x + ring * step, y - ring * step], [x - ring * step, y + ring * step]];
      for (const c of cands) { const cx = cl(c[0], maxX), cy = cl(c[1], maxY); if (!hit(cx, cy)) return { x: cx, y: cy }; }
    }
    return { x, y };
  }

  function toggleFloat(el, st, cfg) { st.floating ? floatClose(el, st, cfg) : floatOpen(el, st, cfg, null); }

  function floatOpen(el, st, cfg, restored) {
    const first = currentRect(el);
    st.miniRect = { left: first.left, top: first.top, width: first.width, height: first.height };
    // 占位保尺寸，兄弟不位移
    const ph = document.createElement('div');
    ph.className = 'gev-lc-placeholder';
    ph.style.width = first.width + 'px'; ph.style.height = first.height + 'px';
    ph.style.flex = '0 0 auto';
    // 关键：复制原卡片的 flex order（App 用 order 给左栈 data=1/scene=2 排序），否则占位默认 order:0 会跑到最上、
    // 把另一张卡挤到本卡槽位（=“数据图层跳进场景默认位”）。占位同位后兄弟不位移。
    try { const _ord = getComputedStyle(el).order; if (_ord) ph.style.order = _ord; } catch (e) {}
    el.parentNode.insertBefore(ph, el);
    st.placeholder = ph;
    st.origParent = el.parentNode; // 记录原父，关闭时归位

    // ① 脱层：加浮层类、展开 body、一律移到 body 顶层（摆脱左栈/dock 容器的 max-height/flex/display 钳制，
    //    使内容按自然高度完整渲染）；占位符保留在原容器内、兄弟不位移
    el.classList.add('gev-lc-floating');
    el.classList.remove('collapsed');
    try { document.body.appendChild(el); } catch (e) {}

    // 互斥托盘：隐藏同组兄弟（且从碰撞检测中消失），避免叠盖
    st.hiddenSibs = [];
    let _grpMinTop = first.top;
    const _exGrp = EXCLUSIVE_GROUPS.find(g => g.indexOf(el.id) >= 0);
    if (_exGrp) {
      _exGrp.forEach((sid) => {
        if (sid === el.id) return;
        const s = document.getElementById(sid);
        if (!s || s.style.display === 'none') return;
        const sr = s.getBoundingClientRect();
        if (sr.height > 4 && sr.top < _grpMinTop) _grpMinTop = sr.top; // 记录同组最上沿，供贴顶展开
        // P0-4：兄弟卡一律「收起为 header」（morph），绝不 display:none
        st.hiddenSibs.push({ el: s, wasCollapsed: s.classList.contains('collapsed') });
        s.classList.add('collapsed');
      });
    }

    const w = clamp(restored ? restored.w : cfg.expW, MIN_W, vw());
    el.style.width = w + 'px';
    // ② 高度：恢复态用存储值；否则按真实内容高（gl 模式已让 inner/list 不拉伸）撑开，再钳制视口
    let h;
    if (restored && restored.h) {
      h = clamp(restored.h, MIN_H, vh());
    } else {
      // P0-4 性能：不在这里读 scrollHeight（会触发整页同步布局，实测单帧 300ms+ 卡顿）。
      // 直接用配置目标高度起动画；落定后卡内内容可滚动（overflow:auto），不受裁切影响。
      h = clamp(cfg.expH || 360, MIN_H, vh() - 166);
    }
    // ③ 位置（P0-4：兄弟卡收起成 header 后必须仍可见，不能被展开卡压住）
    //    · 左栏/右栏：展开卡落在「已收起兄弟 header 的下方」
    //    · 命令坞：展开卡向上长（dock 在底部）
    let _sibBottom = 0;
    (st.hiddenSibs || []).forEach((o) => {
      const r = o.el.getBoundingClientRect();
      if (r.height > 4 && r.bottom > _sibBottom) _sibBottom = r.bottom;
    });
    const isDock = (el.id === 'location-bar' || el.id === 'control-panel' || el.id === 'gev-voice-control');
    let baseY = first.top;
    if (isDock) baseY = Math.max(0, first.top - h - 10);
    else if (_sibBottom > 0) baseY = _sibBottom + 10;
    let x = clamp(restored ? restored.x : first.left, 0, Math.max(0, vw() - w));
    let y = clamp(restored ? restored.y : baseY, 0, Math.max(0, vh() - h));
    const _rp = resolvePos(el, x, y, w, h); x = _rp.x; y = _rp.y;

    // P0-3 右栏三卡：底部钳制在右下悬浮按钮(明暗/齿轮/启动引擎)之上，避免覆盖
    if (el.id === 'pp-toggles' || el.id === 'cctv-panel' || el.id === 'global-context-panel') {
      const bl = vh() - 150;
      if (y + h > bl) { h = Math.max(MIN_H, bl - y); if (y + h > bl) y = Math.max(0, bl - h); }
    }

    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.overflowY = 'auto';
    st.floating = true; st.g = { x, y, w, h };

    const anim = runMorph(el, first);
    const persist = !!restored; // 仅"恢复展开/拖动后"记忆坐标；纯点击展开不记忆 → 刷新不再自动浮到旧位置
    const done = () => {
      if (persist) { store[el.id] = { floating: true, x, y, w, h, vw: vw(), vh: vh() }; }
      else { store[el.id] = { floating: false }; }
      save();
      // 落定后仅做一次视口钳制（不再跨屏重新搜索，避免"落定后又跳一下"）
      setTimeout(() => {
        if (!st.floating || !st.g) return;
        const cx = Math.max(0, Math.min(vw() - st.g.w, st.g.x));
        const cy = Math.max(0, Math.min(vh() - st.g.h, st.g.y));
        if (Math.abs(cx - st.g.x) > 1 || Math.abs(cy - st.g.y) > 1) {
          st.g.x = cx; st.g.y = cy;
          el.style.left = cx + 'px'; el.style.top = cy + 'px';
          if (persist) { store[el.id] = { floating: true, x: cx, y: cy, w: st.g.w, h: st.g.h, vw: vw(), vh: vh() }; save(); }
        }
      }, 180);
    };
    if (anim) anim.onfinish = done; else done();
  }

  function floatClose(el, st, cfg) {
    const first = currentRect(el);
    st.closing = true;
    const m = st.miniRect || { left: first.left, top: first.top, width: 176, height: 50 };
    el.style.left = m.left + 'px'; el.style.top = m.top + 'px';
    el.style.width = m.width + 'px'; el.style.height = m.height + 'px';
    const anim = runMorph(el, first);
    const done = () => {
      el.classList.add('collapsed');
      el.classList.remove('gev-lc-floating');
      el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = ''; el.style.overflowY = ''; el.style.position = ''; el.style.zIndex = '';
      // 移回原父（占位符位置）再移除占位符，避免左栈钳制残留
      try {
        if (st.origParent) {
          if (st.placeholder && st.placeholder.parentNode === st.origParent) st.origParent.insertBefore(el, st.placeholder);
          else st.origParent.appendChild(el);
        }
      } catch (e) {}
      if (st.placeholder && st.placeholder.parentNode) st.placeholder.parentNode.removeChild(st.placeholder);
      if (st.hiddenSibs && st.hiddenSibs.length) {
        st.hiddenSibs.forEach((o) => {
          try {
            if (o.wasCollapsed !== undefined) { if (!o.wasCollapsed) o.el.classList.remove('collapsed'); }
            else { o.el.style.display = o.disp; }
          } catch (e) {}
        });
        st.hiddenSibs = [];
      }
      st.placeholder = null; st.origParent = null; st.floating = false; st.g = null;
      store[el.id] = { floating: false }; save();
      st.closing = false;
    };
    if (anim) anim.onfinish = done; else done();
  }

  function startDrag(e, el, st) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const g0 = { ...st.g }; const sx = e.clientX, sy = e.clientY;
    let raf = 0, last = null;
    const move = (ev) => {
      last = ev; if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const nx = clamp(g0.x + (last.clientX - sx), 0, Math.max(0, vw() - g0.w));
        const ny = clamp(g0.y + (last.clientY - sy), 0, Math.max(0, vh() - g0.h));
        if (Math.abs(nx - g0.x) > 3 || Math.abs(ny - g0.y) > 3) st.dragMoved = true;
        st.g.x = nx; st.g.y = ny;
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (st.dragMoved && st.g) {
        const rp = resolvePos(el, st.g.x, st.g.y, st.g.w, st.g.h);
        st.g.x = rp.x; st.g.y = rp.y; el.style.left = rp.x + 'px'; el.style.top = rp.y + 'px';
        store[el.id] = { floating: true, x: rp.x, y: rp.y, w: st.g.w, h: st.g.h, vw: vw(), vh: vh() }; save();
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  function startResize(e, el, st, dir) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    // P0 解耦根治：仅「已展开(浮层)」态可边缘缩放。迷你态拖边缘不再产生游离浮层，
    // 杜绝「缩放迷你→变 floating→刷新后兄弟互斥被隐藏 / 左栏下跳」两类 bug。仍 stopPropagation 防落到容器拖动。
    if (!st.floating) return;
    st.resizing = true;
    const b = el.getBoundingClientRect();
    const s = { left: b.left, top: b.top, width: b.width, height: b.height };
    const wasFloating = st.floating;
    // 固定锚点：未浮动则先脱离父流(占位防兄弟跳)并转为固定定位，缩放过程不再受父布局重排影响（#2/#3）
    if (!wasFloating) {
      const ph = document.createElement('div');
      ph.className = 'gev-lc-placeholder';
      ph.style.width = s.width + 'px'; ph.style.height = s.height + 'px'; ph.style.flex = '0 0 auto';
      el.parentNode.insertBefore(ph, el);
      st.placeholder = ph; st.origParent = el.parentNode;
      // 注意：缩放不改 collapsed、不加 gev-lc-floating（避免触发 App 的 :has 互斥把同组兄弟隐藏，#3）
      st.floating = true; st.miniRect = { left: s.left, top: s.top, width: s.width, height: s.height }; st.hiddenSibs = [];
    }
    el.style.position = 'fixed';
    el.style.left = s.left + 'px'; el.style.top = s.top + 'px';
    el.style.width = s.width + 'px'; el.style.height = s.height + 'px';
    el.style.zIndex = '2147483000'; el.style.margin = '0';
    st.g = { x: s.left, y: s.top, w: s.width, h: s.height };
    const sx = e.clientX, sy = e.clientY; let raf = 0, last = null;
    const move = (ev) => {
      last = ev; if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const dx = last.clientX - sx, dy = last.clientY - sy;
        let x = s.left, y = s.top, w = s.width, h = s.height;
        if (dir.includes('e')) w = s.width + dx;
        if (dir.includes('s')) h = s.height + dy;
        if (dir.includes('w')) { w = s.width - dx; x = s.left + dx; }
        if (dir.includes('n')) { h = s.height - dy; y = s.top + dy; }
        if (w < MIN_W) { if (dir.includes('w')) x = s.left + (s.width - MIN_W); w = MIN_W; }
        if (h < MIN_H) { if (dir.includes('n')) y = s.top + (s.height - MIN_H); h = MIN_H; }
        if (x < 0) { w += x; x = 0; } if (y < 0) { h += y; y = 0; }
        if (x + w > vw()) w = vw() - x; if (y + h > vh()) h = vh() - y;
        st.g = { x, y, w, h };
        el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px';
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (st.g) { store[el.id] = { floating: true, x: st.g.x, y: st.g.y, w: st.g.w, h: st.g.h, vw: vw(), vh: vh() }; save(); }
      setTimeout(() => { st.resizing = false; }, 80);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  let bootTries = 0;
  function boot() {
    Object.keys(CARDS).forEach((id) => {
      const el = document.getElementById(id);
      if (el) { try { initCard(el, CARDS[id]); } catch (err) { console.warn('[gev-lc] init fail', id, err); } }
    });
    bootTries++;
    if (bootTries === 1) console.log('[gev-liquid-cards] ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 600));
  else setTimeout(boot, 600);
  // 迟到/动态生成的卡片（如 gev-voice-control）重试捕获，initCard 幂等
  let tries = 0;
  const iv = setInterval(() => { boot(); if (++tries > 15) clearInterval(iv); }, 1000);

  // 液态玻璃「通透/加实」切换按钮：默认通透(纯库效果)，按在齿轮左侧
  function initTheme() {
    const root = document.documentElement;
    if (!root.dataset.gevGlass) {
      try { root.dataset.gevGlass = localStorage.getItem('gev-liquid-cards:theme') || 'light'; }
      catch (e) { root.dataset.gevGlass = 'light'; }
    }
    if (document.querySelector('.gev-lc-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'gev-lc-toggle'; btn.type = 'button';
    const upd = () => {
      const light = root.dataset.gevGlass === 'light';
      btn.textContent = light ? '☀' : '☾';
      btn.title = light ? '液态玻璃：通透（点击切可读磨砂）' : '液态玻璃：可读磨砂（点击切通透）';
      btn.setAttribute('aria-label', btn.title);
    };
    btn.addEventListener('click', () => {
      root.dataset.gevGlass = root.dataset.gevGlass === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('gev-liquid-cards:theme', root.dataset.gevGlass); } catch (e) {}
      upd();
    });
    upd();
    btn.style.right = '70px'; btn.style.bottom = '22px';
    document.body.appendChild(btn);
    // 尽量贴到齿轮(#gev-gfx-fab)左侧
    let n = 0;
    const place = () => {
      const fab = document.getElementById('gev-gfx-fab');
      if (fab && btn.isConnected) {
        const r = fab.getBoundingClientRect();
        if (r.width) {
          btn.style.right = ''; btn.style.bottom = '';
          btn.style.left = (r.left - 48) + 'px';
          btn.style.top = (r.top + (r.height - 40) / 2) + 'px';
          clearInterval(t);
        }
      }
      if (++n > 12) clearInterval(t);
    };
    const t = setInterval(place, 800); place();
  }
  initTheme();

  /* ── UI 结构调整（不改业务逻辑/地图/GPU）：#6 删Apple按钮 #8 重置布局入画面设置 ── */
  // #7 顶部定位改用 CSS（#gev-locate-btn/#gev-perf-wrap/#gev-lang-toggle 的 fixed 钉位），避免与 App 每帧回写冲突
  function applyTopChipStyle() {
    try {
      var reset = document.getElementById('reset-globe-view'); if (!reset) return;
      var r = reset.getBoundingClientRect(); if (!r.width) return;
      var top = Math.round(r.top + (r.height - 30) / 2), x = Math.round(r.right + 12), rules = '';
      ['gev-locate-btn', 'gev-perf-wrap', 'gev-lang-toggle'].forEach(function (id) {
        var el = document.getElementById(id); if (!el) return;
        rules += 'html.gev-gl-on #' + id + '{position:fixed!important;top:' + top + 'px!important;left:' + x + 'px!important;right:auto!important;bottom:auto!important;height:30px!important;margin:0!important;z-index:2147480000!important;}\n';
        var w = el.getBoundingClientRect().width || 60; x += w + 12;
      });
      var st = document.getElementById('gev-topchip-style');
      if (!st) { st = document.createElement('style'); st.id = 'gev-topchip-style'; document.head.appendChild(st); }
      if (st.textContent !== rules) st.textContent = rules;
    } catch (e) {}
  }
  function injectResetIntoGfx() {
    try {
      var gfx = document.getElementById('gev-gfx-panel');
      var rb = document.getElementById('gev-pw-reset');
      if (rb) rb.style.setProperty('display', 'none', 'important');
      if (!gfx || !rb) return;
      if (document.getElementById('gev-menu-resetlayout')) return;
      var row = document.createElement('div'); row.className = 'row';
      var b = document.createElement('button'); b.id = 'gev-menu-resetlayout'; b.type = 'button'; b.textContent = '重置布局';
      b.addEventListener('click', function () { try { rb.click(); } catch (e) {} });
      row.appendChild(b);
      var reload = gfx.querySelector('.reload');
      if (reload && reload.parentNode === gfx) gfx.insertBefore(row, reload); else gfx.appendChild(row);
    } catch (e) {}
  }
  function moveRailsUp() {
    try {
      // 左栏 App 自然 top≈190，上移 96 到 ~94；右栏 App 自然 top≈94 已合适，不再位移（否则顶出屏幕）
      var L = document.getElementById('left-panel-stack');
      if (L) { L.style.setProperty('padding-top', '0', 'important'); L.style.setProperty('transform', 'translateY(-96px)', 'important'); }
      var R = document.getElementById('right-context-rail');
      if (R) { R.style.setProperty('padding-top', '0', 'important'); R.style.removeProperty('transform'); }
    } catch (e) {}
  }
  function applyUiFixes() {
    try {
      var lgt = document.getElementById('lg-glass-trigger'); if (lgt) lgt.remove();
      var lgm = document.getElementById('lg-glass-menu'); if (lgm) lgm.remove();
      injectResetIntoGfx();
      applyTopChipStyle();
      moveRailsUp();
    } catch (e) {}
  }
  applyUiFixes();
  // 注意：整页 childList 观察器不能每次都同步跑 applyUiFixes（它含多次 getBoundingClientRect + 写 <style>，
  // 每次 DOM 变动都触发会积累成百毫秒级长帧）；改成 220ms 尾部防抖。
  try {
    var _afeT = 0;
    new MutationObserver(function () {
      clearTimeout(_afeT);
      _afeT = setTimeout(applyUiFixes, 220);
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  try { var fab0 = document.getElementById('gev-gfx-fab'); if (fab0) fab0.addEventListener('click', function () { setTimeout(applyUiFixes, 60); }, true); } catch (e) {}
  window.addEventListener('resize', function () { applyTopChipStyle(); moveRailsUp(); });
  // P1-3 兄弟恢复兜底：互斥组内无任何展开/缩放卡时，强制把被隐藏的兄弟显示回来（防异常路径漏还原）
  function healExclusive() {
    try {
      EXCLUSIVE_GROUPS.forEach(function (g) {
        var anyOpen = g.some(function (id) { var r = reg[id]; return r && (r.st.floating || r.st.resized); });
        if (!anyOpen) g.forEach(function (id) { var e = document.getElementById(id); if (e && e.style.display === 'none') e.style.display = ''; });
      });
    } catch (e) {}
  }
  try { window.addEventListener('visibilitychange', healExclusive); window.addEventListener('focus', healExclusive); } catch (e) {}

  // CDP 验证入口
  window.__gevLc = {
    cards: CARDS, store: () => store,
    toggle: (id) => { const r = reg[id]; if (r) toggleFloat(r.el, r.st, r.cfg); return !!r; },
    open: (id) => { const r = reg[id]; if (r && !r.st.floating) floatOpen(r.el, r.st, r.cfg, null); },
    close: (id) => { const r = reg[id]; if (r && r.st.floating) floatClose(r.el, r.st, r.cfg); },
    info: (id) => { const r = reg[id]; if (!r) return null; const b = r.el.getBoundingClientRect(); return { floating: r.st.floating, collapsed: r.el.classList.contains('collapsed'), x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; },
    _rp: (id) => { const r = reg[id]; if (!r) return null; const b = r.el.getBoundingClientRect(); return resolvePos(r.el, b.left, b.top, b.width, b.height); },
    _others: (id) => { const r = reg[id]; return r ? otherRects(r.el).map(o => [Math.round(o.left), Math.round(o.top), Math.round(o.right), Math.round(o.bottom)]) : null; },
  };
})();
