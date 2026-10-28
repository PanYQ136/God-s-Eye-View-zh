#!/usr/bin/env node
/**
 * _qa-final2.mjs — t_829dd186 透明液态玻璃总验收（1536×730，真实鼠标 CDP 事件）
 *
 * 证据链：
 *   1) pointerTrust：document 捕获阶段装 pointerdown/pointerup/click 记录器（isTrusted）
 *   2) 材质审计：卡壳 background alpha / backdrop-filter / 每个卡内可见元素 bg alpha /
 *      深色文字（luma<0.45）/ 全页 ✕ / tray 底色
 *   3) 中心透明实测：同一像素区「卡可见」vs「卡 visibility:hidden」两帧差分，
 *      中心差值像素占比（磨砂/暗底会接近 100%）
 *   4) 7 个 header 真实点击 → rect/visibility/命中元素；互斥时间线；pp 滚轮；快速连点；收起归位；FPS
 *
 * 用法: node scripts/_qa-final2.mjs [--tag=r1]
 * 产物: .gev-logs/final2/<tag>/{report.json, step-*.png}
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const TAG = arg('tag', 'r1');
const STAGE = arg('stage', 'a');   // a = 初始 + 7 个展开；b = 互斥/滚轮/连点/收起/FPS/刷新
const SECTIONS = STAGE === 'b' ? [3, 4, 5, 6, 7, 8] : [1, 2];
const W = 1536;
const H = 730;
const OUT = path.resolve('.gev-logs/final2', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:4173/?welcome=0';

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const EXPANDABLE = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel'];
const GROUPS = {
  left: ['data-panel', 'scene-panel'],
  right: ['pp-toggles', 'cctv-panel', 'global-context-panel'],
  dock: ['location-bar', 'control-panel'],
};

const report = {
  tag: TAG, viewport: [W, H], started: new Date().toISOString(),
  pointerTrust: { total: 0, trusted: 0, byId: {} }, steps: [], failures: [],
  material: {}, centerDiff: {}, pp: {}, timeline: {}, collapse: {}, fps: null,
  consoleErrors: [],
};

const fail = (m) => { report.failures.push(m); console.log('FAIL:', m); };
const ok = (m) => console.log('ok  :', m);

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860',
    '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 180)); });

// —— 可信指针记录器（导航前后都在）——
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
  window.__pt = { total: 0, trusted: 0, events: [] };
  const rec = (e) => {
    window.__pt.total++;
    if (e.isTrusted) window.__pt.trusted++;
    const t = e.target;
    const card = t && t.closest ? t.closest('#pp-toggles,#data-panel,#scene-panel,#cctv-panel,#global-context-panel,#location-bar,#control-panel,#gev-voice-control,#gev-gfx-fab') : null;
    window.__pt.events.push({
      type: e.type, trusted: !!e.isTrusted, at: Date.now(),
      card: card ? card.id : '',
      tag: t && t.tagName, cls: t && String(t.className || '').slice(0, 40),
      x: Math.round(e.clientX || 0), y: Math.round(e.clientY || 0),
    });
  };
  for (const t of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(t, rec, true);
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });

// 关掉首次启动 Launcher（?welcome=0 + localStorage 双保险），并等过渡 toast 消失，
// 保证所有截图都是干净的地图 + 卡片，不被 onboarding 覆盖。
const waitClean = async (max = 24000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const bad = await page.evaluate(() => {
      const out = [];
      const launcher = document.getElementById('first-run-launcher');
      if (launcher) {
        const r = launcher.getBoundingClientRect();
        const c = getComputedStyle(launcher);
        if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > 0.05 && c.display !== 'none') out.push('first-run-launcher');
      }
      for (const el of document.querySelectorAll('body *')) {
        const txt = (el.textContent || '').trim();
        if (!/定位来源|首次启动/.test(txt) || el.children.length > 2) continue;
        const r = el.getBoundingClientRect();
        const c = getComputedStyle(el);
        if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > 0.05 && c.display !== 'none') out.push('toast:' + txt.slice(0, 12));
      }
      return out;
    });
    if (!bad.length) return true;
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  return false;
};
const clean = await waitClean();
if (!clean) fail('onboarding/toast 未清干净，截图会被遮挡');
else ok('onboarding 已抑制、过渡 toast 已消失（截图干净）');

// 等 App 真正就绪：loading 幕消失 + 9 张卡矩形连续两次采样一致（避免拍到半初始化的 dock）
const waitReady = async (max = 45000) => {
  const snap = () => page.evaluate((ids) => {
    const loading = document.getElementById('loading-screen');
    const lc = loading ? getComputedStyle(loading) : null;
    const loadingShown = !!(loading && lc.display !== 'none' && lc.visibility !== 'hidden' && +lc.opacity > 0.05);
    const rects = ids.map((id) => {
      const el = document.getElementById(id);
      if (!el) return '';
      const r = el.getBoundingClientRect();
      return [id, +r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)].join(',');
    }).join('|');
    return { loadingShown, rects };
  }, IDS);
  let prev = null;
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const s = await snap();
    if (!s.loadingShown && prev && s.rects === prev) return true;
    prev = s.rects;
    await sleep(500);
  }
  return false;
};
const ready = await waitReady();
if (!ready) fail('App 未就绪（loading 幕未消失或卡片矩形不稳定）');
else ok('App 就绪：loading 幕已消失、9 卡矩形稳定');

// 等过渡 toast 收尾（#gev-toast.show 会在 5.2s 后自动消失）
const waitToastGone = async (max = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const shown = await page.evaluate(() => {
      const t = document.getElementById('gev-toast');
      return !!(t && t.classList.contains('show') && (t.textContent || '').trim());
    });
    if (!shown) return true;
    await sleep(400);
  }
  return false;
};
const toastGone = await waitToastGone();
if (!toastGone) fail('过渡 toast 未消失（截图会被遮挡）');

// 等地图瓦片清晰：中央无卡区域的高频边缘能量连续 3 次采样稳定，且达到本次序列峰值的 60% 以上
// （Cesium 在父级低分辨率瓦片阶段是「糊」的，必须等子瓦片到齐，否则截图全是模糊底图）
const mapEnergy = async () => {
  const buf = await page.screenshot({ clip: { x: 380, y: 240, width: 620, height: 260 }, encoding: 'base64' });
  return page.evaluate(async (d) => {
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const p = cx.getImageData(0, 0, cv.width, cv.height).data;
    const L = (i) => (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / 255;
    let s = 0, n = 0;
    for (let y = 0; y < cv.height - 1; y++) {
      for (let x = 0; x < cv.width - 1; x++) {
        const i = (y * cv.width + x) * 4;
        s += Math.abs(L(i) - L(i + 4)) + Math.abs(L(i) - L(i + cv.width * 4));
        n += 2;
      }
    }
    return n ? +(s / n).toFixed(4) : 0;
  }, buf);
};
const waitMapSharp = async (max = 40000) => {
  const series = [];
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    series.push(await mapEnergy());
    const n = series.length;
    if (n >= 4) {
      const peak = Math.max(...series);
      const last3 = series.slice(-3);
      const stable = Math.max(...last3) - Math.min(...last3) < Math.max(0.004, peak * 0.06);
      if (stable && series[n - 1] >= peak * 0.6 && peak > 0.02) return { ok: true, peak, last: series[n - 1], series };
    }
    await sleep(1200);
  }
  return { ok: false, series };
};
const sharp = await waitMapSharp();
report.mapSharp = sharp;
if (!sharp.ok) fail(`地图底图未清晰（边缘能量序列 ${JSON.stringify(sharp.series)}）`);
else ok(`地图底图已清晰（边缘能量 ${sharp.last}，峰值 ${sharp.peak}）`);

const settle = async (max = 90) => {
  for (let i = 0; i < max; i++) {
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    if (!n) return true;
    await sleep(35);
  }
  return false;
};

/* 只等 WAAPI 动画结束不够：App 自己的右栏重定位 / dock 迟滞会在动画结束后再挪 2–96px，
   基准矩形必须等「两次采样完全一致」才取，否则「收起回原位」会被误判。 */
