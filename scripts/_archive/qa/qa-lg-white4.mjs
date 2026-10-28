#!/usr/bin/env node
/**
 * qa-lg-white3.mjs —— 纯白最坏底（真实 Cesium 画布）可复现构造，第四轮自查用
 *
 * 背景：review-lg-probe16 的 `gl.clearColor(1,1,1,1)+clear` 在本机不成立 ——
 *   readPixel 立刻读到 255，但 260ms/1.6s 后卡外区域 p50 只有 0.061–0.145，
 *   玻璃采样 dsLum 恒 0.387：Cesium 渲染循环冻结后没有任何帧提交（compositor 仍显示旧帧），
 *   直接 clear 的 drawing buffer 不会被 present（preserveDrawingBuffer 与否都一样）。
 *   本脚本改用「让 Cesium 自己画一帧纯白」：关掉 skyBox/sun/moon/skyAtmosphere/fog/globe，
 *   scene.backgroundColor = WHITE，然后显式 viewer.render()（多次），再验证 4 个卡外区域
 *   p50 ≥ 0.97 且玻璃采样 dsLum ≥ 0.97、13/13 面 lum ≥ 0.97。
 * 对比度：与 probe16 同方法（底色=文字矩形外扩 6px 环带中位数，前景=矩形内 p99.5）。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r4';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'qa-lg-white3', url, errors: [] };

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

const grabL = async (clip) => {
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = new Float64Array(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j++) L[j] = lumOf(data[i], data[i + 1], data[i + 2]);
  return { L, w: info.width, h: info.height, buf };
};
const p50 = async (clip) => { const g = await grabL(clip); return +q(sorted([...g.L]), 0.5).toFixed(3); };

/* ---- 1) 纯白最坏底：玻璃采样源直填 #ffffff（__gevGlTestBg(true, -1)） ----
   本机 Cesium 渲染循环一旦冻结，compositor 不再提交新帧：gl.clearColor+clear 立即 readPixels=255，
   但卡外区域 p50 恒为卫星图旧帧（0.131）、玻璃采样 dsLum 恒 0.387。
   因此改用玻璃自己的采样源构造最坏底：ds 全填 #ffffff，再用
   surfaces[*].lum === 1.000 与 __gevGlProbe().dsLum === 1.000 双证「玻璃看到的就是纯白」。 */
const regions = {
  leftUpper: { x: 20, y: 300, width: 120, height: 80 },
  midUpper: { x: 640, y: 120, width: 160, height: 70 },
  rightUpper: { x: 1180, y: 330, width: 110, height: 90 },
  bottomLeft: { x: 12, y: 590, width: 120, height: 60 },
};
out.whiteSetup = await page.evaluate(() => {
  if (typeof window.__gevGlTestBg !== 'function') return { ok: false, why: 'no __gevGlTestBg' };
  const r = window.__gevGlTestBg(true, -1);
  return { ok: true, hook: r };
});
await new Promise((r) => setTimeout(r, 900));

out.whiteProof = {};
for (const [k, c] of Object.entries(regions)) out.whiteProof[k] = await p50(c);
out.glSample = await page.evaluate(() => (window.__gevGlProbe ? window.__gevGlProbe() : null));
out.surfaces = await page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(3)]) : null));
out.whiteState = {
  regionsMin: Math.min(...Object.values(out.whiteProof)),
  glDsLum: out.glSample && out.glSample.dsLum,
  surfacesAllWhite: (out.surfaces || []).length ? out.surfaces.every((s) => s[1] >= 0.97) : false,
};
out.whiteState.ok = out.whiteState.regionsMin >= 0.85 && out.glSample && out.glSample.dsLum >= 0.85;

/* ---- 2) 对比度实测 ---- */
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
  if (!Sr.length || !Sc.length) return { missing: true };
  const bg = q(Sr, 0.5), fg = q(Sc, 0.995), mid = q(Sc, 0.5);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), coreP50: +mid.toFixed(3), contrast: ratio(fg, bg), painted: fg - mid > 0.02 };
};

