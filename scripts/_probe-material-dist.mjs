#!/usr/bin/env node
/** _probe-material-dist.mjs — 9 卡内所有可见元素背景 alpha 分布（mini + 全展开） */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 60000 });
for (let i = 0; i < 100; i++) {
  const loading = await page.evaluate(() => {
    const l = document.getElementById('loading-screen');
    return l ? getComputedStyle(l).display !== 'none' && +getComputedStyle(l).opacity > 0.05 : false;
  });
  if (!loading) break;
  await sleep(400);
}
await sleep(7000);

const scan = () => page.evaluate((IDS) => {
  const alphaOf = (col) => {
    if (!col || col === 'transparent') return 0;
    const m = col.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const p = m[1].split(',').map(Number);
    return p.length > 3 ? p[3] : 1;
  };
  const hist = { 0: 0, '0-0.02': 0, '0.02-0.10': 0, '0.10-0.20': 0, '0.20-0.50': 0, '0.50+': 0 };
  const worst = [];
  let shellMax = 0;
  const dirs = { 'backdrop blur': [], 'filter': [], 'dark-text': [] };
  for (const id of IDS) {
    const root = document.getElementById(id);
    if (!root) continue;
    const rc = getComputedStyle(root);
    shellMax = Math.max(shellMax, alphaOf(rc.backgroundColor));
    const nodes = [root, ...root.querySelectorAll('*')];
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      if (cs.visibility === 'hidden' || +cs.opacity < 0.05 || cs.display === 'none') continue;
      const a = alphaOf(cs.backgroundColor);
      const bucket = a === 0 ? 0 : a <= 0.02 ? '0-0.02' : a <= 0.1 ? '0.02-0.10' : a <= 0.2 ? '0.10-0.20' : a <= 0.5 ? '0.20-0.50' : '0.50+';
      hist[bucket]++;
      if (a > 0.2) {
        worst.push({ card: id, el: el.tagName + '.' + String(el.className || '').slice(0, 34), bg: cs.backgroundColor, area: Math.round(r.width * r.height) });
      }
      if (cs.backdropFilter && cs.backdropFilter !== 'none') dirs['backdrop blur'].push({ card: id, el: el.tagName + '.' + String(el.className || '').slice(0, 30), v: cs.backdropFilter });
      if (cs.filter && cs.filter !== 'none' && /blur/.test(cs.filter)) dirs['filter'].push({ card: id, el: el.tagName + '.' + String(el.className || '').slice(0, 30), v: cs.filter });
      if (!el.children.length) {
        const t = (el.textContent || '').trim();
        const m = cs.color.match(/[\d.]+/g) || [255, 255, 255];
        const luma = (0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]) / 255;
        if (t && luma < 0.45) dirs['dark-text'].push({ card: id, txt: t.slice(0, 12), color: cs.color });
      }
    }
  }
  return { hist, worst: worst.slice(0, 12), shellMax, dirs: { blur: dirs['backdrop blur'], filter: dirs['filter'], darkText: dirs['dark-text'] } };
}, IDS);

const mini = await scan();
// 展开全部 7 张，再扫一次
const hdrOf = (id) => page.evaluate((id) => {
  const sel = id === 'pp-toggles' ? '#pp-toggles .pp-header-row'
    : (id === 'location-bar' || id === 'control-panel') ? '#' + id + ' .dock-tray-toggle'
      : '#' + id + ' .panel-header';
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  return { x: r.x + Math.min(26, r.width * 0.25), y: r.y + r.height / 2 };
}, id);
for (const id of ['pp-toggles', 'location-bar', 'control-panel']) {
  const p = await hdrOf(id);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await sleep(25); await page.mouse.up();
  await sleep(1200);
}
const expanded = await scan();
console.log(JSON.stringify({ mini, expanded }, null, 1));
await browser.close();