const stableRects = async (ids, tries = 24, gap = 350) => {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = await page.evaluate(
      (ids) => ids.map((id) => {
        const el = document.getElementById(id);
        if (!el) return '';
        const r = el.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
      }).join('|'),
      ids,
    );
    if (cur === prev) return true;
    prev = cur;
    await sleep(gap);
  }
  return false;
};

const stateOf = (ids) => page.evaluate((ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = null; continue; }
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    out[id] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      collapsed: el.classList.contains('collapsed'),
      floating: el.classList.contains('gev-lc-floating'),
      hidden: c.visibility === 'hidden' || +c.opacity < 0.05,
      bg: c.backgroundColor,
      blur: c.backdropFilter,
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
    };
  }
  // 可见卡两两重叠（排除 edge 装饰与隐藏）
  const vis = ids.map((id) => document.getElementById(id)).filter((el) => {
    if (!el) return false;
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return c.visibility !== 'hidden' && +c.opacity > 0.05 && r.width > 4 && r.height > 4;
  });
  const ov = [];
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i].getBoundingClientRect(), b = vis[j].getBoundingClientRect();
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 2 && iy > 2) ov.push([vis[i].id, vis[j].id, +ix.toFixed(0), +iy.toFixed(0)]);
    }
  }
  const openBy = { left: [], right: [], dock: [] };
  const groups = { left: ['data-panel', 'scene-panel'], right: ['pp-toggles', 'cctv-panel', 'global-context-panel'], dock: ['location-bar', 'control-panel'] };
  for (const [g, list] of Object.entries(groups)) {
    for (const id of list) {
      const el = document.getElementById(id);
      if (el && el.classList.contains('gev-lc-floating') && !el.classList.contains('collapsed')) openBy[g].push(id);
    }
  }
  return { cards: out, overlaps: ov, openBy };
}, ids);

