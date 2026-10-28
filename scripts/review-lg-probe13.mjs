#!/usr/bin/env node
/**
 * review-lg-probe13.mjs —— 帧率 + 审计复核（本轮 CSS 改动后的回归确认）
 *  A) 冻结 Cesium 后的静止帧率：玻璃开 / 玻璃关 各 2.5s，报 p50/p95/max/fps 与 scale/dpr
 *  B) 结构审计：9 卡 · 每卡 quad · 卡内 backdrop-filter=0 · 纯黑文字=0 · 可见滚动条=0（并列出可疑元素）
 *  C) 语音卡结构：scrim 变量 / data-gev-lum / 计算背景
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { errors: [] };
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2500));

const sample = async (ms) => page.evaluate((ms2) => new Promise((res) => {
  const ts = [];
  const t0 = performance.now();
  const step = (t) => { ts.push(t); if (t - t0 < ms2) requestAnimationFrame(step); else res(ts); };
  requestAnimationFrame(step);
}), ms);
const stats = (ts) => {
  const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  const q = (p) => +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1);
  return { frames: ts.length, p50: q(0.5), p95: q(0.95), max: +d[d.length - 1].toFixed(1), fps: +(1000 / q(0.5)).toFixed(1) };
};

out.frozen = await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) { return false; } return true; });
await new Promise((r) => setTimeout(r, 1200));
out.idleGlassOn = stats(await sample(2500));
await page.evaluate(() => { const g = document.getElementById('gev-gl-glass'); if (g) g.style.display = 'none'; });
await new Promise((r) => setTimeout(r, 600));
out.idleGlassOff = stats(await sample(2500));
await page.evaluate(() => { const g = document.getElementById('gev-gl-glass'); if (g) g.style.display = ''; });
await new Promise((r) => setTimeout(r, 600));
out.stats = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, dev: s.dev, count: s.count, dpr: window.devicePixelRatio }; });

/* B) 审计 */
out.audit = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];
  const present = ids.filter((i) => document.getElementById(i)).length;
  const lc = [...document.querySelectorAll('.gev-lc')];
  const inner = [...document.querySelectorAll('.gev-lc *')].filter((e) => {
    const cs = getComputedStyle(e);
    return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
  }).map((e) => e.id || String(e.className).slice(0, 40));
  const black = [...document.querySelectorAll('.gev-lc *, .gev-lc')].filter((e) => {
    const c = getComputedStyle(e).color;
    return c === 'rgb(0, 0, 0)' && (e.textContent || '').trim() && e.offsetParent;
  }).length;
  const scrollers = [...document.querySelectorAll('*')].filter((e) => {
    if (!e.offsetParent) return false;
    const cs = getComputedStyle(e);
    const oy = cs.overflowY, ox = cs.overflowX;
    if (!/(auto|scroll)/.test(oy + ox)) return false;
    return e.scrollHeight - e.clientHeight > 4 || e.scrollWidth - e.clientWidth > 4;
  }).map((e) => [e.id || String(e.className).slice(0, 40), e.scrollHeight, e.clientHeight, e.scrollWidth, e.clientWidth]);
  return { present, cards: lc.length, innerBackdrop: inner, blackText: black, scrollers, glassSurfaces: window.__gevGlStats().surfaces.length };
});
/* C) 语音卡结构 */
out.voice = await page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  if (!el) return null;
  const shell = el.closest('.gev-lc') || el;
  const cs = getComputedStyle(shell);
  return {
    isGevLc: shell.classList.contains('gev-lc'), lum: shell.getAttribute('data-gev-lum'),
    bg: cs.backgroundColor, backdrop: cs.backdropFilter,
    vars: ['--gev-std-bg', '--gev-std-bg-bright'].map((v) => [v, cs.getPropertyValue(v).trim()]),
    detail: (() => { const d = document.getElementById('gev-voice-detail'); return d ? getComputedStyle(d).color : null; })(),
  };
});
out.errors = out.errors.slice(0, 6);
fs.writeFileSync(OUT + '/review-probe13.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
