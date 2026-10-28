#!/usr/bin/env node
/* 诊断：8 卡展开后，SEL[id] 各候选选择器是否存在 / 能否拿到可点命中点 */
import puppeteer from 'puppeteer';

const URL = 'http://127.0.0.1:4173/';
const W = 1536;
const H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
const SEL = {
  'data-panel': ['#data-panel .panel-header', '#data-panel .panel-title'],
  'scene-panel': ['#scene-panel .panel-header', '#scene-panel .panel-title'],
  'pp-toggles': ['#pp-toggles .pp-header-row', '#pp-toggles .pp-header-label'],
  'cctv-panel': ['#cctv-panel .panel-header', '#cctv-panel .panel-title'],
  'global-context-panel': ['#global-context-panel .panel-header', '#global-context-panel .panel-title'],
  'location-bar': ['#location-bar .dock-tray-toggle', '#location-bar .location-toolbar', '#location-bar .location-toolbar-label'],
  'control-panel': ['#control-panel-toggle', '#control-panel .dock-tray-toggle', '#control-panel .panel-header'],
  'gev-voice-control': ['#gev-voice-control .gev-voice-heading', '#gev-voice-control .gev-voice-readout'],
};
const MAIN = {
  'pp-toggles': '#pp-toggles .pp-header-row',
  'control-panel': '#control-panel-toggle',
  'location-bar': '#location-bar .dock-tray-toggle',
};

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(9000);

const phases = () => page.evaluate(() => (window.__lc ? window.__lc.api.phases() : null));
const point = (sel) => page.evaluate((sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  const NO = 'input,select,textarea,a,label,[role=slider],button,.panel-collapse-btn,.pp-slideer,.pp-slider';
  for (let fy = 0.3; fy <= 0.8; fy += 0.1)
    for (let fx = 0.08; fx <= 0.92; fx += 0.07) {
      const x = Math.round(b.left + b.width * fx);
      const y = Math.round(b.top + b.height * fy);
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      const inHeader = hit.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.location-toolbar,.panel-title,.pp-header-label,.location-toolbar-label,.gev-voice-heading,.gev-voice-readout');
      const inCard = hit.closest('.gev-lc');
      if (inHeader && inCard && !hit.closest(NO)) return { x, y, got: (hit.className || hit.tagName) + '' };
    }
  return { x: null, y: null, got: 'no-hit', box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] };
}, sel);

for (const id of IDS) {
  await page.evaluate((id) => window.__lc.api.dispatch({ type: 'ESC', id }), id);
  await sleep(700);
  const miniSel = MAIN[id] || `#${id} .panel-header`;
  let p = await point(miniSel);
  let used = miniSel;
  if (!p || p.got === 'no-hit') { for (const c of SEL[id]) { const q = await point(c); if (q && q.got !== 'no-hit') { p = q; used = c; break; } } }
  if (!p || p.got === 'no-hit') { console.log(`OPEN-FAIL ${id}  no point (mini)`); continue; }
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await sleep(30);
  await page.mouse.down();
  await sleep(25);
  await page.mouse.up();
  await sleep(900);
  const ph = (await phases())[id];
  const rows = [];
  for (const c of SEL[id]) {
    const q = await point(c);
    rows.push({ sel: c, exists: !!(await page.evaluate((s) => !!document.querySelector(s), c)), pt: q });
  }
  console.log(`\n${id}  phase=${ph}  openUse=${used}`);
  for (const r of rows) console.log(`   ${r.exists ? 'EXIST' : 'MISS '}  ${r.sel}  ${r.pt ? r.pt.got : 'null'}`);
  const tree = await page.evaluate((id) => {
    const el = document.getElementById(id);
    return el ? el.innerHTML.slice(0, 320).replace(/\s+/g, ' ') : 'NO-EL';
  }, id);
  console.log('   html:', tree);
}
await browser.close();
