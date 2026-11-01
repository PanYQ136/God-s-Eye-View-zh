#!/usr/bin/env node
/* Phase8D 样式指纹：把页面上每个元素的 computed style + 盒模型落成 JSON，
   供 `_cssfp-diff.mjs` 做「改 CSS 前后零视觉变化」的机器判据。
   用法: node scripts/lc/_cssfp.mjs <out.json> [url]
   环境: NEEDS dev server http://127.0.0.1:4173 */
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const OUT = process.argv[2] || 'fp.json';
const URL = process.argv[3] || 'http://127.0.0.1:4173/?welcome=0';
const SETTLE = Number(process.env.FP_SETTLE || 9000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROPS = [
  'display', 'position', 'visibility', 'opacity', 'z-index', 'overflow-x', 'overflow-y',
  'width', 'height', 'top', 'left', 'right', 'bottom', 'transform', 'translate',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'row-gap', 'column-gap', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'justify-content',
  'color', 'background-color', 'background-image', 'background-size', 'background-position',
  'box-shadow', 'text-shadow', 'filter', 'backdrop-filter', '-webkit-backdrop-filter', 'mix-blend-mode',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-top-width', 'border-top-color', 'border-top-style',
  'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
  'fill', 'stroke', 'pointer-events', 'cursor', 'outline-color', 'outline-width',
  '--lc-radius', '--lc-radius-inner', '--lc-fill', '--lc-soft-fill', '--lc-shell-shadow', '--lc-tint-a', '--lc-tint-rgb', '--lc-shadow-rgb', '--lc-fg-flip',
];

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready), { timeout: 90000 }).catch(() => {});
/* 加载遮罩是打字机动画 + 定时消失，属于一次性瞬态：必须等它彻底收起再量，否则指纹不可比 */
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none';
}, { timeout: 45000 }).catch(() => {});
/* 瞬态/数据驱动的 DOM：加载遮罩（打字机）、toast（按文案变宽）、
   Cesium 版权灯箱（随数据源注册增删 li）、GPU 提示条。它们与样式层叠无关，且每次运行状态不同。 */
await page.addStyleTag({ content:
  '#loading-screen,.loader-content,#gev-toast,#gev-gpu-notice,.cesium-credit-lightbox-overlay,#global-loading-status{display:none !important}' });
await sleep(SETTLE);
await page.mouse.move(700, 400);
await sleep(400);
/* 确定性冻结：这些 CSS 变量由 JS（lens 5Hz tint / renderer 阴影与高光 / pointer）动态写入，
   每次运行取值不同，属于「已知噪声」而非样式层叠差异。冻结 = 把写入入口掐掉 + 写死常量，
   前后两次跑同一份常量，于是 computed style 的差异只可能来自 CSS 层叠本身。
   动画同样归零到 t=0 并暂停（keyframes 的 opacity 抖动 0.49↔0.77 属同一类噪声）。 */
await page.evaluate(() => {
  const DYN = ['--lc-tint-rgb', '--lc-tint-a', '--lc-shadow-rgb', '--lc-shadow-a', '--lc-gloss-x', '--lc-gloss-a', '--lc-scrim-a', '--lc-push-x', '--lc-push-y', '--lc-fg-flip'];
  const FIXED = { '--lc-tint-rgb': '40, 60, 80', '--lc-tint-a': '0.020', '--lc-shadow-rgb': '8, 10, 14', '--lc-shadow-a': '0.140', '--lc-gloss-x': '50.0%', '--lc-gloss-a': '0.120', '--lc-scrim-a': '0.00', '--lc-push-x': '0px', '--lc-push-y': '0px', '--lc-fg-flip': '#eaf4ff' };
  const proto = CSSStyleDeclaration.prototype;
  const orig = proto.setProperty;
  proto.setProperty = function (k, v, p) { if (DYN.indexOf(k) >= 0) return; return orig.call(this, k, v, p); };
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (!el.style) continue;
    for (const k of DYN) orig.call(el.style, k, FIXED[k]);
  }
  try {
    for (const a of document.getAnimations()) {
      /* 过渡（CSSTransition）就地跳终点：暂停会把它冻在中间，两次跑取值不同 */
      if (typeof a.transitionProperty === 'string') { try { a.finish(); } catch (e) {} }
      else { a.currentTime = 0; a.pause(); }
    }
  } catch (e) {}
});
await sleep(300);

const data = await page.evaluate((PROPS) => {
  function pathOf(el) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      let seg = n.tagName.toLowerCase();
      if (n.id) seg += '#' + n.id;
      if (n.classList && n.classList.length) seg += '.' + [...n.classList].join('.');
      const parent = n.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === n.tagName && c.id === n.id && String(c.className) === String(n.className));
        if (same.length > 1) seg += `:n${same.indexOf(n)}`;
      }
      parts.unshift(seg);
      n = parent;
    }
    return parts.join('>');
  }
  const out = {};
  const SKIP = '#loading-screen,#gev-toast,#gev-gpu-notice,.cesium-credit-lightbox-overlay,#global-loading-status,.brand-logo,.title-glow,#hud-rec-dot,.hud-rec,#intel-hud';
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
    if (el.closest(SKIP)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const rec = { _box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    /* 内联样式是「JS 写的值」，不是层叠结果；A/B 时用它区分「层叠改了」和「JS 这次没写」 */
    rec._inline = (el.getAttribute('style') || '').slice(0, 200);
    for (const p of PROPS) rec[p] = cs.getPropertyValue(p);
    const key = pathOf(el);
    if (out[key]) out[key + '#dup'] = rec; else out[key] = rec;
  }
  return { url: location.href, count: Object.keys(out).length, els: out,
    layerOrder: (() => { try { return [...document.styleSheets].map((s) => (s.href || 'inline')); } catch (e) { return String(e); } })() };
}, PROPS);

writeFileSync(OUT, JSON.stringify(data, null, 0));
console.log(JSON.stringify({ out: OUT, elements: data.count, errors: errs.slice(0, 6) }));
await browser.close();
