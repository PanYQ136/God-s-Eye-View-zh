#!/usr/bin/env node
/* 规则探针（CDP 版）：某元素上所有命中声明 + 来源层 + 最终 computed。
   用法: node scripts/lc/_ruleprobe.mjs "<css selector>" <property> [url] */
import puppeteer from 'puppeteer';
const SEL = process.argv[2];
const PROP = process.argv[3] || 'font-size';
const URL = process.argv[4] || 'http://127.0.0.1:4173/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist',
    '--force_high_performance_gpu', '--disable-background-timer-throttling'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready), { timeout: 90000 }).catch(() => {});
await sleep(7000);
const cdp = await page.createCDPSession();
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');
const PAIRS = SEL.includes('::') ? SEL.split(',,').map((x) => x.split('::')) : [[SEL, PROP]];
const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const allOut = [];
for (const [sel, prop] of PAIRS) {
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  if (!nodeId) { allOut.push({ sel, err: 'no node' }); continue; }
  const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  const computed = await page.evaluate((S, P) => { const el = document.querySelector(S); return el ? getComputedStyle(el).getPropertyValue(P) : null; }, sel, prop);
  const rows = [];
  for (const r of m.matchedCSSRules || []) {
    const dl = (r.rule.style.cssProperties || []).find((p) => p.name === prop);
    if (!dl) continue;
    rows.push({ layer: r.rule.layers && r.rule.layers.length ? r.rule.layers.map((l) => l.text).join('>') : '(unlayered)', sel: r.rule.selectorList.text.slice(0, 100), value: dl.value, imp: !!dl.important });
  }
  allOut.push({ sel, prop, computed, rows });
}
console.log(JSON.stringify(allOut, null, 1));
await browser.close();
process.exit(0);
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: SEL });
if (!nodeId) { console.log(JSON.stringify({ err: 'no node for ' + SEL })); await browser.close(); process.exit(1); }
const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
const computed = await page.evaluate((S, P) => {
  const el = document.querySelector(S);
  return el ? getComputedStyle(el).getPropertyValue(P) : null;
}, SEL, PROP);
const rows = [];
for (const r of m.matchedCSSRules || []) {
  const rule = r.rule;
  const decl = (rule.style.cssProperties || []).find((p) => p.name === PROP);
  if (!decl) continue;
  rows.push({
    layer: rule.layers && rule.layers.length ? rule.layers.map((l) => l.text).join('>') : '(unlayered)',
    selector: rule.selectorList.text.slice(0, 110),
    value: decl.value,
    important: !!decl.important,
  });
}
console.log(JSON.stringify({ computed, count: rows.length, rows }, null, 1));
await browser.close();