const headerSelOf = (id) => {
  const map = {
    'pp-toggles': '#pp-toggles .pp-header-row',
    'data-panel': '#data-panel .panel-header',
    'scene-panel': '#scene-panel .panel-header',
    'cctv-panel': '#cctv-panel .panel-header',
    'global-context-panel': '#global-context-panel .panel-header',
    'location-bar': '#location-bar .dock-tray-toggle',
    'control-panel': '#control-panel .dock-tray-toggle',
  };
  return map[id];
};

const headerPoint = (id) => page.evaluate((sel, id) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // 取 header 左侧文本区，避开按钮/图标
  const x = r.x + Math.min(26, r.width * 0.25);
  const y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return {
    x, y, rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
    hitCard: hit && hit.closest ? (hit.closest('.gev-lc') || {}).id || '' : '',
    hitTag: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 30) : '',
  };
}, headerSelOf(id), id);

const clickCard = async (id, { expect = 'open' } = {}) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle();
    const p = await headerPoint(id);
    if (!p) { fail(`header 不存在: ${id}`); return null; }
    if (p.hitCard && p.hitCard !== id) { fail(`命中别的卡 ${id} → ${p.hitCard} @${p.x.toFixed(0)},${p.y.toFixed(0)}`); await sleep(120); continue; }
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await sleep(30);
    await page.mouse.up();
    await settle();
    await sleep(220);
    const st = await stateOf([id]);
    const c = st.cards[id];
    if (expect === 'open' && c && (c.collapsed || c.hidden)) { fail(`点击后未展开/被隐藏: ${id} collapsed=${c.collapsed} hidden=${c.hidden}`); await sleep(150); continue; }
    if (expect === 'close' && c && !c.collapsed) { fail(`点击后未收起: ${id}`); await sleep(150); continue; }
    return { point: p, state: c };
  }
  return null;
};

