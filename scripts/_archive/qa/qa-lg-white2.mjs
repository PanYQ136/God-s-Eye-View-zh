#!/usr/bin/env node
/**
 * review-lg-probe16.mjs —— 第三轮复核 · 亮底（纯白最坏底）独立度量，reviewer 专用、只读
 *
 * 亮底构造（第三次修正，前两次失败已记录）：
 *   probe14：按面积取最大非玻璃 canvas → getContext 返回 null（该 canvas 不是 Cesium 渲染画布）；
 *   probe15：改 Cesium 场景 backgroundColor=white + globe.show=false → 该构建默认不重绘（渲染循环不在跑），
 *            canvas 保留最后一帧卫星图，实测卡外区域 p50 0.095，作废；
 *   probe16：**直接用 window.__gevViewer.scene.canvas** 拿真实 WebGL 上下文 → 冻结 Cesium 渲染循环后
 *            gl.clearColor(1,1,1,1)+clear（preserveDrawingBuffer=true，缓冲保留）→
 *            用「卡外 4 个区域」+「玻璃自身采样 dsLum」双重证明才算白底成立。
 *
 * 对比度：底色 = 文字矩形外扩 5–6px 环带中位数（无笔画），前景 = 矩形内 p99.5（笔画峰值）。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const MODE = process.argv[3] === 'dark' ? 'dark' : 'white';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r3';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'review-lg-probe16', url, mode: MODE, errors: [] };

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

const grabL = async (clip) => {
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = new Float64Array(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j++) L[j] = lumOf(data[i], data[i + 1], data[i + 2]);
  return { L, w: info.width, h: info.height, buf };
};
const p50 = async (clip) => { const g = await grabL(clip); return +q(sorted([...g.L]), 0.5).toFixed(3); };

if (MODE === 'white') {
  out.freeze = await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; return { ok: true }; } catch (e) { return { ok: false, why: String(e.message) }; } });
  await new Promise((r) => setTimeout(r, 900));
  /* 白底构造（第四轮自查加固）：probe16 的单次 clear 在本机会被后续重绘覆盖
     （readPixel=255 但 1.6s 后卡外区域 p50 只有 0.061）。这里改为：
     clear → 260ms 后验 4 个卡外区域 + 玻璃采样 dsLum，不达标就重试（最多 12 次），
     成功后再挂一个 16ms 的 keep-white 定时器（持续 clear），最后再验一次。 */
  const regions = { leftUpper: { x: 20, y: 300, width: 120, height: 80 }, midUpper: { x: 640, y: 120, width: 160, height: 70 }, rightUpper: { x: 1180, y: 330, width: 110, height: 90 }, bottomLeft: { x: 12, y: 590, width: 120, height: 60 } };
  const doClear = () => page.evaluate(() => {
    const v = window.__gevViewer;
    const cv = (v.scene && v.scene.canvas) || v.canvas || document.querySelector('#cesiumContainer canvas');
    if (!cv) return { ok: false, why: 'no cesium canvas' };
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    if (!gl) return { ok: false, why: 'no gl', size: [cv.width, cv.height] };
    window.__qaCv = cv; window.__qaGl = gl;
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { ok: true, size: [cv.width, cv.height], readPixel: [...px], isWebGL2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext };
  });
  out.attempts = [];
  for (let i = 0; i < 12; i++) {
    out.clear = await doClear();
    await new Promise((r) => setTimeout(r, 260));
    const proof = {};
    for (const [k, c] of Object.entries(regions)) proof[k] = await p50(c);
    const gls = await page.evaluate(() => (window.__gevGlProbe ? window.__gevGlProbe() : null));
    const mn = Math.min(...Object.values(proof));
    out.attempts.push({ i, regionsMin: mn, dsLum: gls && gls.dsLum });
    if (mn >= 0.85 && gls && gls.dsLum >= 0.85) { out.whiteProof = proof; out.glSample = gls; break; }
  }
  if (!out.whiteProof) {
    const proof = {};
    for (const [k, c] of Object.entries(regions)) proof[k] = await p50(c);
    out.whiteProof = proof;
    out.glSample = await page.evaluate(() => (window.__gevGlProbe ? window.__gevGlProbe() : null));
  }
  /* keep-white：测量期间持续 clear，避免中途被重绘 */
  await page.evaluate(() => {
    window.__qaKeep = setInterval(() => { try { const gl = window.__qaGl; if (gl) { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } } catch (e) {} }, 16);
  });
  await new Promise((r) => setTimeout(r, 400));
  out.whiteProofAfterKeep = {};
  for (const [k, c] of Object.entries(regions)) out.whiteProofAfterKeep[k] = await p50(c);
  out.surfaces = await page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(3)]) : null));
  out.whiteState = {
    regionsMin: Math.min(...Object.values(out.whiteProofAfterKeep)),
    glDsLum: out.glSample && out.glSample.dsLum,
    surfacesAllWhite: (out.surfaces || []).length ? out.surfaces.every((s) => s[1] >= 0.97) : false,
    ok: Math.min(...Object.values(out.whiteProofAfterKeep)) >= 0.85 && out.glSample && out.glSample.dsLum >= 0.85,
  };
} else {
  await new Promise((r) => setTimeout(r, 2000));
  out.surfaces = await page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(3)]) : null));
}

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
for (const c of t.voiceTexts) rows.push({ group: 'voiceText', text: c.text, declColor: c.color, fontSize: c.fs, ...(await ringContrast(c.rect, 6, `p16-${MODE}-voice-${(c.text || '').replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 6)}`)) });
for (const b of t.topBtns) rows.push({ group: 'topIcon', id: b.id, declColor: b.color, ...(await ringContrast(b.rect, 6, `p16-${MODE}-top-${b.id}`)) });
const cardTexts = await page.evaluate((CARD_IDS) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const res = [];
  for (const id of CARD_IDS) {
    const root = document.getElementById(id);
    if (!root) continue;
    const cands = [...root.querySelectorAll('*')].filter((e) => {
      const tx = (e.textContent || '').trim(); const r = e.getBoundingClientRect();
      return !e.children.length && tx && tx.length <= 14 && e.offsetParent !== null && r.width > 8 && r.height > 6 && eff(e) > 0.15;
    });
    cands.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; });
    const e = cands[0];
    if (e) res.push({ id, text: (e.textContent || '').trim(), color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize, rect: rect(e) });
  }
  return res;
}, CARD_IDS);
for (const c of cardTexts) rows.push({ group: 'cardText', id: c.id, text: c.text, declColor: c.color, fontSize: c.fs, ...(await ringContrast(c.rect, 6, `p16-${MODE}-card-${c.id}`)) });
out.rows = rows;
const painted = rows.filter((r) => r.painted);
out.summary = {
  painted: painted.length,
  textUnder4_5: painted.filter((r) => r.group !== 'topIcon' && r.contrast < 4.5).map((r) => [r.group, r.id || r.text, r.contrast, r.bg]),
  iconUnder3: painted.filter((r) => r.group === 'topIcon' && r.contrast < 3).map((r) => [r.id, r.contrast, r.bg]),
  minText: Math.min(...painted.filter((r) => r.group !== 'topIcon').map((r) => r.contrast)),
  minIcon: painted.filter((r) => r.group === 'topIcon').length ? Math.min(...painted.filter((r) => r.group === 'topIcon').map((r) => r.contrast)) : null,
};

