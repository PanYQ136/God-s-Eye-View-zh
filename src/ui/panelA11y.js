/**
 * 折叠卡的可达性同步（Q2 / Q3）。
 *
 * 桌面侧栏是手风琴：折叠卡只露出标题行，内容被视觉收起。原先的做法是给
 * 整张卡挂 `aria-hidden="true"`，但标题行里就有「展开」按钮 —— 一个可聚焦
 * 元素被塞进从 a11y 树里摘掉的子树，既让屏幕阅读器读不到唯一的恢复入口，
 * 也构成 aria-hidden-focus 违规。
 *
 * 这里把两件事拆开：
 *   - 标题行保持可读、可聚焦、可键盘操作（展开按钮补 aria-expanded）；
 *   - 内容块用 `inert` 整体退出焦点顺序与 a11y 树，语义比 aria-hidden 更强。
 *
 * 不改变面板结构与外观，只在已有 DOM 上同步属性，展开时原值清空。
 */

const HEADER_SEL = '.panel-header, .pp-header-row';
const TOGGLE_SEL = '.panel-collapse-btn';
const GLOW_CLASS = 'panel-glow';

/** 内容块：标题行之外、需要随折叠一起退出可达性的元素。 */
function resolveContentBlocks(panel, header) {
  const blocks = [...panel.children].filter(
    (child) => !child.classList.contains(GLOW_CLASS),
  );
  const host = blocks[blocks.length - 1] || panel;
  if (header && header.parentElement === host) {
    // 常规面板：header 是 scroll 容器的首个子元素，其余兄弟才是内容。
    return [...host.children].filter((child) => child !== header);
  }
  // 标题行在容器之外（如 pp-toggles 的 .compact）：整个容器即内容。
  return [host];
}

/**
 * @param {Element} panel 面板根节点
 * @param {boolean} collapsed 是否处于折叠态
 */
export function syncCollapsedA11y(panel, collapsed) {
  if (!panel) return;
  panel.removeAttribute('aria-hidden');
  // 布局单测用轻量面板替身（只有 classList / setAttribute），
  // 缺 DOM 查询能力时只清掉旧属性，不再做结构增强。
  if (typeof panel.querySelector !== 'function') return;
  const header = panel.querySelector(HEADER_SEL);
  const toggle =
    (header && header.querySelector(TOGGLE_SEL)) ||
    panel.querySelector(TOGGLE_SEL);
  if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const state = collapsed ? 'true' : 'false';
  if (header) header.setAttribute('data-collapsed', state);
  for (const block of resolveContentBlocks(panel, header)) {
    block.inert = !!collapsed;
  }
}
