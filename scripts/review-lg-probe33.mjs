#!/usr/bin/env node
/**
 * review-lg-probe33.mjs —— 第六轮复核 · Contract lens（reviewer 专用、只读）
 * 目的：alpha 修正（内部 0.90/0.75）后，最坏亮底上「regular 文字 ≥4.5:1 / 图标 ≥3:1 / clear 35% dim」
 * 是否仍然成立。用真实亮地形（青海盐湖 / 塔克拉玛干沙漠）而非合成白底。
 *  - 环带法：bg = 文字矩形外扩 5-6px 环带中位数（无笔画），fg = 矩形内 p99.5
 *  - 三场景：暗底福州 / 亮底盐湖 / 亮底沙漠
 *  - clear dim：玻璃画布 display:none 前后同点亮度比（fab 与 locate 芯片）
 *  - 附：合成纯白最坏底（__gevGlTestBg(true,-1)，dsLum 自证）作为二次证据
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r6rev';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 150)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(14000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await sleep(2500);

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];

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

const meanLum = async (rect) => {
  const buf = await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) { s += lumOf(data[i], data[i + 1], data[i + 2]); n++; }
  return +(s / n).toFixed(4);
};

const collectTargets = () => page.evaluate((CARD_IDS) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return el.offsetParent !== null && r.width > 3 && r.height > 3 && eff(el) > 0.15; };
  const titles = [], cards = [], clearAreas = [];
  for (const id of CARD_IDS) {
    const root = document.getElementById(id); if (!root) continue;
    const shell = root.closest('.gev-lc') || root;
    const cs = getComputedStyle(shell);
    cards.push({ id, lum: shell.getAttribute('data-gev-lum'), bg: cs.backgroundColor, rect: rect(shell) });
    const head = shell.querySelector('header, .panel-header, .gev-lc-head');
    if (head) {
      const ht = [...head.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && vis(e));
      if (ht.length) titles.push({ card: id, text: ht[0].textContent.trim().slice(0, 14), color: getComputedStyle(ht[0]).color, rect: rect(ht[0]) });
    }
    const st = window.__gevGlStats();
    const s = st && st.surfaces.find((x) => x.id === id);
    if (s && s.variant === 'clear') {
      const [x, y, w, h] = s.rect;
      clearAreas.push({ id, rect: { x: Math.round(x + w * 0.62), y: Math.round(y + h * 0.36), w: Math.max(4, Math.round(w * 0.12)), h: Math.max(4, Math.round(h * 0.14)) }, lum: s.lum, dim: s.dim });
    }
  }
  const voice = document.getElementById('gev-voice-control');
  const voiceTexts = voice ? [...voice.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && vis(e)).map((e) => ({ text: (e.textContent || '').trim().slice(0, 18), color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize, rect: rect(e) })) : [];
  const topBtns = [...document.querySelectorAll('#top-center-actions button')].filter(vis).map((b) => { const icon = [...b.querySelectorAll('span')].find(vis) || b; return { id: b.id, color: getComputedStyle(icon).color, rect: rect(icon) }; });
  const st = window.__gevGlStats();
  return { titles, voiceTexts, topBtns, cards, clearAreas, htmlLum: document.documentElement.dataset.gevGlassLum, surfaces: st ? st.surfaces.map((s) => ({ id: s.id, variant: s.variant, lum: s.lum, interior: s.interior })) : null };
}, CARD_IDS);

const scenes = [
  { name: 'dark-福州', lon: 119.2965, lat: 26.0745, h: 8000 },
  { name: 'bright-盐湖', lon: 99.0833, lat: 36.6833, h: 12000 },
  { name: 'bright-沙漠', lon: 82.9, lat: 39.0, h: 15000 },
];
const out = { probe: 'review-lg-probe33', scenes: {}, errors };
for (const s of scenes) {
  await page.evaluate((s) => { const v = window.__gevViewer, C = window.__CESIUM__ || window.Cesium; if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(s.lon, s.lat, s.h) }); }, s);
  await sleep(8000);
  const t = await collectTargets();
  const rows = [];
  for (const ti of t.titles) rows.push({ group: 'cardTitle', card: ti.card, text: ti.text, declColor: ti.color, ...(await ringContrast(ti.rect, 6, `p33-${s.name}-title-${ti.card}`)) });
  for (const c of t.voiceTexts) rows.push({ group: 'voice', text: c.text, declColor: c.color, ...(await ringContrast(c.rect, 5)) });
  for (const b of t.topBtns) rows.push({ group: 'topIcon', id: b.id, declColor: b.color, ...(await ringContrast(b.rect, 5)) });
  await page.screenshot({ path: path.join(OUT, `p33-${s.name}-full.png`) });
  const txt = rows.filter((r) => r.group !== 'topIcon'), ico = rows.filter((r) => r.group === 'topIcon');
  // clear dim：玻璃开/关 同点亮度
  const dim = [];
  for (const a of t.clearAreas) {
    const on = await meanLum(a.rect);
    await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
    await sleep(350);
    const off = await meanLum(a.rect);
    await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; });
    await sleep(300);
    dim.push({ id: a.id, lum: a.lum, dimUniform: a.dim, glassOn: on, glassOff: off, dimPct: off > 0.01 ? +(((off - on) / off) * 100).toFixed(1) : null });
  }
  out.scenes[s.name] = {
    htmlLum: t.htmlLum, cards: t.cards.map((c) => ({ id: c.id, lum: c.lum, bg: c.bg })),
    surfaceLum: t.surfaces, rows, dim,
    summary: {
      textMin: Math.min(...txt.map((r) => r.contrast)), textUnder45: txt.filter((r) => r.contrast < 4.5).map((r) => `${r.group}:${r.text || r.card}=${r.contrast}`),
      iconMin: Math.min(...ico.map((r) => r.contrast)), iconUnder3: ico.filter((r) => r.contrast < 3).map((r) => `${r.id}=${r.contrast}`),
      notPainted: rows.filter((r) => !r.painted).map((r) => r.text || r.id || r.card),
    },
  };
}

/* 合成纯白最坏底（二次证据，来自玻璃自身采样源） */
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(600);
await page.evaluate(() => window.__gevGlTestBg(true, -1));
await sleep(1200);
const white = { probe: await page.evaluate(() => window.__gevGlProbe()), targets: null };
const tw = await collectTargets();
const wrows = [];
for (const ti of tw.titles) wrows.push({ group: 'cardTitle', card: ti.card, text: ti.text, ...(await ringContrast(ti.rect, 6)) });
for (const c of tw.voiceTexts) wrows.push({ group: 'voice', text: c.text, ...(await ringContrast(c.rect, 5)) });
for (const b of tw.topBtns) wrows.push({ group: 'topIcon', id: b.id, ...(await ringContrast(b.rect, 5)) });
const wtxt = wrows.filter((r) => r.group !== 'topIcon'), wico = wrows.filter((r) => r.group === 'topIcon');
white.targets = wrows;
white.summary = {
  dsLum: white.probe.dsLum, dsMax: white.probe.dsMax,
  surfaceLum: (tw.surfaces || []).map((x) => x.lum),
  textMin: Math.min(...wtxt.map((r) => r.contrast)), textUnder45: wtxt.filter((r) => r.contrast < 4.5).map((r) => `${r.group}:${r.text || r.card}=${r.contrast}`),
  iconMin: Math.min(...wico.map((r) => r.contrast)), iconUnder3: wico.filter((r) => r.contrast < 3).map((r) => `${r.id}=${r.contrast}`),
};
await page.screenshot({ path: path.join(OUT, 'p33-white-full.png') });
await page.evaluate(() => window.__gevGlTestBg(false));
out.white = white;

fs.writeFileSync(path.join(OUT, 'probe33-contrast.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.scenes)) console.log(k, JSON.stringify(v.summary), 'dim=' + JSON.stringify(v.dim));
console.log('white', JSON.stringify(white.summary));
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await browser.close();