await page.screenshot({ path: path.join(OUT, `p16-${MODE}-full.png`) });
const vc = t.cards.find((c) => c.id === 'gev-voice-control');
if (vc && !vc.missing) {
  const buf = await page.screenshot({ clip: { x: Math.max(0, vc.rect.x - 10), y: Math.max(0, vc.rect.y - 10), width: vc.rect.w + 20, height: vc.rect.h + 20 } });
  fs.writeFileSync(path.join(OUT, `p16-${MODE}-voice-x4.png`), await sharp(buf).resize({ width: (vc.rect.w + 20) * 4, kernel: 'nearest' }).png().toBuffer());
}
if (t.topRect) {
  const buf = await page.screenshot({ clip: { x: t.topRect.x - 8, y: t.topRect.y - 8, width: t.topRect.w + 16, height: t.topRect.h + 16 } });
  fs.writeFileSync(path.join(OUT, `p16-${MODE}-top-x4.png`), await sharp(buf).resize({ width: (t.topRect.w + 16) * 4, kernel: 'nearest' }).png().toBuffer());
}
fs.writeFileSync(path.join(OUT, `p16-${MODE}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ mode: MODE, freeze: out.freeze, clear: out.clear, whiteProof: out.whiteProof, whiteState: out.whiteState, glSample: out.glSample, htmlLum: t.htmlLum, surfaces: out.surfaces, rows: rows.map((r) => [r.group, r.id || r.text, r.bg, r.fg, r.contrast, r.painted]), summary: out.summary, errors: out.errors.slice(0, 5) }, null, 1));
await browser.close();
