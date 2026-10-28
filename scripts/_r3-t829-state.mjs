#!/usr/bin/env node
/**
 * _r3-t829-state.mjs — t_829dd186 round-3 · 状态型 chrome + 初始态 + 7 header 中心透明
 * 覆盖 reviewer 「最低合格线 3」要求：点 tilt 后读 #toast computed；强制/自然触发
 * #global-loading-status / #traffic-sync-chip / #cctv-sync-chip 各读一次 computed；
 * 全页（排除卡内）深色实底 / 磨砂普查；7 个 header 真实点击 + 卡片中心材质采样。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r3-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const res = { started: new Date().toISOString() };
const put = (k, v) => { res[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2400)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860',
    '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, move: 0 };
  for (const t of ['pointerdown', 'click']) {
    document.addEventListener(t, (e) => {
      const o = window.__rv;
      if (t === 'pointerdown') { o.down++; if (e.isTrusted) o.downT++; }
      else { o.click++; if (e.isTrusted) o.clickT++; }
    }, true);
  }
  document.addEventListener('mousemove', () => { window.__rv.move++; }, true);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
for (let i = 0; i < 30; i++) {
  const bad = await page.evaluate(() => {
    const l = document.getElementById('first-run-launcher');
    if (l) { const r = l.getBoundingClientRect(); const c = getComputedStyle(l); if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > .05) return true; }
    for (const el of document.querySelectorAll('body *')) {
      const t = (el.textContent || '').trim();
      if (!/首次启动|选择你的第一视角/.test(t) || el.children.length > 2) continue;
      const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > .05) return true;
    }
    return false;
  });
  if (!bad) break;
  await page.keyboard.press('Escape'); await sleep(500);
}
await sleep(8000);

// ── 通用工具（页面内）──
const HELP = () => {
  window.__a = (c) => {
    const s = String(c || '');
    if (/^rgba?\(/.test(s)) { const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; }
    return 0;
  };
  window.__imgA = (bi) => {
    if (!bi || bi === 'none') return 0;
    const m = [...String(bi).matchAll(/rgba?\(([^)]+)\)/g)].map((x) => { const p = x[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; });
    return m.length ? Math.max(...m) : 0.5;
  };
  window.__vis = (el) => {
    if (!el) return false;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  window.__els = (el) => { const o = []; for (const e of el.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) o.push(e); } return o; };
  window.__chrome = (el) => {
    const c = getComputedStyle(el);
    const bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
    return {
      id: el.id || null, tag: el.tagName, cls: String(el.className || '').slice(0, 48),
      bg: c.backgroundColor, bgA: +window.__a(c.backgroundColor).toFixed(3),
      bgImg: String(c.backgroundImage).slice(0, 60), bf,
      opacity: +(+c.opacity).toFixed(2), visibility: c.visibility,
      rect: [Math.round(el.getBoundingClientRect().x), Math.round(el.getBoundingClientRect().y),
        Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)],
    };
  };
};
await page.evaluate(HELP);

const stateAll = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'),
      hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bgA: +window.__a(c.backgroundColor).toFixed(3), bf: c.backdropFilter || 'none',
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARDS);

const settle = async () => {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate((IDS) => IDS.map((id) => {
      const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect(); return [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
    }), CARDS);
    if (prev && JSON.stringify(prev) === JSON.stringify(now)) return now;
    prev = now; await sleep(350);
  }
  return prev;
};
await settle();

// ── A) 初始态：全 mini / ✕ 0 / 卡壳透明 / 全页可见 backdrop-filter ──
const init = await stateAll();
const initMeta = await page.evaluate(() => {
  const xGlyph = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.children.length) return false;
    const t = (el.textContent || '').trim();
    return /^[✕✖✗×xX]$/.test(t) && window.__vis(el);
  }).map((el) => ({ tag: el.tagName, cls: String(el.className || '').slice(0, 30), t: el.textContent.trim(), rect: [Math.round(el.getBoundingClientRect().x), Math.round(el.getBoundingClientRect().y)] }));
  const bfAll = [...document.querySelectorAll('body *')].filter((el) => {
    if (!window.__vis(el)) return false;
    const c = getComputedStyle(el);
    const bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
    return bf !== 'none' && bf !== '';
  }).map((el) => ({ id: el.id || null, cls: String(el.className || '').slice(0, 40), bf: getComputedStyle(el).backdropFilter }));
  return { closeEls: document.querySelectorAll('.gev-lc-close').length, xGlyph,
    bfCount: bfAll.length, bfList: bfAll.slice(0, 12) };
});
put('initial', { state: init, allMini: Object.entries(init).filter(([k, v]) => v && v.open && k !== 'gev-gfx-fab').map(([k]) => k),
  expanded: Object.entries(init).filter(([k, v]) => !v.hidden && (v.rect[2] > 0)).map(([k]) => k).length,
  ...initMeta });
await page.screenshot({ path: path.join(OUT, 'A-initial.png') });

// ── B) 全页 chrome 普查（排除卡内）：深色实底 / 磨砂 ──
const inventory = await page.evaluate(() => {
  const dark = [], frosted = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.gev-lc')) continue;
    if (!window.__vis(el)) continue;
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    const bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
    const bgA = window.__a(c.backgroundColor);
    const imgA = window.__imgA(c.backgroundImage);
    if ((bgA > 0.15 || imgA > 0.15) && area > 300) dark.push({ ...window.__chrome(el), area: Math.round(area) });
    if (bf !== 'none' && bf !== '') frosted.push(window.__chrome(el));
  }
  return { dark, frosted, darkCount: dark.length, frostedCount: frosted.length };
});
put('chrome_inventory_initial', inventory);

// ── C) 真实点击 #tilt-map-view → #toast 自然弹出 ──
const tiltPt = await page.evaluate(() => {
  const el = document.getElementById('tilt-map-view');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
await page.mouse.move(tiltPt.x, tiltPt.y); await sleep(120);
await page.mouse.down(); await sleep(50); await page.mouse.up();
await sleep(700);
const toast = await page.evaluate(() => {
  const el = document.getElementById('toast');
  const st = window.__chrome(el);
  const cs = getComputedStyle(el);
  return { ...st, text: (el.textContent || '').trim().slice(0, 40), cls: String(el.className),
    border: cs.borderColor, color: cs.color, boxShadow: cs.boxShadow.slice(0, 90),
    visibleNow: window.__vis(el) };
});
put('toast_after_real_click', toast);
await page.screenshot({ path: path.join(OUT, 'B-toast-natural-click.png') });
// 顺带把 #tilt-map-view 的 hover/pressed 态也记一笔（复验不发黑）
const tiltStates = await page.evaluate(() => {
  const el = document.getElementById('tilt-map-view');
  return { normal: window.__chrome(el), aria: el.getAttribute('aria-pressed') };
});
put('tilt_after_click', tiltStates);
await page.mouse.move(200, 400); await sleep(300);

// ── D) 3 个状态型 chip：强制显示后读 computed（当前环境无真实数据源）──
const chips = await page.evaluate(() => {
  const ids = ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip'];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = null; continue; }
    const prev = { hidden: el.hasAttribute('hidden'), style: el.getAttribute('style'), cls: String(el.className) };
    el.removeAttribute('hidden');
    el.classList.add('visible');
    el.style.opacity = '1';
    el.style.visibility = 'visible';
    el.style.transform = 'translateX(-50%) translateY(0)';
    out[id] = { ...window.__chrome(el), before: prev,
      state: el.getAttribute('data-state') || null, text: (el.textContent || '').trim().slice(0, 40) };
  }
  return out;
});
await sleep(400);
const chipsShot = await page.evaluate(() => {
  const ids = ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip'];
  return ids.map((id) => { const el = document.getElementById(id); return { id, ...window.__chrome(el) }; });
});
await page.screenshot({ path: path.join(OUT, 'C-state-chips.png') });
put('state_chips_forced', { atRead: chips, afterStyleApplied: chipsShot });
// 额外：global-loading-status 的 error / acquiring 变体（只改色不给底）
const chipVariants = await page.evaluate(() => {
  const el = document.getElementById('global-loading-status');
  const out = {};
  for (const st of ['idle', 'acquiring', 'error', 'retry', 'cancelled']) {
    el.setAttribute('data-state', st);
    out[st] = window.__chrome(el);
  }
  el.removeAttribute('data-state');
  return out;
});
put('loading_status_variants', chipVariants);
// 还原（避免污染后续矩阵脚本不受影响；本脚本后续不再用这些 chip）
await page.evaluate(() => {
  for (const id of ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.removeAttribute('style');
    el.classList.remove('visible');
    if (id === 'global-loading-status') el.setAttribute('hidden', '');
    el.setAttribute('hidden', '');
  }
});
await sleep(200);

// ── E) 7 个 header 真实点击 → 打开自己 + 卡片中心材质采样 ──
const HEADER_SEL = '.panel-header, .pp-header-row, .dock-header, header, .location-toolbar-label, .panel-title, .pp-header-label';
const SEVEN = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const clickCard = async (id) => {
  const before = (await stateAll())[id].open;
  const cands = await page.evaluate((id, SEL) => {
    const el = document.getElementById(id);
    const out = [];
    for (const h of el.querySelectorAll(SEL)) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
        const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
        const e = document.elementFromPoint(x, y);
        const hh = e && e.closest ? e.closest(SEL) : null;
        const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
        if (hh && el.contains(hh)) out.push({ x, y, owner, hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 24) : '' });
      }
    }
    return out;
  }, id, HEADER_SEL);
  for (const p of cands.slice(0, 10)) {
    await page.mouse.move(p.x, p.y); await sleep(50);
    await page.mouse.down(); await sleep(45); await page.mouse.up();
    await sleep(1000);
    const now = (await stateAll())[id].open;
    if (now !== before) return { id, ok: true, at: [p.x, p.y], owner: p.owner, hit: p.hit, before, after: now };
    await sleep(150);
  }
  return { id, ok: false, cands: cands.slice(0, 3), after: (await stateAll())[id].open };
};
const centerSample = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const r = el.getBoundingClientRect();
  const pts = [[0.5, 0.5], [0.35, 0.4], [0.65, 0.4], [0.35, 0.65], [0.65, 0.65]]
    .map(([fx, fy]) => [Math.round(r.x + r.width * fx), Math.round(r.y + r.height * fy)]);
  const samples = pts.map(([x, y]) => {
    const stack = document.elementsFromPoint(x, y);
    const cardIdx = stack.findIndex((e) => e.closest && e.closest('.gev-lc') === el);
    const inner = cardIdx >= 0 ? stack.slice(0, cardIdx + 1) : stack;
    let maxBg = 0, bf = 0;
    for (const e of inner) {
      const c = getComputedStyle(e);
      const b = getComputedStyle(e).backgroundColor;
      maxBg = Math.max(maxBg, window.__a(b), window.__imgA(c.backgroundImage));
      if ((c.backdropFilter && c.backdropFilter !== 'none')) bf++;
    }
    return { at: [x, y], maxBgAlpha: +maxBg.toFixed(3), backdropFilters: bf,
      topHit: stack[0] ? stack[0].tagName + '.' + String(stack[0].className || '').slice(0, 24) : '' };
  });
  // 卡内是否有 >20% alpha 且 >300px² 的实底
  const solids = [];
  for (const e of el.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    if (b.width * b.height < 300) continue;
    const c = getComputedStyle(e);
    const a = Math.max(window.__a(c.backgroundColor), window.__imgA(c.backgroundImage));
    if (a > 0.2) solids.push({ cls: String(e.className || '').slice(0, 34), tag: e.tagName, a: +a.toFixed(2), area: Math.round(b.width * b.height) });
  }
  const cardBfCount = [...el.querySelectorAll('*')].filter((e) => {
    const c = getComputedStyle(e);
    return (c.backdropFilter && c.backdropFilter !== 'none') || (c.webkitBackdropFilter && c.webkitBackdropFilter !== 'none');
  }).length;
  return { samples, maxBgAlpha: Math.max(...samples.map((s) => s.maxBgAlpha)), bfInCard: cardBfCount,
    solids: solids.slice(0, 8) };
}, id);

const headers = [];
for (const id of SEVEN) {
  const c = await clickCard(id);
  await settle();
  const st = (await stateAll())[id];
  const sample = await centerSample(id);
  headers.push({ ...c, state: st, sample });
  await page.screenshot({ path: path.join(OUT, 'D-open-' + id + '.png') });
  // 收起（保持一次只开一张，减少互相干扰）
  await clickCard(id);
  await settle();
}
put('seven_headers', headers);
const trust = await page.evaluate(() => window.__rv);
put('pointerTrust', trust);
await page.screenshot({ path: path.join(OUT, 'D-after-seven.png') });
fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(res, null, 2));
await browser.close();
console.log('DONE state.json');
