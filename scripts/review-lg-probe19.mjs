#!/usr/bin/env node
/**
 * review-lg-probe19.mjs —— 第四轮复核 · Contract lens（reviewer 专用、只读）
 *  A) 默认落地视角（真实卫星图，不切相机）：语音卡 5 个标签 + 顶栏 5 个图标 + 九卡标题 的环带对比度
 *  B) prefers-reduced-transparency: reduce：逐一遍历 9 张卡壳 + 语音卡 + 顶栏 + dock 皮肤，验证实色回退
 *  C) 合同审计：9/9 卡、玻璃面数、卡内 backdrop、可见滚动条、纯黑字、canvas scale/dpr、console error、兄弟卡 morph
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r4';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'review-lg-probe19', url, errors: [] };

const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2500));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];

/* 环带法：底色 = 文字矩形外扩 pad 的中位数；前景 = 矩形内 p99（笔画峰值） */
const ringContrast = async (rect, pad, tag) => {
  const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2 };
  if (clip.x + clip.width > 1536) clip.width = 1536 - clip.x;
  if (clip.y + clip.height > 730) clip.height = 730 - clip.y;
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / clip.width, sy = info.height / clip.height;
  const inner = { x0: pad * sx, y0: pad * sy, x1: (pad + rect.w) * sx, y1: (pad + rect.h) * sy };
  const ring = [], core = [];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const L = lumOf(data[i], data[i + 1], data[i + 2]);
    if (x >= inner.x0 && x < inner.x1 && y >= inner.y0 && y < inner.y1) core.push(L); else ring.push(L);
  }
  const Sr = sorted(ring), Sc = sorted(core);
  const bg = q(Sr, 0.5), fg = q(Sc, 0.995), mid = q(Sc, 0.5);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), coreP50: +mid.toFixed(3), contrast: ratio(fg, bg), painted: fg - mid > 0.02 };
};

/* ---------- A) 默认视角对比度 ---------- */
const t = await page.evaluate((CARD_IDS) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return el.offsetParent !== null && r.width > 3 && r.height > 3 && eff(el) > 0.15; };
  const o = { cards: [], voiceTexts: [], topBtns: [], titles: [] };
  for (const id of CARD_IDS) {
    const root = document.getElementById(id);
    if (!root) { o.cards.push({ id, missing: true }); continue; }
    const shell = root.closest('.gev-lc') || root;
    const cs = getComputedStyle(shell);
    o.cards.push({ id, rect: rect(shell), lum: shell.getAttribute('data-gev-lum'), bg: cs.backgroundColor, isGevLc: !!root.closest('.gev-lc'), shadow: cs.boxShadow.slice(0, 120) });
    const head = shell.querySelector('header, .panel-header, .gev-lc-head');
    if (head) {
      const ht = [...head.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && vis(e));
      if (ht.length) o.titles.push({ card: id, text: ht[0].textContent.trim().slice(0, 14), color: getComputedStyle(ht[0]).color, rect: rect(ht[0]) });
    }
  }
  const voice = document.getElementById('gev-voice-control');
  if (voice) o.voiceTexts = [...voice.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && vis(e)).map((e) => ({ text: (e.textContent || '').trim().slice(0, 18), color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize, rect: rect(e) }));
  for (const b of [...document.querySelectorAll('#top-center-actions button')].filter(vis)) {
    const icon = [...b.querySelectorAll('span')].find(vis) || b;
    o.topBtns.push({ id: b.id, color: getComputedStyle(icon).color, rect: rect(icon) });
  }
  o.htmlLum = document.documentElement.dataset.gevGlassLum;
  o.canvas = (() => {
    const cv = document.querySelector('#gev-gl-glass') || document.querySelector('canvas[data-gev-gl]');
    const st = window.__gevGlStats ? window.__gevGlStats() : null;
    return { glassCanvas: cv ? [cv.width, cv.height] : null, statsScale: st ? st.scale : null, dpr: devicePixelRatio };
  })();
  return o;
}, CARD_IDS);
out.targets = t;

const rows = [];
for (const c of t.voiceTexts) rows.push({ group: 'voice', text: c.text, declColor: c.color, fs: c.fs, ...(await ringContrast(c.rect, 5, `p19-voice-${(c.text || '').replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 6)}`)) });
for (const b of t.topBtns) rows.push({ group: 'topIcon', id: b.id, declColor: b.color, ...(await ringContrast(b.rect, 5, `p19-top-${b.id}`)) });
for (const ti of t.titles) rows.push({ group: 'cardTitle', card: ti.card, text: ti.text, declColor: ti.color, ...(await ringContrast(ti.rect, 6, `p19-title-${ti.card}`)) });
out.contrastDefault = rows;

const txt = rows.filter((r) => r.group !== 'topIcon');
const ico = rows.filter((r) => r.group === 'topIcon');
out.contrastSummary = {
  textMin: Math.min(...txt.map((r) => r.contrast)),
  textUnder45: txt.filter((r) => r.contrast < 4.5).map((r) => `${r.group}:${r.text || r.id}=${r.contrast}`),
  iconMin: ico.length ? Math.min(...ico.map((r) => r.contrast)) : null,
  iconUnder3: ico.filter((r) => r.contrast < 3).map((r) => `${r.id}=${r.contrast}`),
  notPainted: rows.filter((r) => !r.painted).map((r) => r.text || r.id),
};
await page.screenshot({ path: path.join(OUT, 'p19-default-full.png') });

