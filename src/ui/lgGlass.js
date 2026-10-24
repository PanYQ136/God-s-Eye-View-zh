/**
 * Apple Liquid Glass 组件（按钮 + 菜单）— 上帝之眼网页端
 *
 * 材质参数全部来自 src/ui/styles/lg-glass.css（官方 Figma iOS 27 导出，参数锁定）。
 * 本模块只做「挂载 + 交互」，不写任何材质数值、不改其它层的 z-index。
 *
 * 层级约定（沿用 foundation.css 令牌）：
 *   按钮 → 挂在 #top-center-actions 内，继承 --z-hud(100)
 *   菜单 → var(--z-popup, 200)；遮罩 199
 *
 * CDP 验证入口：window.__gevLiquidGlass = { open, close, toggle, setTheme, state }
 */
const TRIGGER_ID = 'lg-glass-trigger';
const MENU_ID = 'lg-glass-menu';
const BACKDROP_ID = 'lg-glass-backdrop';

/** 菜单项都是组件自演示动作，不触碰任何既有链路 */
const MENU_ITEMS = [
  { label: '玻璃按钮 44×44', hint: 'scale 0.275', action: 'noop' },
  { label: '玻璃菜单 320×N', hint: 'scale 2.0', action: 'noop' },
  { label: '切换明暗变体', hint: 'Light / Clear', action: 'theme' },
  { label: '关闭菜单', hint: 'Esc', action: 'close' },
];

let state = { open: false, theme: 'dark' };
let menuEl = null;
let backdropEl = null;
let triggerEl = null;

function buildMenu() {
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'lg-glass lg-glass-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Liquid Glass 组件菜单');
  menu.dataset.open = 'false';

  const title = document.createElement('div');
  title.className = 'lg-glass-menu__title';
  title.textContent = 'Apple Liquid Glass';
  menu.appendChild(title);

  MENU_ITEMS.forEach((item, i) => {
    if (i === MENU_ITEMS.length - 1) {
      const sep = document.createElement('div');
      sep.className = 'lg-glass-menu__sep';
      menu.appendChild(sep);
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lg-glass-menu__item';
    row.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = item.label;                 // 静态常量，无用户输入
    const hint = document.createElement('span');
    hint.className = 'lg-glass-menu__hint';
    hint.textContent = item.hint;
    row.append(label, hint);
    row.addEventListener('click', () => {
      if (item.action === 'close') closeMenu();
      else if (item.action === 'theme') toggleTheme();
    });
    menu.appendChild(row);
  });

  return menu;
}

function positionMenu() {
  if (!menuEl || !triggerEl) return;
  const r = triggerEl.getBoundingClientRect();
  const gap = 10;
  const w = menuEl.offsetWidth || 320;
  const h = menuEl.offsetHeight || 0;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
  let top = r.bottom + gap;
  if (h && top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - gap);
  menuEl.style.left = `${Math.round(left)}px`;
  menuEl.style.top = `${Math.round(top)}px`;
}

function onDocPointerDown(e) {
  if (!state.open) return;
  if (menuEl && menuEl.contains(e.target)) return;
  if (triggerEl && triggerEl.contains(e.target)) return;
  closeMenu();
}

function openMenu() {
  if (!menuEl || state.open) return;
  state.open = true;
  menuEl.dataset.open = 'true';
  triggerEl.setAttribute('aria-expanded', 'true');
  positionMenu();
  // 不使用全屏遮罩（避免整屏 pointer-events 遮挡地图/Cesium 交互）；
  // 改用 document 捕获监听，点菜单/按钮外即关闭——零全屏元素。
  document.addEventListener('pointerdown', onDocPointerDown, true);
}

function closeMenu() {
  if (!menuEl || !state.open) return;
  state.open = false;
  menuEl.dataset.open = 'false';
  triggerEl.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onDocPointerDown, true);
}

function toggleMenu() {
  if (state.open) closeMenu();
  else openMenu();
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  const nodes = [menuEl, triggerEl].filter(Boolean);
  nodes.forEach((el) => el.classList.toggle('lg-glass--light', state.theme === 'light'));
}

function toggleTheme() {
  applyTheme(state.theme === 'light' ? 'dark' : 'light');
}

const SKIN_SELECTORS = [
  '#command-dock .dock-tray-toggle',
  '#command-dock #gev-voice-button',
  '#command-dock .gev-voice-tier-btn',
  '#command-dock #control-panel-toggle',
  '#right-context-rail .pp-collapse-btn',
  '#right-context-rail .pp-toggle-btn',
];
function skinDockRail() {
  for (const sel of SKIN_SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.classList.contains('lg-glass-skin')) el.classList.add('lg-glass-skin');
    });
  }
}

function mount() {
  const nav = document.getElementById('top-center-actions');
  if (!nav || document.getElementById(TRIGGER_ID)) return false;

  triggerEl = document.createElement('button');
  triggerEl.id = TRIGGER_ID;
  triggerEl.type = 'button';
  triggerEl.className = 'lg-glass lg-glass-btn';
  triggerEl.setAttribute('aria-haspopup', 'true');
  triggerEl.setAttribute('aria-expanded', 'false');
  triggerEl.setAttribute('aria-label', '液态玻璃组件菜单');
  triggerEl.title = 'Apple Liquid Glass';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'flare';
  triggerEl.appendChild(icon);
  triggerEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // 放在导航末尾：不改变既有 5 个按钮的位置与语义
  nav.appendChild(triggerEl);

  menuEl = buildMenu();
  document.body.appendChild(menuEl);
  applyTheme(state.theme);

  // 指令坞 / 右栏按钮玻璃化（含动态渲染/展开后新出现的按钮）
  skinDockRail();
  [400, 1200, 3000].forEach((t) => setTimeout(skinDockRail, t));
  try {
    let st = null;
    const scheduleSkin = () => {
      if (st) return;
      st = setTimeout(() => { st = null; skinDockRail(); }, 200);
    };
    new MutationObserver(scheduleSkin).observe(document.body, { childList: true, subtree: true });
  } catch { /* ignore */ }

  const onKey = (e) => {
    if (e.key === 'Escape' && state.open) closeMenu();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => {
    if (state.open) positionMenu();
  });

  return true;
}

if (typeof window !== 'undefined') {
  window.__gevLiquidGlass = {
    mount,
    open: openMenu,
    close: closeMenu,
    toggle: toggleMenu,
    setTheme: applyTheme,
    skin: skinDockRail,
    get state() {
      return { ...state };
    },
    get elements() {
      return { trigger: triggerEl, menu: menuEl, backdrop: backdropEl };
    },
  };

  const boot = () => {
    if (mount()) return;
    // 模板可能在 main.js 之后才注入，重试到上限
    let tries = 0;
    const timer = setInterval(() => {
      if (mount() || ++tries > 40) clearInterval(timer);
    }, 250);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