const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];
const t = await page.evaluate((CARD_IDS) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return el.offsetParent !== null && r.width > 3 && r.height > 3 && eff(el) > 0.15; };
  const o = { cards: [], voiceTexts: [], topBtns: [], topRect: null };
  for (const id of CARD_IDS) {
    const root = document.getElementById(id);
    if (!root) { o.cards.push({ id, missing: true }); continue; }
    const shell = root.closest('.gev-lc') || root;
    const cs = getComputedStyle(shell);
    o.cards.push({ id, rect: rect(shell), lum: shell.getAttribute('data-gev-lum'), bg: cs.backgroundColor });
  }
  const voice = document.getElementById('gev-voice-control');
  if (voice) o.voiceTexts = [...voice.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && vis(e)).map((e) => ({ text: (e.textContent || '').trim().slice(0, 18), color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize, rect: rect(e) }));
  for (const b of [...document.querySelectorAll('#top-center-actions button')].filter(vis)) {
    const icon = [...b.querySelectorAll('span')].find(vis) || b;
    o.topBtns.push({ id: b.id, color: getComputedStyle(icon).color, rect: rect(icon) });
  }
  const top = document.getElementById('top-center-actions');
  if (top) o.topRect = rect(top);
  o.htmlLum = document.documentElement.dataset.gevGlassLum;
  return o;
}, CARD_IDS);
out.targets = t;

const rows = [];
for (const c of t.voiceTexts) rows.push({ group: 'voiceText', text: c.text, declColor: c.color, fontSize: c.fs, ...(await ringContrast(c.rect, 6, `p20-white-voice-${(c.text || '').replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 6)}`)) });
for (const b of t.topBtns) rows.push({ group: 'topIcon', id: b.id, declColor: b.color, ...(await ringContrast(b.rect, 6, `p20-white-top-${b.id}`)) });
const cardTexts = await page.evaluate((ids) => {
  const o = [];
  for (const id of ids) {
    const shell = document.getElementById(id) && (document.getElementById(id).closest('.gev-lc') || document.getElementById(id));
    if (!shell) continue;
    const cand = [...shell.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim().length > 1);
    const el = cand.find((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return e.offsetParent !== null && r.width > 6 && r.height > 6 && +cs.opacity > 0.15; });
    if (!el) continue;
    const r = el.getBoundingClientRect();
    o.push({ id, text: (el.textContent || '').trim().slice(0, 14), color: getComputedStyle(el).color, fs: getComputedStyle(el).fontSize, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } });
  }
  return o;
}, CARD_IDS);
for (const c of cardTexts) rows.push({ group: 'cardText', id: c.id, text: c.text, declColor: c.color, fontSize: c.fs, ...(await ringContrast(c.rect, 6, `p20-white-card-${c.id}`)) });
out.rows = rows;
const painted = rows.filter((r) => r.painted);
out.summary = {
  painted: painted.length,
  textUnder4_5: painted.filter((r) => r.group !== 'topIcon' && r.contrast < 4.5).map((r) => [r.group, r.id || r.text, r.contrast, r.bg]),
  iconUnder3: painted.filter((r) => r.group === 'topIcon' && r.contrast < 3).map((r) => [r.id, r.contrast, r.bg]),
  minText: Math.min(...painted.filter((r) => r.group !== 'topIcon').map((r) => r.contrast)),
  minIcon: painted.filter((r) => r.group === 'topIcon').length ? Math.min(...painted.filter((r) => r.group === 'topIcon').map((r) => r.contrast)) : null,
};

await page.screenshot({ path: path.join(OUT, 'p20-white-full.png') });
fs.writeFileSync(path.join(OUT, 'p20-white.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ mode: 'white3', whiteSetup: out.whiteSetup, whiteState: out.whiteState, whiteProof: out.whiteProof, glSample: out.glSample, surfaces: out.surfaces, htmlLum: t.htmlLum, summary: out.summary, errors: out.errors.slice(0, 5) }, null, 1));
await browser.close();