/* ---------- C) 合同审计（回退前先做，避免媒体查询污染） ---------- */
out.audit = await page.evaluate((CARD_IDS) => {
  const cards = CARD_IDS.map((id) => {
    const root = document.getElementById(id); if (!root) return { id, missing: true };
    const shell = root.closest('.gev-lc') || root;
    const cs = getComputedStyle(shell);
    const inner = shell.querySelector('.panel-inner');
    const innerBg = inner ? getComputedStyle(inner).backgroundColor : null;
    const innerBd = inner ? getComputedStyle(inner).backdropFilter : null;
    const scrollers = [...shell.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e); const scrollable = e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2;
      return scrollable && (s.overflowY !== 'visible' || s.overflowX !== 'visible') && (s.scrollbarWidth !== 'none') && !e.matches('input,textarea');
    }).map((e) => e.className && String(e.className).slice(0, 40));
    const black = [...shell.querySelectorAll('*')].filter((e) => {
      const c = getComputedStyle(e).color; const m = c.match(/rgba?\((\d+), (\d+), (\d+)/);
      return m && (+m[1] < 40 && +m[2] < 40 && +m[3] < 40);
    }).length;
    return { id, isGevLc: !!root.closest('.gev-lc'), bg: cs.backgroundColor, backdrop: cs.backdropFilter, shadow: cs.boxShadow, innerBg, innerBd, scrollers, black, lum: shell.getAttribute('data-gev-lum') };
  });
  const st = window.__gevGlStats ? window.__gevGlStats() : null;
  const cv = document.querySelector('#gev-gl-glass');
  const btn = document.querySelector('#data-panel header .panel-collapse, #data-panel .gev-lc-head');
  return { cards, surfaces: st ? st.surfaces.length : null, surfaceIds: st ? st.surfaces.map((s) => s.id) : null, scale: st ? st.scale : null, canvas: cv ? [cv.width, cv.height] : null, dpr: devicePixelRatio, hasCv: !!cv, hasGlobals: { viewer: !!window.__gevViewer, stats: !!window.__gevGlStats } };
}, CARD_IDS);

/* 兄弟卡 morph：展开数据卡后看 scene-panel 是否仍 display:block 且有高度 */
out.morph = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dp = document.getElementById('data-panel');
  const head = dp.querySelector('header, .gev-lc-head');
  if (head) head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(700);
  const sp = document.getElementById('scene-panel');
  const cs = sp ? getComputedStyle(sp) : null;
  const b = sp ? sp.getBoundingClientRect() : null;
  const shell = sp && sp.closest('.gev-lc');
  return { sceneDisplay: cs && cs.display, sceneVis: cs && cs.visibility, sceneH: b ? Math.round(b.height) : null, collapsed: shell ? shell.classList.contains('collapsed') : null, dpH: Math.round(dp.getBoundingClientRect().height) };
});

/* ---------- B) prefers-reduced-transparency: reduce ---------- */
const cdp2 = await page.createCDPSession();
await cdp2.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
await new Promise((r) => setTimeout(r, 1200));
out.reduced = await page.evaluate((CARD_IDS) => {
  const parseA = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((s) => parseFloat(s)); return p.length === 4 ? p[3] : 1; };
  const rows = [];
  for (const id of [...CARD_IDS, 'top-center-actions']) {
    const root = document.getElementById(id); if (!root) { rows.push({ id, missing: true }); continue; }
    const shell = id === 'top-center-actions' ? root : (root.closest('.gev-lc') || root);
    const cs = getComputedStyle(shell);
    const sh = cs.boxShadow;
    rows.push({
      id, bg: cs.backgroundColor, alpha: parseA(cs.backgroundColor), backdrop: cs.backdropFilter === 'none' ? 'none' : cs.backdropFilter,
      image: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 40),
      hasInsetRing: /inset/.test(sh), shadow: sh.slice(0, 90),
      solid: parseA(cs.backgroundColor) === 1 && cs.backdropFilter === 'none',
    });
  }
  const skins = [...document.querySelectorAll('#command-dock .lg-glass-skin, #gev-voice-control .lg-glass-skin')].map((e) => {
    const cs = getComputedStyle(e);
    return { cls: String(e.className).slice(0, 40), bg: cs.backgroundColor, alpha: parseA(cs.backgroundColor), backdrop: cs.backdropFilter === 'none' ? 'none' : cs.backdropFilter };
  });
  const cv = document.querySelector('#gev-gl-glass');
  return { cards: rows, skins, glassCanvasDisplay: cv ? getComputedStyle(cv).display : 'no-canvas', glassCanvasHidden: cv ? (getComputedStyle(cv).display === 'none' || getComputedStyle(cv).opacity === '0') : true, matches: matchMedia('(prefers-reduced-transparency: reduce)').matches };
}, CARD_IDS);
await page.screenshot({ path: path.join(OUT, 'p19-reduced.png') });
out.errorsAll = out.errors;

fs.writeFileSync(path.join(OUT, 'p19.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ contrastSummary: out.contrastSummary, reduced: out.reduced, audit: { surfaces: out.audit.surfaces, scale: out.audit.scale, canvas: out.audit.canvas, cards: out.audit.cards.map((c) => ({ id: c.id, isGevLc: c.isGevLc, bg: c.bg, innerBd: c.innerBd, scrollers: (c.scrollers||[]).length, black: c.black, missing: c.missing || false })) }, morph: out.morph, errors: out.errors }, null, 1));
await browser.close();
