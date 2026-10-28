#!/usr/bin/env node
/**
 * review-lg-probe15.mjs —— 第三轮复核 · 独立亮/暗可读性度量（reviewer 专用，只读）
 *
 * 亮底构造（与实现者 probe12 不同，不依赖 getContext 抢 canvas）：
 *   直接操作 Cesium 场景：globe.show=false / skyBox / skyAtmosphere / sun / moon 全关，
 *   scene.backgroundColor = Color.WHITE，fog=false → 地图画布每帧绘制纯白，玻璃照常采样。
 *   随后**用截图像素证明**地图区（卡外）确实 ≥0.9 亮，否则该状态作废。
 *
 * 对比度度量（与 probe12 的「元素矩形 p50 当底色」不同）：
 *   底色 = 文字矩形外扩 6px 的**环带**（无笔画区域）亮度中位数；前景 = 矩形内亮度 p99.5。
 *   即「局部面色 vs 笔画峰值」，与字号/字重无关，也不会把笔画像素当底色。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const MODE = process.argv[3] === 'dark' ? 'dark' : 'white';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r3';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'review-lg-probe15', url, mode: MODE, errors: [] };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
await new Promise((r) => setTimeout(r, 2000));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];

const raw = async (clip) => {
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = new Float64Array(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j++) L[j] = lumOf(data[i], data[i + 1], data[i + 2]);
  return { L, w: info.width, h: info.height };
};
/** 环带底色 + 内部笔画峰值（单位：CSS px 矩形；截图内部按 dpr*clip.scale 处理） */
const ringContrast = async (rect, pad = 6, tag) => {
  const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2 };
  if (clip.x + clip.width > 1536) clip.width = 1536 - clip.x;
  if (clip.y + clip.height > 730) clip.height = 730 - clip.y;
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / clip.width, sy = info.height / clip.height;
  const inner = { x0: pad * sx, y0: pad * sy, x1: (pad + rect.w) * sx, y1: (pad + rect.h) * sy };
  const ring = [], core = [];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const L = lumOf(data[i], data[i + 1], data[i + 2]);
      if (x >= inner.x0 && x < inner.x1 && y >= inner.y0 && y < inner.y1) core.push(L); else ring.push(L);
    }
  }
  const Sr = sorted(ring), Sc = sorted(core);
  const bg = q(Sr, 0.5), fg = q(Sc, 0.995), mid = q(Sc, 0.5);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), coreP50: +mid.toFixed(3), ink: +(fg - bg).toFixed(3), contrast: ratio(fg, bg), painted: fg - mid > 0.02, ringN: ring.length, coreN: core.length };
};

/* ---------- 亮底构造 ---------- */
if (MODE === 'white') {
  out.whiteSetup = await page.evaluate(() => {
    const v = window.__gevViewer;
    const C = window.__CESIUM__ || window.Cesium;
    if (!v || !v.scene) return { ok: false, why: 'no viewer' };
    const s = v.scene;
    try {
      s.globe.show = false;
      if (s.skyBox) s.skyBox.show = false;
      if (s.skyAtmosphere) s.skyAtmosphere.show = false;
      if (s.sun) s.sun.show = false;
      if (s.moon) s.moon.show = false;
      if (s.fog) s.fog.enabled = false;
      s.backgroundColor = C.Color.WHITE;
      return { ok: true, hasCesium: !!C, bg: String(s.backgroundColor) };
    } catch (e) { return { ok: false, why: String(e.message) }; }
  });
  await new Promise((r) => setTimeout(r, 2500));
  const proof = await raw({ x: 6, y: 556, width: 260, height: 110 });
  const S = sorted([...proof.L]);
  out.whiteBgProof = { p50: +q(S, 0.5).toFixed(3), p05: +q(S, 0.05).toFixed(3), p95: +q(S, 0.95).toFixed(3), genuineWhite: q(S, 0.5) >= 0.9 };
  out.surfaces = await page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(3)]) : null));
} else {
  await new Promise((r) => setTimeout(r, 2500));
  out.surfaces = await page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(3)]) : null));
}

