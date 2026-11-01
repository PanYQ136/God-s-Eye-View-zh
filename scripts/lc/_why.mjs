#!/usr/bin/env node
/* 归因器：对指纹 diff 里的每个「元素×属性」，问浏览器「谁赢了、还有谁竞争、在哪个层」。
   用法: node scripts/lc/_why.mjs <baseFp.json> <newFp.json> [max]
   输出: 每条改动 + 命中声明（层/选择器/值/important），oneline 一元素一行。 */
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const A = JSON.parse(readFileSync(process.argv[2], 'utf8')).els;
const B = JSON.parse(readFileSync(process.argv[3], 'utf8')).els;
const MAX = Number(process.argv[4] || 30);
const URL = process.env.FP_URL || 'http://127.0.0.1:4173/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const changed = [];
for (const k of Object.keys(A)) {
  const x = A[k], y = B[k];
  if (!y) continue;
  const props = [];
  for (const p of Object.keys(x)) {
    if (p === '_box') continue;
    if (x[p] !== y[p]) props.push({ prop: p, from: x[p], to: y[p] });
  }
  if (props.length) changed.push({ key: k, props });
}

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist',
    '--force_high_performance_gpu', '--disable-background-timer-throttling'],
  protocolTimeout: 900000, defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready), { timeout: 90000 }).catch(() => {});
await sleep(8000);
/* 用与指纹生成器完全相同的 pathOf，把 key 映射成 DOM 下标属性 */
await page.evaluate((keys) => {
  const want = new Set(keys);
  function pathOf(el) {
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      let seg = n.tagName.toLowerCase();
      if (n.id) seg += '#' + n.id;
      if (n.classList && n.classList.length) seg += '.' + [...n.classList].join('.');
      const parent = n.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === n.tagName && c.id === n.id && String(c.className) === String(n.className));
        if (same.length > 1) seg += ':n' + same.indexOf(n);
      }
      parts.unshift(seg); n = parent;
    }
    return parts.join('>');
  }
  let i = 0;
  for (const el of document.querySelectorAll('body *')) {
    const k = pathOf(el);
    if (want.has(k)) el.setAttribute('data-fpid', String(i++));
  }
}, changed.map((c) => c.key));
const cdp = await page.createCDPSession();
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const out = [];
let idx = 0;
for (const c of changed.slice(0, MAX)) {
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-fpid="${idx}"]` }).catch(() => ({ nodeId: 0 }));
  idx++;
  if (!nodeId) { out.push({ el: c.key, err: 'noid' }); continue; }
  const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  const lines = [];
  for (const p of c.props.slice(0, 3)) {
    const hits = [];
    for (const r of m.matchedCSSRules || []) {
      const dl = (r.rule.style.cssProperties || []).find((q) => q.name === p.prop);
      if (!dl) continue;
      hits.push(`${(r.rule.layers || []).map((l) => l.text).join('>') || '(unlayered)'} | ${r.rule.selectorList.text.slice(0, 62)} = ${String(dl.value).slice(0, 30)}${dl.important ? ' !imp' : ''}`);
    }
    lines.push(`${p.prop}: ${String(p.from).slice(0, 30)} => ${String(p.to).slice(0, 30)}\n      ${hits.slice(-4).join('\n      ')}`);
  }
  out.push({ el: c.key.slice(-70), lines });
}
for (const o of out) {
  if (o.err) { console.log('!', o.el, o.err); continue; }
  console.log('*', o.el);
  for (const l of o.lines) console.log('   ', l);
}
console.log(`\nchanged elements: ${changed.length} (shown ${Math.min(MAX, changed.length)})`);
await browser.close();