// —— 材质审计 ——
const audit = (scopeIds) => page.evaluate((scopeIds) => {
  const alphaOf = (col) => {
    if (!col) return 0;
    if (col === 'transparent') return 0;
    const m = col.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return p.length > 3 ? p[3] : 1;
  };
  const luma = (col) => {
    const m = String(col).match(/[\d.]+/g);
    if (!m) return 1;
    const [r, g, b] = m.slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const res = { blur: [], dark: [], whiteFill: [], xGlyph: [], cards: {} };
  const scope = scopeIds.map((id) => document.getElementById(id)).filter(Boolean);
  for (const el of scope) {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    res.cards[el.id] = {
      bg: c.backgroundColor, bgA: +alphaOf(c.backgroundColor).toFixed(3),
      blur: c.backdropFilter, shadow: c.boxShadow.slice(0, 90),
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
    };
    if (c.backdropFilter && c.backdropFilter !== 'none') res.blur.push({ id: el.id, blur: c.backdropFilter });
    if (alphaOf(c.backgroundColor) > 0.02) res.blur.push({ id: el.id, bg: c.backgroundColor, why: 'card shell fill' });
    for (const d of el.querySelectorAll('*')) {
      const cs = getComputedStyle(d);
      const rr = d.getBoundingClientRect();
      if (rr.width < 4 || rr.height < 4) continue;
      if (cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      const bga = alphaOf(cs.backgroundColor);
      const grad = cs.backgroundImage && cs.backgroundImage !== 'none';
      const area = rr.width * rr.height;
      if ((bga > 0.20 && area > 300) || (grad && bga > 0.10 && area > 300)) {
        res.whiteFill.push({ id: el.id, el: d.tagName + '.' + String(d.className || '').slice(0, 36), bg: cs.backgroundColor, bgi: cs.backgroundImage.slice(0, 40), area: Math.round(area) });
      }
      if (!d.children.length) {
        const txt = (d.textContent || '').trim();
        if (txt && luma(cs.color) < 0.45 && +cs.opacity > 0.3) {
          res.dark.push({ id: el.id, txt: txt.slice(0, 12), color: cs.color });
        }
        if (/[✕×✖✗]/.test(txt)) res.xGlyph.push({ id: el.id, txt, el: d.tagName + '.' + String(d.className || '').slice(0, 30) });
      }
    }
  }
  // 全页（不只卡内）可见 ✕
  for (const d of document.querySelectorAll('body *')) {
    const txt = (d.textContent || '').trim();
    if (d.children.length || !/[✕×✖✗]/.test(txt)) continue;
    const rr = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    if (rr.width < 1 || rr.height < 1 || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    res.xGlyph.push({ id: 'GLOBAL', txt: txt.slice(0, 3), el: d.tagName + '.' + String(d.className || '').slice(0, 30) });
  }
  return res;
}, scopeIds);

// —— 中心透明实测：卡可见 vs 卡隐藏 两帧差分 ——
// —— 中心透明实测（棋盘底版，免疫地图动画）——
// 在卡「下方」垫一层 16px 黑白棋盘，然后量卡中心区域的边缘能量：
//   · 真透明玻璃 → 棋盘完整透出，边缘能量 ≈ 参考值（≥0.75）
//   · 磨砂/暗底/实底 → 棋盘被糊掉或盖掉，边缘能量骤降（<0.5 判失败）
const checkerProbe = async (id) => {
  const box = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const pad = 16;
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    let pat = document.getElementById('qa-checker');
    if (!pat) {
      pat = document.createElement('div');
      pat.id = 'qa-checker';
      document.body.appendChild(pat);
    }
    pat.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none',
      'z-index:' + (Number.isFinite(z) ? z - 1 : 100),
      'background-image:repeating-conic-gradient(#000 0% 25%, #fff 0% 50%)',
      'background-size:16px 16px', 'background-position:0 0',
    ].join(';');
    return { x: Math.round(r.x + pad), y: Math.round(r.y + pad), width: Math.round(r.width - pad * 2), height: Math.round(r.height - pad * 2) };
  }, id);
  if (box.width < 24 || box.height < 24) return null;
  await sleep(120);
  const ref = await page.screenshot({ clip: box, encoding: 'base64' });      // 卡可见 + 棋盘
  await page.evaluate((id) => { document.getElementById(id).style.visibility = 'hidden'; }, id);
  await sleep(140);
  const pure = await page.screenshot({ clip: box, encoding: 'base64' });     // 只有棋盘
  await page.evaluate((id) => { document.getElementById(id).style.visibility = ''; }, id);
  await page.evaluate(() => { const p = document.getElementById('qa-checker'); if (p) p.remove(); });
  await sleep(140);
  return page.evaluate(async (a, b) => {
    const load = (d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const mk = (img) => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      return cx.getImageData(0, 0, cv.width, cv.height);
    };
    const A = mk(ia), B = mk(ib);
    const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const energy = (img) => {
      let sum = 0, n = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width - 1; x++) {
          const i = (y * img.width + x) * 4;
          sum += Math.abs(lum(img.data, i) - lum(img.data, i + 4));
          n++;
        }
      }
      return n ? sum / n : 0;
    };
    const ea = energy(A), eb = energy(B);
    return { cardEdge: +ea.toFixed(3), pureEdge: +eb.toFixed(3), ratio: eb ? +(ea / eb).toFixed(2) : 0 };
  }, ref, pure);
};
const centerDiff = checkerProbe;

const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

/* 右栏沉降：App 的 rightPanelRail 首帧用 CSS 兜底 top:26vh(=189.8@730)，随后
   JS 首次布局把 --right-stack-safe-top 写成 93.8px 并带 top 过渡 → 约 2s 后才停。
   基准矩形必须在沉降完成后取，否则「收起回原位」会把 App 自己的 init settle 误判成回归。 */
