#!/usr/bin/env node
/* 诊断：左/右轨道与 dock 的子元素构成 + 点击 data-panel 的真实结果 */
import puppeteer from 'puppeteer';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=1980,20', '--hide-scrollbars'],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push('err: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 300)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await sleep(14000);

const compose = await page.evaluate(() => {
  const dump = (sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    return {
      rect: (() => { const b = root.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })(),
      kids: [...root.children].filter((c) => c.getBoundingClientRect().height > 2).map((c) => {
        const b = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return `${c.id || c.className || c.tagName} [${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}] disp=${cs.display} pos=${cs.position}`;
      }),
    };
  };
  return { left: dump('#left-panel-stack, .left-panel-stack'), right: dump('#right-context-rail'), dock: dump('#command-dock') };
});
console.log(JSON.stringify(compose, null, 1));

/* 点击 data-panel header 中心附近的干净点 */
const pt = await page.evaluate(() => {
  const e = document.querySelector('#data-panel .panel-header');
  const b = e.getBoundingClientRect();
  const NO = 'input,select,textarea,a,label,[role=slider],button,.panel-collapse-btn';
  for (let fy = 0.2; fy <= 0.85; fy += 0.1) for (let fx = 0.05; fx <= 0.95; fx += 0.08) {
    const x = Math.round(b.left + b.width * fx), y = Math.round(b.top + b.height * fy);
    const h = document.elementFromPoint(x, y);
    if (h && (h === e || e.contains(h)) && !h.closest(NO)) return { x, y, got: (h.className || h.tagName) + '', hdr: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] };
  }
  return { err: 'no-clean-point', hdr: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] };
});
console.log('click target:', JSON.stringify(pt));
await page.mouse.move(pt.x - 8, pt.y - 5, { steps: 3 });
await sleep(60);
await page.mouse.move(pt.x, pt.y, { steps: 3 });
await sleep(60);
await page.mouse.down();
await sleep(40);
await page.mouse.up();
await sleep(1200);
const after = await page.evaluate(() => {
  const e = document.getElementById('data-panel');
  const b = e.getBoundingClientRect();
  return {
    phase: e.dataset.lcPhase, collapsed: e.classList.contains('collapsed'),
    rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    parent: e.parentElement && (e.parentElement.id || e.parentElement.className),
    anims: e.getAnimations().map((a) => ({ state: a.playState, dur: a.effect.getTiming().duration })),
    scrollH: e.scrollHeight, clientH: e.clientHeight,
    state: window.__lc && window.__lc.api ? window.__lc.api.state().cards['data-panel'] : null,
    violations: window.__lc && window.__lc.violations,
    result: window.__lc && window.__lc.result ? { boxes: window.__lc.result.boxes, pushes: window.__lc.result.pushes } : null,
    morph: window.__lc && window.__lc.morph,
  };
});
console.log('after click:', JSON.stringify(after, null, 1));
console.log('logs:', logs.join('\n') || '(clean)');
await page.screenshot({ path: '.gev-logs/lc/diag-open.png' });
await browser.close();
