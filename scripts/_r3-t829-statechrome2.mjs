#!/usr/bin/env node
/**
 * _r3-t829-statechrome2.mjs — 状态型 chrome 的「可见瞬间」证据
 * reviewer 的破口是「只测静止态」：这里在 #toast 真弹出、3 个 sync chip 真显示的那一帧，
 * 再做一次全页可见 backdrop-filter / 深色实底普查 + 截图，证明状态态也透明。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r3-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {};
const put = (k, v) => { res[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2000)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);
await page.evaluate(() => {
  window.__a = (c) => { const s = String(c || ''); const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(s) ? 1 : 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
  window.__imgA = (bi) => { if (!bi || bi === 'none') return 0; const m = [...String(bi).matchAll(/rgba?\(([^)]+)\)/g)].map((x) => { const p = x[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; }); return m.length ? Math.max(...m) : 0.5; };
  window.__vis = (el) => { if (!el) return false; const c = getComputedStyle(el); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  window.__scan = () => {
    const frosted = [], dark = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!window.__vis(el)) continue;
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
      const inCard = !!el.closest('.gev-lc');
      const a = Math.max(window.__a(c.backgroundColor), window.__imgA(c.backgroundImage));
      const rec = { id: el.id || null, tag: el.tagName, cls: String(el.className || '').slice(0, 40), bf, bg: c.backgroundColor, a: +a.toFixed(2), inCard, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
      if (bf !== 'none' && bf !== '') frosted.push(rec);
      if (!inCard && a > 0.15 && r.width * r.height > 300) dark.push(rec);
    }
    return { frostedCount: frosted.length, frosted, darkCount: dark.length, dark };
  };
});

// ── 1) 真实点击 tilt → #toast 弹出 → 同一帧普查 ──
const pt = await page.evaluate(() => { const r = document.getElementById('tilt-map-view').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.move(pt.x, pt.y); await sleep(80);
await page.mouse.down(); await sleep(45); await page.mouse.up();
await sleep(650);
const toastFrame = await page.evaluate(() => {
  const el = document.getElementById('toast');
  const c = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { scan: window.__scan(), toast: { text: (el.textContent || '').trim(), cls: String(el.className),
    bg: c.backgroundColor, bf: c.backdropFilter, border: c.borderColor, color: c.color, opacity: +(+c.opacity).toFixed(2),
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], visible: window.__vis(el) } };
});
put('toast_visible_frame', toastFrame);
await page.screenshot({ path: path.join(OUT, 'F1-toast-visible.png') });
await page.screenshot({ path: path.join(OUT, 'F1-toast-crop.png'), clip: { x: Math.max(0, toastFrame.toast.rect[0] - 40), y: Math.max(0, toastFrame.toast.rect[1] - 60), width: Math.min(W, toastFrame.toast.rect[2] + 80), height: toastFrame.toast.rect[3] + 100 } });
await page.mouse.move(300, 450); await sleep(400);

// ── 2) 3 个 sync chip：保持显示 1.2s（连续重置），同一帧普查 + 截图 ──
const chipFrame = await page.evaluate(async () => {
  const ids = ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip'];
  const keep = () => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.removeAttribute('hidden');
      el.classList.add('visible');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
    }
  };
  keep();
  const t = setInterval(keep, 30);
  await new Promise((r) => setTimeout(r, 1200));
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out[id] = { bg: c.backgroundColor, bgA: +window.__a(c.backgroundColor).toFixed(3), bf: c.backdropFilter,
      border: c.borderColor, color: c.color, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30), visible: window.__vis(el) };
  }
  const scan = window.__scan();
  clearInterval(t);
  return { chips: out, scan };
});
put('chips_visible_frame', chipFrame);
await page.screenshot({ path: path.join(OUT, 'F2-chips-visible.png') });
await page.screenshot({ path: path.join(OUT, 'F2-chips-crop.png'), clip: { x: 640, y: 60, width: 260, height: 140 } });

// 还原
await page.evaluate(() => {
  for (const id of ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.removeAttribute('style'); el.classList.remove('visible'); el.setAttribute('hidden', '');
  }
});
await sleep(300);
put('after_restore_scan', await page.evaluate(() => window.__scan()));
fs.writeFileSync(path.join(OUT, 'statechrome.json'), JSON.stringify(res, null, 2));
await browser.close();
console.log('DONE statechrome.json');