const waitRailSettled = async (max = 60000) => {
  const t0 = Date.now();
  let prev = null, same = 0;
  while (Date.now() - t0 < max) {
    const s = await page.evaluate(() => {
      const rail = document.getElementById('right-context-rail');
      if (!rail) return null;
      const st = parseFloat(rail.dataset.safeTop || 'NaN');
      const r = rail.getBoundingClientRect();
      return { safeTop: st, y: +r.y.toFixed(1), h: +r.height.toFixed(1) };
    });
    if (s && Number.isFinite(s.safeTop) && Math.abs(s.y - s.safeTop) < 1) {
      const k = JSON.stringify([s.y, s.h]);
      if (k === prev) { same++; if (same >= 2) return s; } else { same = 0; }
      prev = k;
    } else { prev = null; same = 0; }
    await sleep(300);
  }
  return null;
};

// ═════════ 1) 初始全 mini ═════════
await settle();
await stableRects(IDS);
const railSettled = await waitRailSettled();
if (!railSettled) fail('右栏未沉降到 --right-stack-safe-top（基准矩形不可信）');
else ok(`右栏已沉降: top=${railSettled.y} safeTop=${railSettled.safeTop}`);
await stableRects(IDS);
const initial = await stateOf(IDS);
const audit0 = await audit(IDS);
report.initial = initial;
report.material.initial = { blur: audit0.blur, dark: audit0.dark, whiteFill: audit0.whiteFill, xGlyph: audit0.xGlyph, cards: audit0.cards };
await shot('step-01-initial.png');
for (const id of IDS) {
  const c = initial.cards[id];
  if (!c) { fail(`缺少卡片 ${id}`); continue; }
  if (c.collapsed === false && id !== 'gev-voice-control' && id !== 'gev-gfx-fab') fail(`初始态未收起: ${id}`);
  if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c.bg)) fail(`初始卡壳非透明: ${id} ${c.bg}`);
  if (c.blur !== 'none') fail(`初始卡壳有 blur: ${id} ${c.blur}`);
}
if (initial.overlaps.length) fail(`初始卡重叠: ${JSON.stringify(initial.overlaps)}`);
if (audit0.xGlyph.length) fail(`初始有 ✕: ${JSON.stringify(audit0.xGlyph)}`);
if (audit0.blur.length) fail(`初始有 backdrop-filter / 卡壳填充: ${JSON.stringify(audit0.blur.slice(0, 5))}`);
if (audit0.dark.length) fail(`初始有深色文字: ${JSON.stringify(audit0.dark.slice(0, 6))}`);
if (audit0.whiteFill.length) fail(`初始有实底小卡片: ${JSON.stringify(audit0.whiteFill.slice(0, 6))}`);
ok(`初始: 9 卡 bg=transparent / blur=none / 0 ✕ / 0 深色字 / 0 实底`);
report.steps.push({ label: 'initial', state: initial, audit: report.material.initial });

