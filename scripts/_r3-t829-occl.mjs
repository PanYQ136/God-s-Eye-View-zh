#!/usr/bin/env node
/**
 * _r3-t829-occl.mjs — t_829dd186 round-3 · reviewer 阻塞项 2 验证
 * 修的是 planGroupPush(dock) 的溢出摆位：把「其它可见迷你卡」纳入避让。
 * 场景（顺序敏感，reviewer 的确定性复现）：
 *   A) 先开 control(dock) → 再开 cctv(右栏)：voice 过去 [1320,486,140,86] 压住 global [1308,478,176,50]
 *   B) 反向：先开 cctv → 再开 control
 *   C) control 单独展开
 * 每个场景：真实鼠标点 header → 读 rects → 命中测试（右栏 3 个 header + dock 3 个 header）
 *          → 真实点击右栏 3 个 header 验证「能打开自己」。
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
const res = { started: new Date().toISOString(), cases: {} };
const put = (k, v) => { res.cases[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2200)); };

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
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0 };
  for (const t of ['pointerdown', 'click']) {
    document.addEventListener(t, (e) => {
      const o = window.__rv;
      if (t === 'pointerdown') { o.down++; if (e.isTrusted) o.downT++; }
      else { o.click++; if (e.isTrusted) o.clickT++; }
    }, true);
  }
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
await sleep(6500);

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
res.initialMini = await settle();

const stateAll = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'),
      hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    };
  }
  return o;
}, CARDS);

const HEADER_SEL = '.panel-header, .pp-header-row, .dock-header, header, .location-toolbar-label, .panel-title, .pp-header-label';
const clickHeader = async (id, wantOpen = null) => {
  const before = (await stateAll())[id].open;
  const getCands = () => page.evaluate((id, SEL) => {
    const el = document.getElementById(id);
    const out = [];
    for (const h of el.querySelectorAll(SEL)) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
        const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
        const e = document.elementFromPoint(x, y);
        const hh = e && e.closest ? e.closest(SEL) : null;
        const owner = e && e.closest ? (e.closest('.gev-lc') || {}).id : null;
        out.push({ x, y, cls: String(h.className).slice(0, 26), hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 24) : '', owner: owner || null, onHeader: !!(hh && el.contains(hh)) });
      }
    }
    return out.filter((p) => p.onHeader);
  }, id, HEADER_SEL);
  let cands = await getCands();
  for (let k = 0; k < 3 && !cands.length; k++) { await sleep(450); cands = await getCands(); }
  const tries = [];
  for (const p of cands.slice(0, 12)) {
    await page.mouse.move(p.x, p.y); await sleep(50);
    await page.mouse.down(); await sleep(40); await page.mouse.up();
    await sleep(950);
    const now = (await stateAll())[id].open;
    tries.push({ at: [p.x, p.y], hit: p.hit, owner: p.owner, openAfter: now });
    if (now !== before) return { id, before, after: now, tries, ok: true };
    await sleep(150);
  }
  return { id, before, after: (await stateAll())[id].open, tries, ok: false };
};

// 命中测试：某张卡的 header 区域是否真的属于它自己
const hitProbe = (id) => page.evaluate((id, SEL) => {
  const el = document.getElementById(id);
  const out = [];
  for (const h of el.querySelectorAll(SEL)) {
    const r = h.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]]) {
      const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
      const e = document.elementFromPoint(x, y);
      const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
      out.push({ at: [x, y], hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 30) : '', owner, own: owner === id });
    }
  }
  return out;
}, id, HEADER_SEL);

const DOCK = ['location-bar', 'control-panel', 'gev-voice-control'];
const RIGHT = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
const overlap = (a, b) => {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return { ix: +ix.toFixed(0), iy: +iy.toFixed(0), area: +(ix * iy).toFixed(0) };
};
const pairOverlaps = (st, ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = st[ids[i]], b = st[ids[j]];
    if (!a || !b) continue;
    const ov = overlap(a.rect, b.rect);
    if (ov.ix > 1 && ov.iy > 1) out.push({ a: ids[i], b: ids[j], ...ov });
  }
  return out;
};

// ── 场景 A：control 展开 → cctv 展开 ──
const caseA = {};
caseA.openControl = await clickHeader('control-panel');
await settle();
caseA.afterControl = await stateAll();
caseA.voiceAfterControl = caseA.afterControl['gev-voice-control'].rect;
caseA.overlapsAfterControl = pairOverlaps(caseA.afterControl, CARDS);
caseA.openCctv = await clickHeader('cctv-panel');
await settle();
caseA.afterCctv = await stateAll();
caseA.overlaps = pairOverlaps(caseA.afterCctv, CARDS);
caseA.hits = {};
for (const id of [...RIGHT, ...DOCK]) caseA.hits[id] = await hitProbe(id);
caseA.ownAllRight = RIGHT.every((id) => (caseA.hits[id] || []).some((h) => h.own));
caseA.ownAllDock = DOCK.every((id) => (caseA.hits[id] || []).some((h) => h.own));
caseA.voiceRect = caseA.afterCctv['gev-voice-control'].rect;
caseA.globalRect = caseA.afterCctv['global-context-panel'].rect;
caseA.voiceVsGlobal = overlap(caseA.voiceRect, caseA.globalRect);
await page.screenshot({ path: path.join(OUT, 'occl-A-control-then-cctv.png') });
// 真实点右栏 3 个 header，看能不能打开自己
caseA.rightClicks = [];
for (const id of ['global-context-panel', 'pp-toggles', 'cctv-panel']) {
  const c = await clickHeader(id);
  await sleep(700);
  const st = await stateAll();
  caseA.rightClicks.push({ id, ok: c.ok, open: st[id].open, tries: c.tries.slice(-2) });
  await settle();
}
put('caseA_control_then_cctv', caseA);

// ── 复位：收起全部 ──
for (const id of ['control-panel', 'cctv-panel', 'pp-toggles', 'global-context-panel', 'location-bar']) {
  const st = await stateAll();
  if (!st[id].open) continue;
  const el = await page.evaluate((id) => { const e = document.getElementById(id); return !!e; }, id);
  if (el) await clickHeader(id);
}
await settle();
res.afterReset = await stateAll();

// ── 场景 B：cctv 展开 → control 展开 ──
const caseB = {};
caseB.openCctv = await clickHeader('cctv-panel');
await settle();
caseB.openControl = await clickHeader('control-panel');
await settle();
caseB.state = await stateAll();
caseB.overlaps = pairOverlaps(caseB.state, CARDS);
caseB.hits = {};
for (const id of [...RIGHT, ...DOCK]) caseB.hits[id] = await hitProbe(id);
caseB.ownAllRight = RIGHT.every((id) => (caseB.hits[id] || []).some((h) => h.own));
caseB.ownAllDock = DOCK.every((id) => (caseB.hits[id] || []).some((h) => h.own));
await page.screenshot({ path: path.join(OUT, 'occl-B-cctv-then-control.png') });
put('caseB_cctv_then_control', caseB);

// ── 场景 C：只开 control ──
for (const id of ['cctv-panel', 'control-panel']) {
  const st = await stateAll();
  if (st[id].open) await clickHeader(id);
}
await settle();
const caseC = {};
caseC.openControl = await clickHeader('control-panel');
await settle();
caseC.state = await stateAll();
caseC.overlaps = pairOverlaps(caseC.state, CARDS);
caseC.hits = {};
for (const id of [...RIGHT, ...DOCK]) caseC.hits[id] = await hitProbe(id);
caseC.ownAllRight = RIGHT.every((id) => (caseC.hits[id] || []).some((h) => h.own));
await page.screenshot({ path: path.join(OUT, 'occl-C-control-only.png') });
put('caseC_control_only', caseC);

// ── 场景 D：dock 三张轮流展开（location/control/voice 组内切换） ──
const caseD = [];
for (const id of ['location-bar', 'control-panel', 'gev-voice-control']) {
  const st = await stateAll();
  for (const o of DOCK) if (o !== id && st[o].open) await clickHeader(o);
  const c = await clickHeader(id);
  await settle();
  const s2 = await stateAll();
  const hits = {};
  for (const o of [...RIGHT, ...DOCK]) hits[o] = (await hitProbe(o)).some((h) => h.own);
  caseD.push({ id, ok: c.ok, open: s2[id].open, overlaps: pairOverlaps(s2, CARDS), hitOwn: hits });
}
put('caseD_dock_rotation', caseD);
await page.screenshot({ path: path.join(OUT, 'occl-D-dock-rotation.png') });

res.pointerTrust = await page.evaluate(() => window.__rv);
put('pointerTrust', res.pointerTrust);
fs.writeFileSync(path.join(OUT, 'occl.json'), JSON.stringify(res, null, 2));
await browser.close();
console.log('DONE', OUT);
