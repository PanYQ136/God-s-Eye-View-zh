import './../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCollapsedA11y } from './panelA11y.js';

/** 常规面板：inner 内首个子元素是标题行，其后才是内容块。 */
function panelWithHeader(id) {
  const panel = document.createElement('section');
  panel.id = id;
  panel.className = 'gev-panel collapsed';
  panel.innerHTML = `
    <div class="panel-glow"></div>
    <div class="${id}-inner ui-scroll">
      <div class="ui-panel__head panel-header">
        <span class="panel-title">数据图层</span>
        <button type="button" class="panel-collapse-btn" aria-label="展开 数据图层"></button>
      </div>
      <div class="data-toggle-list"><button type="button">toggle</button></div>
    </div>`;
  return panel;
}

/** pp-toggles：标题行在内容滚动容器之外（同级 .compact）。 */
function panelWithOuterHeader() {
  const panel = document.createElement('section');
  panel.id = 'pp-toggles';
  panel.className = 'gev-panel collapsed';
  panel.innerHTML = `
    <div class="compact"><div class="pp-header-row">
      <button type="button" class="panel-collapse-btn" aria-label="展开"></button>
    </div></div>
    <div class="pp-panel-body"><button type="button">chip</button></div>`;
  return panel;
}

test('折叠卡的内容块整体 inert，标题行与展开按钮仍在可达树内', () => {
  const panel = panelWithHeader('cctv-panel');
  syncCollapsedA11y(panel, true);

  assert.equal(panel.getAttribute('aria-hidden'), null, '不再整卡隐藏');
  const header = panel.querySelector('.panel-header');
  assert.equal(header.getAttribute('data-collapsed'), 'true');
  assert.equal(
    panel.querySelector('.panel-collapse-btn').getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(header.inert, false, '标题行不能 inert');
  assert.equal(header.querySelector('button').closest('[inert]'), null);
  for (const block of panel.querySelectorAll('.data-toggle-list')) {
    assert.equal(block.inert, true, '内容块必须退出焦点与 a11y 树');
  }
  assert.equal(panel.querySelector('.panel-glow').inert, false);
});

test('展开态清掉 inert 并把 aria-expanded 收回 true', () => {
  const panel = panelWithHeader('data-panel');
  syncCollapsedA11y(panel, true);
  syncCollapsedA11y(panel, false);

  assert.equal(panel.querySelector('.data-toggle-list').inert, false);
  assert.equal(
    panel.querySelector('.panel-collapse-btn').getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(
    panel.querySelector('.panel-header').getAttribute('data-collapsed'),
    'false',
  );
});

test('标题行在滚动容器之外时只关内容容器，标题行不受牵连', () => {
  const panel = panelWithOuterHeader();
  syncCollapsedA11y(panel, true);

  assert.equal(panel.querySelector('.pp-panel-body').inert, true);
  const header = panel.querySelector('.pp-header-row');
  assert.equal(header.inert, false);
  assert.equal(header.querySelector('button').closest('[inert]'), null);
  assert.equal(
    header.querySelector('.panel-collapse-btn').getAttribute('aria-expanded'),
    'false',
  );
});

test('缺 DOM 查询能力的面板替身只清旧属性，不抛错', () => {
  const stub = {
    attributes: new Map([['aria-hidden', 'true']]),
    removeAttribute(key) {
      this.attributes.delete(key);
    },
    getAttribute(key) {
      return this.attributes.get(key) ?? null;
    },
  };
  syncCollapsedA11y(stub, true);
  assert.equal(stub.getAttribute('aria-hidden'), null);
});
