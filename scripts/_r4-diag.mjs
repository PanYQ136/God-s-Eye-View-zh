#!/usr/bin/env node
/**
 * _r4-diag.mjs — 诊断：① pp→control 顺序下 control 未展开（E 里出现）是否真实；
 * ② rapid 16 击漏击 2 次的真实原因（是遮挡还是「移动靶」）；③ voice 卡如何收起。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r4-t829');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__pd = [];
  window.addEventListener('pointerdown', (e) => {
    const c = e.target.closest && e.target.closest('.gev-lc');
    window.__pd.push({ t: Math.round(performance.now()), x: Math.round(e.clientX), y: Math.round(e.clientY), owner: c ? c.id : null, tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 40) });
    if (window.__pd.length > 60) window.__pd.shift();
  }, true);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const FOLD = CARDS.slice(0, 7);
const st = () => page.evaluate((IDS) => Object.fromEntries(IDS.map((id) => {
  const el = document.getElementById(id);
  if (!el) return [id, null];
  const r = el.getBoundingClientRect();
  return [id, { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], collapsed: el.classList.contains('collapsed'), floating: el.classList.contains('gev-lc-floating'), push: getComputedStyle(el).translate }];
})), CARDS);
const probe = async (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  if (!el) return { ok: false };
  const er = el.getBoundingClientRect();
  const pts = [];
  for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header, .dock-tray-toggle')) {
    const r = h.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  }
  pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(14, er.height / 2)) });
  const tried = [];
  for (const p of pts) {
    const e = document.elementFromPoint(p.x, p.y);
    tried.push({ p, hit: e ? (e.closest('.gev-lc') || {}).id || e.tagName : null });
    if (e && el.contains(e)) return { ok: true, at: [p.x, p.y], tried };
  }
  return { ok: false, tried };
}, id);
const click = async (id, wait = 40, tag = '') => {
  const pr = await probe(id);
  if (!pr.ok) return { id, ok: false, tried: pr.tried, tag };
  await page.mouse.move(pr.at[0], pr.at[1]);
  await page.mouse.down();
  await page.mouse.up();
  const pd = await page.evaluate(() => window.__pd[window.__pd.length - 1]);
  if (wait) await sleep(wait);
  return { id, ok: true, at: pr.at, pd, tag };
};
const closeAll = async () => {
  for (const id of FOLD) {
    const c = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
    if (c) { await click(id, 500); }
  }
  // 语音卡（非折叠卡，独立 toggle）：点它自己的按钮收起
  const vs = await page.evaluate(() => { const el = document.getElementById('gev-voice-control'); const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  if (vs.h > 120) {
    const b = await page.evaluate(() => {
      const el = document.getElementById('gev-voice-control');
      const t = el.querySelector('.gev-voice-button, .gev-mic-label, button') || el;
      const r = t.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.up();
    await sleep(600);
  }
  await sleep(300);
};

// ① pp → control 顺序（带 900ms 沉降）连跑 4 次
const seqRes = [];
for (let i = 0; i < 4; i++) {
  await closeAll();
  const before = await st();
  const a = await click('pp-toggles', 900);
  const mid = await st();
  const b = await click('control-panel', 900);
  await sleep(900);
  const after = await st();
  seqRes.push({ i, before: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v && v.rect])), clickPp: a, clickCtrl: b, midOpen: Object.entries(mid).filter(([, v]) => v && !v.collapsed).map(([k]) => k), after: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v && { r: v.rect, col: v.collapsed, push: v.push }])) });
  log('## seq', i, JSON.stringify(seqRes[seqRes.length - 1]).slice(0, 1500));
}
fs.writeFileSync(path.join(OUT, 'diag-seq.json'), JSON.stringify(seqRes, null, 1));

// ② rapid 16 击（40ms）两次，记录每次的命中与状态
const rapidRuns = [];
for (let run = 0; run < 2; run++) {
  await closeAll();
  const taps = [];
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control']) {
    const r = await click(id, 40);
    const openNow = await page.evaluate((IDS) => Object.fromEntries(IDS.map((k) => { const el = document.getElementById(k); return [k, el ? !el.classList.contains('collapsed') : null]; })), FOLD.concat(['gev-voice-control']));
    taps.push({ id, ok: r.ok, pdOwner: r.pd && r.pd.owner, tried: r.tried, openOpen: Object.entries(openNow).filter(([, v]) => v).map(([k]) => k) });
  }
  await sleep(2500);
  const final = await st();
  rapidRuns.push({ run, taps, final: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, v && { r: v.rect, col: v.collapsed }])) });
  log('## rapid', run, JSON.stringify(rapidRuns[rapidRuns.length - 1].taps.filter((t) => !t.ok)).slice(0, 1200));
  log('## rapid-final', run, JSON.stringify(rapidRuns[rapidRuns.length - 1].final));
}
fs.writeFileSync(path.join(OUT, 'diag-rapid.json'), JSON.stringify(rapidRuns, null, 1));
await page.screenshot({ path: path.join(OUT, 'DIAG-rapid-final.png') });
await browser.close();
console.log('WROTE diag json');