// ═════════ 2) 7 个 header 真实点击 ═════════
if (STAGE === 'a') {
for (const id of EXPANDABLE) {
  const before = await stateOf(IDS);
  const clicked = await clickCard(id);
  if (!clicked) continue;
  const st = await stateOf(IDS);
  const a = await audit([id]);
  const diff = await centerDiff(id);
  report.centerDiff[id] = diff;
  report.steps.push({ label: `click-${id}`, point: clicked.point, state: st, audit: { blur: a.blur, dark: a.dark, whiteFill: a.whiteFill, xGlyph: a.xGlyph } });
  await shot(`step-02-open-${id}.png`);
  for (const [g, list] of Object.entries(GROUPS)) {
    if (!list.includes(id)) continue;
    const others = st.openBy[g].filter((x) => x !== id);
    if (others.length) fail(`${id} 打开后同组仍有: ${others}`);
  }
  if (st.cards[id].blur !== 'none') fail(`${id} 展开态卡壳有 blur: ${st.cards[id].blur}`);
  if (st.cards[id].bg !== 'rgba(0, 0, 0, 0)') fail(`${id} 展开态卡壳非透明: ${st.cards[id].bg}`);
  if (a.blur.length) fail(`${id} 展开态有 blur/fill: ${JSON.stringify(a.blur.slice(0, 4))}`);
  if (a.dark.length) fail(`${id} 展开态深色文字: ${JSON.stringify(a.dark.slice(0, 6))}`);
  if (a.whiteFill.length) fail(`${id} 展开态实底小卡片: ${JSON.stringify(a.whiteFill.slice(0, 5))}`);
  if (a.xGlyph.length) fail(`${id} 展开态出现 ✕: ${JSON.stringify(a.xGlyph)}`);
  if (!st.cards[id].inView) fail(`${id} 展开后飞出屏幕: ${st.cards[id].rect}`);
  if (diff && diff.ratio < 0.5) fail(`${id} 中心不是透明玻璃: 棋盘边缘能量比 ${diff.ratio}（card ${diff.cardEdge} / pure ${diff.pureEdge}）`);
  else if (diff) ok(`${id}: 打开 OK / 棋盘透出比 ${diff.ratio}（≥0.5 即中心透明）`);
  // 收起
  await clickCard(id, { expect: 'close' });
  await settle();
}

// ═════════ 3) 互斥切换（先关旧再开新，时间线采样）═════════
}  // stage a
if (STAGE === 'b') {
const timelineSwitch = async (from, to) => {
  await settle();
  // 保证 from 打开
  const st0 = await stateOf([from]);
  if (!st0.cards[from] || st0.cards[from].collapsed) await clickCard(from);
  await settle();
  const p = await headerPoint(to);
  if (!p) { fail(`切换目标 header 缺失: ${to}`); return; }
  // 采样：每帧记录哪些卡处于 floating 且未 collapsed
  const sample = await page.evaluate(async (from, to, groups) => {
    const ids = [...new Set([...groups.left, ...groups.right, ...groups.dock])];
    const frames = [];
    const cur = () => {
      const o = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        o[id] = el && el.classList.contains('gev-lc-floating') && !el.classList.contains('collapsed') ? 1 : 0;
      }
      return o;
    };
    const t0 = performance.now();
    let stop = false;
    const loop = () => {
      frames.push({ t: Math.round(performance.now() - t0), cur: cur() });
      if (!stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__tl = { frames, stop: () => { stop = true; return frames; } };
  }, from, to, GROUPS);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(25);
  await page.mouse.up();
  await settle();
  await sleep(400);
  const tl = await page.evaluate(() => { const f = window.__tl.stop(); return f; });
  const maxSimul = { left: 0, right: 0, dock: 0 };
  let changes = 0;
  let prev = null;
  for (const f of tl) {
    for (const [g, list] of Object.entries(GROUPS)) {
      const n = list.reduce((a, id) => a + (f.cur[id] || 0), 0);
      if (n > maxSimul[g]) maxSimul[g] = n;
    }
    if (prev) for (const k of Object.keys(f.cur)) if (f.cur[k] !== prev[k]) changes++;
    prev = f.cur;
  }
  const end = await stateOf([from, to]);
  report.timeline[`${from}->${to}`] = { maxSimul, changes, frames: tl.length, endOpen: end.openBy };
  if (maxSimul.left > 1) fail(`${from}→${to} 左栏同时展开 ${maxSimul.left} 张`);
  if (maxSimul.right > 1) fail(`${from}→${to} 右栏同时展开 ${maxSimul.right} 张`);
  if (end.cards[to].collapsed) fail(`${from}→${to} 目标未展开`);
  if (end.cards[from].hidden) fail(`${from}→${to} 旧卡 header 不可见`);
  ok(`切换 ${from} → ${to}: maxSimul=${JSON.stringify(maxSimul)} changes=${changes}`);
};

await timelineSwitch('data-panel', 'scene-panel');
await timelineSwitch('scene-panel', 'data-panel');
await timelineSwitch('data-panel', 'scene-panel');
await timelineSwitch('pp-toggles', 'cctv-panel');
await timelineSwitch('cctv-panel', 'global-context-panel');
await timelineSwitch('global-context-panel', 'pp-toggles');
await shot('step-03-switch-final.png');

// ═════════ 4) pp 展开：滚轮 + 行距 + 透明小卡片 ═════════
await settle();
let ppState = await stateOf(['pp-toggles']);
if (ppState.cards['pp-toggles'].collapsed) await clickCard('pp-toggles');
await settle();
const ppBox = await page.evaluate(() => { const r = document.getElementById('pp-toggles').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: [r.x, r.y, r.width, r.height] }; });
const ppBefore = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const all = [...el.querySelectorAll('.pp-toggle-group, .pp-slider-row.visible')]
    .filter((r) => getComputedStyle(r).display !== 'none');
  // 只保留最外层行（父级不在集合里），避免父子互算得到负间距
  const set = new Set(all);
  const rows = all.filter((r) => {
    let p = r.parentElement;
    while (p && p !== el) { if (set.has(p)) return false; p = p.parentElement; }
    return true;
  }).map((r) => { const b = r.getBoundingClientRect(); return { cls: String(r.className).slice(0, 40), y: +b.y.toFixed(1), h: +b.height.toFixed(1) }; })
    .sort((a, b) => a.y - b.y);
  let minGap = 1e9;
  for (let i = 1; i < rows.length; i++) minGap = Math.min(minGap, rows[i].y - (rows[i - 1].y + rows[i - 1].h));
  const btns = [...el.querySelectorAll('.pp-toggle-btn, .pp-mode-btn')].filter((b) => b.getBoundingClientRect().width > 4).map((b) => {
    const cs = getComputedStyle(b);
    const m = cs.color.match(/[\d.]+/g) || [255, 255, 255];
    return { id: b.id, bg: cs.backgroundColor, color: cs.color, luma: +(((0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255).toFixed(2)), w: +b.getBoundingClientRect().width.toFixed(0) };
  });
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, minGap: +minGap.toFixed(1), rows: rows.length, rowList: rows, btns };
});
await page.mouse.move(ppBox.x, ppBox.y);
await page.mouse.wheel({ deltaY: 240 });
await sleep(400);
await page.mouse.wheel({ deltaY: 240 });
await sleep(400);
const ppAfter = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; });
report.pp = { rect: ppBox.rect, before: ppBefore, after: ppAfter };
await shot('step-04-pp-scrolled.png');
const ppDark = ppBefore.btns.filter((b) => b.luma < 0.45);
const ppSolid = ppBefore.btns.filter((b) => {
  const m = b.bg.match(/rgba?\(([^)]+)\)/);
  const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0;
  return a > 0.2;
});
report.pp.darkBtns = ppDark;
report.pp.solidBtns = ppSolid;
if (ppBefore.scrollHeight <= ppBefore.clientHeight) fail('pp 内容未超出，滚轮测试无意义（内容应可滚）');
if (ppAfter.scrollTop <= 0) fail(`pp 滚轮无效: scrollTop ${ppBefore.scrollTop} → ${ppAfter.scrollTop}`);
else ok(`pp 滚轮: scrollTop ${ppBefore.scrollTop} → ${ppAfter.scrollTop}（scrollHeight ${ppBefore.scrollHeight} / clientH ${ppBefore.clientHeight}）`);
if (ppBefore.minGap < 4) fail(`pp 行距过小: minGap=${ppBefore.minGap}px`);
else ok(`pp 行距 minGap=${ppBefore.minGap}px, ${ppBefore.rows} 行`);
if (ppDark.length) fail(`pp 黑字: ${JSON.stringify(ppDark)}`);
if (ppSolid.length) fail(`pp 实底按钮: ${JSON.stringify(ppSolid)}`);
await page.mouse.wheel({ deltaY: -600 });
await sleep(300);

