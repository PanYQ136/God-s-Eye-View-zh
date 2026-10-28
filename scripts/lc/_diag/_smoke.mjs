#!/usr/bin/env node
/* 冒烟：启动 → 读 __lc 状态/相位/几何 + console 错误 + 点一张卡看是否展开 */
import puppeteer from 'puppeteer';
const W = 1536,
  H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=1980,20', '--hide-scrollbars', '--enable-gpu', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 220));
});
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 220)));
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240; i++) {
  const gone = await page.evaluate(() => {
    const l = document.querySelector('#loading-screen');
    return !l || parseFloat(getComputedStyle(l).opacity || '1') < 0.05;
  }).catch(() => false);
  if (gone) break;
  await sleep(400);
}
await sleep(6000);
const probe = async (label) => {
  const s = await page.evaluate((IDS) => {
    const out = { booted: !!window.__lcBooted, ready: !!(window.__lc && window.__lc.api && window.__lc.api.ready), api: !!(window.__lc && window.__lc.api) };
    out.phases = window.__lc && window.__lc.api ? window.__lc.api.phases() : null;
    out.assert = window.__lc && window.__lc.api ? window.__lc.api.assert() : null;
    out.cards = {};
    for (const id of IDS) {
      const e = document.getElementById(id);
      if (!e) { out.cards[id] = null; continue; }
      const b = e.getBoundingClientRect();
      out.cards[id] = {
        phase: e.dataset.lcPhase, collapsed: e.classList.contains('collapsed'),
        rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        parent: e.parentElement && (e.parentElement.id || e.parentElement.className),
        placeholders: document.querySelectorAll('.gev-lc-placeholder').length,
        stage: !!document.getElementById('lc-stage'),
      };
    }
    out.diag = window.__lc && window.__lc.diagnostics;
    out.violations = (window.__lc && window.__lc.violations) || null;
    return out;
  }, IDS);
  console.log('---', label, '---');
  console.log(JSON.stringify(s, null, 1));
};
await probe('after boot');

/* 真实点击 data-panel header */
const clickHeader = async (sel) => {
  const pt = await page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const NO = 'input,select,textarea,a,label,[role=slider],button,p';
    for (let fy = 0.25; fy <= 0.8; fy += 0.12)
      for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
        const x = Math.round(b.left + b.width * fx), y = Math.round(b.top + b.height * fy);
        const h = document.elementFromPoint(x, y);
        if (h && (h === e || e.contains(h)) && !h.closest(NO)) return { x, y, got: h.className || h.tagName };
      }
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), got: 'center-fallback' };
  }, sel);
  if (!pt) return null;
  await page.mouse.move(pt.x - 10, pt.y - 6, { steps: 3 });
  await sleep(50);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await sleep(50);
  await page.mouse.down();
  await sleep(30);
  await page.mouse.up();
  return pt;
};
console.log('click data-panel:', JSON.stringify(await clickHeader('#data-panel .panel-header')));
await sleep(1200);
await probe('after click data-panel');
console.log('--- console ---');
console.log(logs.slice(0, 25).join('\n') || '(clean)');
await page.screenshot({ path: '.gev-logs/lc/smoke-open.png' });
await browser.close();
