#!/usr/bin/env node
/**
 * _r3-mutex2.mjs — 互斥细节证据（class 级 + 几何级双口径）
 *  · classFrames: 以「卡片 .collapsed 类」为准 —— 关旧/开新是否同 tick、有没有 0 张在开的空档
 *  · geomFrames : 再加 width>200 —— morph 生长动画期间会短暂 <200（这是动画，不是空档）
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const W = 1536, H = 730;
const OUT = path.resolve('.gev-logs/r3-t829');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEFT = ['data-panel', 'scene-panel'];
const RIGHT = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
const res = { cases: [] };
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0 };
  for (const t of ['pointerdown', 'click']) document.addEventListener(t, (e) => { const o = window.__rv; if (t === 'pointerdown') { o.down++; if (e.isTrusted) o.downT++; } else { o.click++; if (e.isTrusted) o.clickT++; } }, true);
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);
await page.evaluate(() => {
  window.__a = (c) => { const s = String(c || ''); const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(s) ? 1 : 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
});
const state = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], area: Math.round(r.width * r.height), open: !el.classList.contains('collapsed'), hidden: getComputedStyle(el).visibility === 'hidden' };
  }
  return o;
}, [...LEFT, ...RIGHT]);
await sleep(1500);
const base = await state();
const isExp = (st, id) => st[id] && !st[id].hidden && st[id].area > base[id].area * 1.25 + 400;
const click = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const SEL = '.panel-header, .pp-header-row, .panel-title, .pp-header-label';
    for (const h of el.querySelectorAll(SEL)) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]]) {
        const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
        const e = document.elementFromPoint(x, y);
        const hh = e && e.closest ? e.closest(SEL) : null;
        if (hh && el.contains(hh) && (e.closest('.gev-lc') || {}).id === id) return { x, y };
      }
    }
    return null;
  }, id);
  if (!p) return false;
  await page.mouse.move(p.x, p.y); await sleep(50);
  await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(950);
  return true;
};
for (const [from, to] of [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'], ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']]) {
  let st = await state();
  if (!isExp(st, from)) { await click(from); await sleep(700); }
  await sleep(1200);
  await page.evaluate((L, R) => {
    window.__stop = false; window.__f = []; window.__cls = {};
    const t0 = performance.now();
    const cnt = (ids, geomet) => ids.filter((i) => { const e = document.getElementById(i); if (!e) return false; if (e.classList.contains('collapsed')) return false; if (!geomet) return true; const r = e.getBoundingClientRect(); return r.width > 200; }).length;
    const tick = () => { if (window.__stop) return; window.__f.push({ t: +(performance.now() - t0).toFixed(1), lc: cnt(L, false), rc: cnt(R, false), lg: cnt(L, true), rg: cnt(R, true) }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    for (const id of [...L, ...R]) { const el = document.getElementById(id); if (!el) continue; window.__cls[id] = []; new MutationObserver(() => window.__cls[id].push({ t: +(performance.now() - t0).toFixed(2), open: !el.classList.contains('collapsed') })).observe(el, { attributes: true, attributeFilter: ['class'] }); }
  }, LEFT, RIGHT);
  const okClick = await click(to);
  await sleep(1500);
  const rec = await page.evaluate(() => { window.__stop = true; return { f: window.__f, cls: window.__cls }; });
  const st2 = await state();
  const clsEmpty = rec.f.filter((s) => s.lc === 0 && s.rc === 0).length;
  const geomEmpty = rec.f.filter((s) => s.lg === 0 && s.rg === 0).length;
  const fromSeq = rec.cls[from] || [], toSeq = rec.cls[to] || [];
  const fromClose = fromSeq.find((e) => !e.open), toOpen = toSeq.find((e) => e.open);
  res.cases.push({ case: from + '->' + to, clicked: okClick, frames: rec.f.length,
    maxLeftClass: Math.max(...rec.f.map((s) => s.lc)), maxRightClass: Math.max(...rec.f.map((s) => s.rc)),
    maxLeftGeom: Math.max(...rec.f.map((s) => s.lg)), maxRightGeom: Math.max(...rec.f.map((s) => s.rg)),
    emptyFramesClass: clsEmpty, emptyFramesGeom: geomEmpty,
    fromClosedAtMs: fromClose ? fromClose.t : null, toOpenedAtMs: toOpen ? toOpen.t : null,
    gapMs: fromClose && toOpen ? +(toOpen.t - fromClose.t).toFixed(2) : null,
    end: { [from]: { expanded: isExp(st2, from), hidden: st2[from].hidden, inView: st2[from].rect[0] >= -1 && st2[from].rect[1] >= -1 }, [to]: { expanded: isExp(st2, to), rect: st2[to].rect } },
  });
  console.log('##', JSON.stringify(res.cases[res.cases.length - 1]));
  await page.screenshot({ path: path.join(OUT, 'E2b-mutex-' + from + '-to-' + to + '.png') });
}
res.pointerTrust = await page.evaluate(() => window.__rv);
console.log('## pointerTrust', JSON.stringify(res.pointerTrust));
fs.writeFileSync(path.join(OUT, 'mutex2.json'), JSON.stringify(res, null, 2));
await browser.close();
console.log('DONE mutex2.json');