// ═════════ 5) 快速连点全部（110ms 压力节奏）═════════
const rapid = [];
for (const id of [...EXPANDABLE, ...EXPANDABLE].slice(0, 14)) {
  const p = await headerPoint(id);
  if (!p) continue;
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(20);
  await page.mouse.up();
  await sleep(90);
  const st = await stateOf([id]);
  rapid.push({ id, hitCard: p.hitCard, collapsed: st.cards[id] && st.cards[id].collapsed, hidden: st.cards[id] && st.cards[id].hidden });
}
await settle();
await sleep(400);
const rapidEnd = await stateOf(IDS);
await shot('step-05-rapid.png');
report.rapid = { taps: rapid, end: rapidEnd };
if (rapidEnd.overlaps.length) fail(`快速连点后重叠: ${JSON.stringify(rapidEnd.overlaps)}`);
const outOfView = IDS.filter((id) => rapidEnd.cards[id] && !rapidEnd.cards[id].inView);
if (outOfView.length) fail(`快速连点后飞出屏幕: ${outOfView}`);
if (rapidEnd.openBy.left.length > 1) fail(`快速连点后左栏 ${rapidEnd.openBy.left.length} 张展开`);
if (rapidEnd.openBy.right.length > 1) fail(`快速连点后右栏 ${rapidEnd.openBy.right.length} 张展开`);
ok(`快速连点终态: left=${rapidEnd.openBy.left} right=${rapidEnd.openBy.right} dock=${rapidEnd.openBy.dock} 重叠=${rapidEnd.overlaps.length}`);

