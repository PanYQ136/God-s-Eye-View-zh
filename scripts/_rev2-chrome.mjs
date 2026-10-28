#!/usr/bin/env node
/**
 * _rev2-chrome.mjs — t_829dd186 返工（chrome 透明化）验证探针
 * 1) 具体 10 个目标元素的 computed（bg / bgImage / backdrop-filter / color / rect）
 * 2) 全页「卡外」材质普查：任何 alpha>2% 的填充、任何非 none 的 backdrop-filter、
 *    任何带 alpha>2% 的渐变层
 * 3) 1536×730 截屏（onboarding 已抑制）
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = process.env.GEV_URL || 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/rev2-chrome');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
page.on('console', (m) => { if (m.type() === 'error') console.log('[page-error] ' + m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);

const res = await page.evaluate(() => {
  const alpha = (c) => {
    const s = String(c);
    if (!s || s === 'transparent') return 0;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const p = m[1].split(',').map(Number);
    return p.length > 3 ? p[3] : 1;
  };
  const gradAlpha = (img) => {
    const s = String(img || '');
    if (!s || s === 'none') return 0;
    let mx = 0;
    const re = /rgba?\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(s))) {
      const p = m[1].split(',').map(Number);
      const a = p.length > 3 ? p[3] : 1;
      if (a > mx) mx = a;
    }
    return mx;
  };
  const ids = ['clear-selected-layers', 'share-btn', 'tilt-map-view', 'north-up-view',
    'reset-globe-view', 'key-setup-chip', 'gev-lang-toggle', 'gev-locate-btn',
    'gev-perf-btn', 'gev-toast', 'gev-perf-fps'];
  const targets = ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, missing: true };
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      id,
      bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3),
      bgImg: c.backgroundImage.slice(0, 90), bgImgA: +gradAlpha(c.backgroundImage).toFixed(3),
      bf: c.backdropFilter, color: c.color,
      rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      inView: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
      visible: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05,
    };
  });

  const inv = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.gev-lc') || el.closest('.dock-popover-content')) continue;
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) continue;
    if (r.width < 8 || r.height < 8) continue;
    const bgA = alpha(c.backgroundColor);
    const imgA = gradAlpha(c.backgroundImage);
    const bf = c.backdropFilter && c.backdropFilter !== 'none' ? c.backdropFilter : '';
    const area = r.width * r.height;
    const bad = (bgA > 0.02 && area > 400) || imgA > 0.02 || !!bf;
    if (!bad) continue;
    inv.push({
      id: el.id || '', tag: el.tagName, cls: String(el.className).slice(0, 40),
      bg: c.backgroundColor, bgA: +bgA.toFixed(3), imgA: +imgA.toFixed(3),
      bgImg: c.backgroundImage === 'none' ? '' : c.backgroundImage.slice(0, 60),
      bf, color: c.color,
      rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18),
    });
  }
  return { targets, inv };
});

console.log('## targets');
for (const t of res.targets) console.log(JSON.stringify(t));
console.log('## chrome_inventory count=' + res.inv.length);
for (const x of res.inv) console.log(JSON.stringify(x));

fs.writeFileSync(path.join(OUT, 'targets.json'), JSON.stringify(res.targets, null, 1));
fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(res.inv, null, 1));
await page.screenshot({ path: path.join(OUT, 'initial-chrome.png') });

// ── 追加：目标档案（#gev-dossier）是「点目标才出现」的浮层，首屏 opacity:0，
//    上面的普查会跳过它；这里只为了量「材质」，临时加 .show 量 computed 后还原。
const dossier = await page.evaluate(() => {
  const el = document.getElementById('gev-dossier');
  if (!el) return { missing: true };
  const had = el.classList.contains('show');
  el.classList.add('show');
  const alpha = (c) => {
    const s = String(c); if (!s || s === 'transparent') return 0;
    const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return 0;
    const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1;
  };
  const gradAlpha = (img) => {
    const s = String(img || ''); if (!s || s === 'none') return 0;
    let mx = 0, m; const re = /rgba?\(([^)]+)\)/g;
    while ((m = re.exec(s))) { const p = m[1].split(',').map(Number); const a = p.length > 3 ? p[3] : 1; if (a > mx) mx = a; }
    return mx;
  };
  const out = [];
  const nodes = [el, ...el.querySelectorAll('*')];
  for (const n of nodes) {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (c.display === 'none' || r.width < 8 || r.height < 8) continue;
    const bgA = alpha(c.backgroundColor), imgA = gradAlpha(c.backgroundImage);
    const bf = c.backdropFilter && c.backdropFilter !== 'none' ? c.backdropFilter : '';
    if (bgA <= 0.02 && imgA <= 0.02 && !bf) continue;
    out.push({ sel: (n.id ? '#' + n.id : n.tagName + '.' + String(n.className).split(' ')[0]),
      bg: c.backgroundColor, bgA: +bgA.toFixed(3), imgA: +imgA.toFixed(3), bf,
      rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] });
  }
  const self = getComputedStyle(el);
  const res2 = { bf: self.backdropFilter, bg: self.backgroundColor, bgImg: self.backgroundImage.slice(0, 60), bad: out };
  if (!had) el.classList.remove('show');
  return res2;
});
console.log('## dossier: ' + JSON.stringify(dossier));
fs.writeFileSync(path.join(OUT, 'dossier.json'), JSON.stringify(dossier, null, 1));
await browser.close();
