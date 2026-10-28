#!/usr/bin/env node
/** probe: 单张卡「点击 header 收起」的时间线采样 —— 看 .gev-lc-floating / st.closing / st.floating 何时落定 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.resolve('.gev-logs/t_b37e6b4b');
fs.mkdirSync(OUT, { recursive: true });
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    window.__gevcDebug = false;
  } catch (e) {}
});
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1200);

const headPoint = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const head = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle') || el;
  const b = head.getBoundingClientRect();
  const isCtl = (n) => n && n.closest && n.closest('input,select,textarea,a,label,button:not(.panel-header):not(.dock-tray-toggle),.panel-collapse-btn,.context-radio-dock,.pp-toggle-btn,.scene-btn');
  let x = null, y = Math.round(b.top + b.height / 2);
  for (let i = 1; i <= 10; i++) {
    const cx = Math.round(b.left + (b.width * i) / 11);
    const hit = document.elementFromPoint(cx, y);
    if (hit && !isCtl(hit) && hit.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle') && hit.closest('[id="' + id + '"]')) { x = cx; break; }
  }
  if (x === null) x = Math.round(b.left + b.width / 2);
  const hit = document.elementFromPoint(x, y);
  return { x, y, hit: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 40) : 'null' };
}, id);
const clickCard = async (id) => {
  const p = await headPoint(id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  return p;
};
const sample = async (label) => page.evaluate((label) => {
  const out = { label, t: Math.round(performance.now()) };
  const cards = {};
  ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((id) => {
    const e = document.getElementById(id);
    if (!e) return;
    const b = e.getBoundingClientRect();
    const i = window.__gevLc.info(id);
    cards[id] = { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
      cls: e.className.replace(/gev-lc(-floating|-narrow)?/g, (m) => m).slice(0, 80),
      fltClass: e.classList.contains('gev-lc-floating'), collapsed: e.classList.contains('collapsed'),
      stFloating: i ? i.floating : null };
  });
  out.cards = cards;
  return out;
}, label);

const timeline = [];
const record = async (tag) => {
  const s = await sample(tag);
  timeline.push(s);
  const c = s.cards;
  console.log(tag.padEnd(14), IDS.map((id) => `${id}:${c[id] ? (c[id].fltClass ? 'F' : c[id].collapsed ? 'c' : '-') : '?'}${c[id] && c[id].stFloating ? '*' : ''}@${c[id] ? c[id].x + ',' + c[id].y + ' ' + c[id].w + 'x' + c[id].h : ''}`).join(' | '));
};

console.log('== 打开 data-panel（真实点击）==');
let p = await clickCard('data-panel');
console.log('  click at', p.x, p.y, 'hit', p.hit);
await sleep(700);
await record('open-data');

console.log('== 打开 scene-panel（真实点击）==');
p = await clickCard('scene-panel');
console.log('  click at', p.x, p.y, 'hit', p.hit);
await sleep(700);
await record('open-scene');

console.log('== 点 scene header 一次 → 观察 1500ms ==');
p = await clickCard('scene-panel');
console.log('  click at', p.x, p.y, 'hit', p.hit);
const t0 = Date.now();
for (let ms = 50; ms <= 1500; ms += 50) {
  const wait = t0 + ms - Date.now();
  if (wait > 0) await sleep(wait);
  await record('t+' + ms);
}

console.log('== 打开 control-panel（真实点击）==');
p = await clickCard('control-panel');
console.log('  click at', p.x, p.y, 'hit', p.hit);
await sleep(700);
await record('open-control');

console.log('== 点 control header 一次 → 观察 1500ms ==');
p = await clickCard('control-panel');
console.log('  click at', p.x, p.y, 'hit', p.hit);
const t1 = Date.now();
for (let ms = 50; ms <= 1500; ms += 50) {
  const wait = t1 + ms - Date.now();
  if (wait > 0) await sleep(wait);
  await record('c+' + ms);
}

fs.writeFileSync(path.join(OUT, 'probe-close-timeline.json'), JSON.stringify({ timeline, errs }, null, 1));
console.log('errors', JSON.stringify(errs));
await browser.close();