/* ---------- 目标 ---------- */
const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];
const t = await page.evaluate((CARD_IDS) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return el.offsetParent !== null && r.width > 3 && r.height > 3 && eff(el) > 0.15; };
  const out = { cards: [], voiceTexts: [], topBtns: [], topRect: null };
  for (const id of CARD_IDS) {
    const root = document.getElementById(id);
    if (!root) { out.cards.push({ id, missing: true }); continue; }
    const shell = root.closest('.gev-lc') || root;
    const cs = getComputedStyle(shell);
    out.cards.push({ id, rect: rect(shell), lum: shell.getAttribute('data-gev-lum'), bg: cs.backgroundColor, backdrop: cs.backdropFilter || cs.webkitBackdropFilter });
  }
  const voice = document.getElementById('gev-voice-control');
  if (voice) out.voiceTexts = [...voice.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && vis(e)).map((e) => ({ text: (e.textContent || '').trim().slice(0, 18), color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize, rect: rect(e) }));
  for (const b of [...document.querySelectorAll('#top-center-actions button')].filter(vis)) {
    const icon = [...b.querySelectorAll('span')].find(vis) || b;
    out.topBtns.push({ id: b.id, color: getComputedStyle(icon).color, rect: rect(icon) });
  }
  const top = document.getElementById('top-center-actions');
  if (top) out.topRect = rect(top);
  out.htmlLum = document.documentElement.dataset.gevGlassLum;
  return out;
}, CARD_IDS);
out.targets = t;

const rows = [];
for (const c of t.voiceTexts) {
  const r = await ringContrast(c.rect, 5, `p15-${MODE}-voice-${(c.text || '').replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 6)}`);
  rows.push({ group: 'voiceText', text: c.text, declColor: c.color, fontSize: c.fs, ...r });
}
for (const b of t.topBtns) {
  const r = await ringContrast(b.rect, 5, `p15-${MODE}-top-${b.id}`);
  rows.push({ group: 'topIcon', id: b.id, declColor: b.color, ...r });
}
/* 卡片标题/主文本（每卡最大短文本） */
const cardTexts = await page.evaluate((CARD_IDS) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const res = [];
  for (const id of CARD_IDS) {
    const root = document.getElementById(id);
    if (!root) continue;
    const cands = [...root.querySelectorAll('*')].filter((e) => {
      const tx = (e.textContent || '').trim();
      const r = e.getBoundingClientRect();
      return !e.children.length && tx && tx.length <= 14 && e.offsetParent !== null && r.width > 8 && r.height > 6 && eff(e) > 0.15;
    });
    cands.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; });
    const e = cands[0];
    if (e) res.push({ id, text: (e.textContent || '').trim(), color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize, rect: rect(e) });
  }
  return res;
}, CARD_IDS);
for (const c of cardTexts) {
  const r = await ringContrast(c.rect, 5, `p15-${MODE}-card-${c.id}`);
  rows.push({ group: 'cardText', id: c.id, text: c.text, declColor: c.color, fontSize: c.fs, ...r });
}
out.rows = rows;
const painted = rows.filter((r) => r.painted);
out.summary = {
  painted: painted.length,
  textUnder4_5: painted.filter((r) => r.group !== 'topIcon' && r.contrast < 4.5).map((r) => [r.group, r.id || r.text, r.contrast, r.bg]),
  iconUnder3: painted.filter((r) => r.group === 'topIcon' && r.contrast < 3).map((r) => [r.id, r.contrast, r.bg]),
  minText: Math.min(...painted.filter((r) => r.group !== 'topIcon').map((r) => r.contrast)),
  minIcon: painted.filter((r) => r.group === 'topIcon').length ? Math.min(...painted.filter((r) => r.group === 'topIcon').map((r) => r.contrast)) : null,
};

await page.screenshot({ path: path.join(OUT, `p15-${MODE}-full.png`) });
const vc = t.cards.find((c) => c.id === 'gev-voice-control');
if (vc && !vc.missing) {
  const buf = await page.screenshot({ clip: { x: Math.max(0, vc.rect.x - 10), y: Math.max(0, vc.rect.y - 10), width: vc.rect.w + 20, height: vc.rect.h + 20 } });
  fs.writeFileSync(path.join(OUT, `p15-${MODE}-voice-x4.png`), await sharp(buf).resize({ width: (vc.rect.w + 20) * 4, kernel: 'nearest' }).png().toBuffer());
}
if (t.topRect) {
  const buf = await page.screenshot({ clip: { x: t.topRect.x - 8, y: t.topRect.y - 8, width: t.topRect.w + 16, height: t.topRect.h + 16 } });
  fs.writeFileSync(path.join(OUT, `p15-${MODE}-top-x4.png`), await sharp(buf).resize({ width: (t.topRect.w + 16) * 4, kernel: 'nearest' }).png().toBuffer());
}
fs.writeFileSync(path.join(OUT, `p15-${MODE}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ mode: MODE, whiteSetup: out.whiteSetup, whiteBgProof: out.whiteBgProof, htmlLum: t.htmlLum, surfaces: out.surfaces, rows: rows.map((r) => [r.group, r.id || r.text, r.bg, r.fg, r.contrast, r.painted]), summary: out.summary, errors: out.errors.slice(0, 5) }, null, 1));
await browser.close();