// ═════════ 6) 收起全部 → 回 mini 原位 ═════════
for (const id of EXPANDABLE) {
  const st = await stateOf([id]);
  if (st.cards[id] && !st.cards[id].collapsed) await clickCard(id, { expect: 'close' });
}
await settle();
await sleep(400);
await stableRects(IDS);
const finalState = await stateOf(IDS);
await shot('step-06-collapsed.png');
const diffRects = [];
for (const id of IDS) {
  const a = initial.cards[id], b = finalState.cards[id];
  if (!a || !b) continue;
  const d = Math.max(...a.rect.map((v, i) => Math.abs(v - b.rect[i])));
  if (d > 1.5) diffRects.push({ id, initial: a.rect, now: b.rect });
}
report.collapse = { diff: diffRects, state: finalState };
if (diffRects.length) fail(`收起后未回原位: ${JSON.stringify(diffRects)}`);
else ok('收起全部：9 卡 rect 与初始完全一致（≤1.5px）');
if (finalState.openBy.left.length || finalState.openBy.right.length || finalState.openBy.dock.length) fail(`收起后仍有展开: ${JSON.stringify(finalState.openBy)}`);

// ═════════ 7) FPS（1536×730）═════════
const fps = await page.evaluate(async () => {
  let frames = 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => { frames++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return { frames, ms: Math.round(performance.now() - t0), fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1) };
});
report.fps = fps;
if (fps.fps < 30) fail(`FPS 低于 30: ${fps.fps}`); else ok(`FPS ${fps.fps} @1536×730`);

// ═════════ 8) 刷新后仍全 mini ═════════
report.__ptMid = await page.evaluate(() => window.__pt || { total: 0, trusted: 0, events: [] });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
const clean2 = await waitClean(20000);
const ready2 = await waitReady(45000);
await waitToastGone(15000);
const sharp2 = await waitMapSharp(40000);
if (!clean2) fail('刷新后 onboarding 又出现（截图被遮挡）');
if (!ready2) fail('刷新后 App 未就绪（loading 幕未消失或卡片矩形不稳定）');
if (!sharp2.ok) fail(`刷新后地图未清晰（能量 ${JSON.stringify(sharp2.series)}）`);
const reloadState = await stateOf(IDS);
report.reload = reloadState;
await shot('step-07-reloaded.png');
for (const id of EXPANDABLE) {
  if (reloadState.cards[id] && !reloadState.cards[id].collapsed) fail(`刷新后自动展开: ${id}`);
}
const outRv = IDS.filter((id) => reloadState.cards[id] && !reloadState.cards[id].inView);
if (outRv.length) fail(`刷新后飞出屏幕: ${outRv}`);

// ═════════ pointerTrust ═════════
}  // stage b
const ptMid = report.__ptMid || { total: 0, trusted: 0, events: [] };
const ptEnd = await page.evaluate(() => window.__pt || { total: 0, trusted: 0, events: [] });
const pt = {
  total: (ptMid.total || 0) + (ptEnd.total || 0),
  trusted: (ptMid.trusted || 0) + (ptEnd.trusted || 0),
  events: [...(ptMid.events || []), ...(ptEnd.events || [])],
};
report.pointerTrust = { total: pt.total, trusted: pt.trusted, sample: (pt.events || []).slice(0, 8), byCard: {} };
for (const e of pt.events || []) {
  if (!e.card) continue;
  report.pointerTrust.byCard[e.card] = report.pointerTrust.byCard[e.card] || { total: 0, trusted: 0, click: 0, clickTrusted: 0 };
  const b = report.pointerTrust.byCard[e.card];
  b.total++; if (e.trusted) b.trusted++;
  if (e.type === 'click') { b.click++; if (e.trusted) b.clickTrusted++; }
}
if (!pt.total) fail('pointerTrust 记录器没收到事件');
if (pt.total && pt.trusted !== pt.total) fail(`存在非可信指针事件 ${pt.total - pt.trusted}/${pt.total}`);
if (pt.trusted < 20) fail(`可信指针事件过少: ${pt.trusted}`);
else ok(`可信指针事件 ${pt.trusted}/${pt.total}（isTrusted）`);

report.finished = new Date().toISOString();
delete report.__ptMid;
fs.writeFileSync(path.join(OUT, `report-${STAGE}.json`), JSON.stringify(report, null, 1));
console.log('=== FAILURES', report.failures.length, '===');
report.failures.forEach((f) => console.log(' -', f));
console.log('OUT', OUT);
await browser.close();
process.exit(report.failures.length ? 1 : 0);
