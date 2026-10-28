#!/usr/bin/env node
/**
 * review-lg-probe12.mjs —— 亮底（纯白最坏底）文字/图标可读性验收
 * 方法（与 reviewer probe9 一致，可复现）：
 *   1) 1536×730 / dsf 2 / 生产预览 (dist)。冻结 Cesium 渲染循环后，直接把地图 canvas 清成纯白
 *      gl.clearColor(1,1,1,1)+clear（pdb 已开，最后一帧保留）→ 玻璃采样 surface.lum ≈ 1 的真实最坏亮底。
 *   2) 不切相机（本构建没有 window.Cesium，只有 window.__CESIUM__，任何 setView 都会被 catch 吞掉）。
 *   3) 对比度两套算法同报：像素法 p97/p50（亮度归一化 WCAG），声明色法（computed color vs 实测底色）。
 * 覆盖：9 卡标题 + 语音卡每个可见文本 + 顶部动作条每个图标 + 顶栏 scrim。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const MODE = process.argv[3] === 'dark' ? 'dark' : 'white';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { url, mode: MODE, errors: [], tests: {} };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 800));

/* 清成纯白（white 模式）；dark 模式保持真实暗城市场景不动。
   注意：清屏偶尔会被瓦片流式渲染覆盖回真实场景（上一轮就出现过一次假失败），
   所以清完必须用 __gevGlStats().surfaces 的 lum 复核“玻璃真的采样到纯白”，不满足就重清。 */
const clearOnce = async () => page.evaluate(() => {
  const cands = [...document.querySelectorAll('canvas')].filter((c) => c.id !== 'gev-gl-glass');
  const mapCv = cands.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const gl = mapCv.getContext('webgl2') || mapCv.getContext('webgl');
  if (!gl) return { ok: false };
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  return { ok: true, size: [mapCv.width, mapCv.height] };
});
const surfLums = async () => page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => +(+s.lum).toFixed(3)) : []));
out.clearWhite = MODE === 'white' ? { attempts: 0 } : { ok: false, reason: 'dark mode: 真实暗城市场景，不清屏' };
if (MODE === 'white') {
  for (let i = 0; i < 5; i++) {
    out.clearWhite.attempts++;
    out.clearWhite.last = await clearOnce();
    await new Promise((r) => setTimeout(r, 1400));
    const l = await surfLums();
    out.clearWhite.surfaceLums = l;
    if (l.length && Math.min(...l) >= 0.9) { out.clearWhite.allWhite = true; break; }
  }
  await new Promise((r) => setTimeout(r, 800));
} else {
  await new Promise((r) => setTimeout(r, 2200));
}

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);

const px = async (clip, tag) => {
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += info.channels) L.push(lumOf(data[i], data[i + 1], data[i + 2]));
  L.sort((x, y) => x - y);
  const q = (p) => L[Math.min(L.length - 1, Math.max(0, Math.floor(p * L.length)))];
  return { lumMap: L, q, w: info.width, h: info.height, info };
};

/** 像素法：p50 = 底，p97/p985 = 前景区（文字/图标） */
const contrastPx = async (clip, tag) => {
  const { q } = await px(clip, tag);
  const bg = q(0.5), fg = q(0.985), fg97 = q(0.97);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), fg97: +fg97.toFixed(3), ratio: ratio(fg, bg), ratio97: ratio(fg97, bg), peak: +q(1).toFixed(3) };
};

/* 逐目标：矩形 + 声明色 + 像素法 + 声明色法 */
const targets = await page.evaluate(() => {
  const rectOf = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const effOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      if (cs.contentVisibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity || '1');
      if (o < 0.02) return 0;
    }
    return o;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return el.offsetParent !== null && r.width > 3 && r.height > 3 && effOpacity(el) > 0.15;
  };
  const list = [];
  // 9 卡标题（每卡取面积最大的短文本叶子）
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];
  for (const id of ids) {
    const root = document.getElementById(id);
    if (!root) { list.push({ group: 'card', id, missing: true }); continue; }
    const shell = root.closest('.gev-lc') || root;
    const cands = [...root.querySelectorAll('*')].filter((e) => {
      const t = (e.textContent || '').trim();
      return t && t.length <= 12 && !e.children.length && visible(e);
    });
    cands.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; });
    const e = cands[0];
    list.push({
      group: 'card', id, shellLum: shell.getAttribute('data-gev-lum'),
      shellBg: getComputedStyle(shell).backgroundColor,
      text: e ? (e.textContent || '').trim() : null,
      color: e ? getComputedStyle(e).color : null,
      rect: e ? rectOf(e) : null,
    });
  }
  // 语音卡每个可见文本
  const voice = document.getElementById('gev-voice-control');
  if (voice) {
    const shell = voice.closest('.gev-lc') || voice;
    for (const e of [...voice.querySelectorAll('*')].filter((x) => !x.children.length && (x.textContent || '').trim() && visible(x)).slice(0, 10)) {
      list.push({ group: 'voice', text: (e.textContent || '').trim().slice(0, 16), id: e.id, cls: String(e.className).slice(0, 40), color: getComputedStyle(e).color, rect: rectOf(e), shellLum: shell.getAttribute('data-gev-lum'), shellBg: getComputedStyle(shell).backgroundColor });
    }
  }
  // 顶部动作条图标
  for (const btn of [...document.querySelectorAll('#top-center-actions button')].filter(visible)) {
    const icon = [...btn.querySelectorAll('span')].find((s) => visible(s)) || btn;
    list.push({ group: 'top', id: btn.id, text: (icon.textContent || '').trim().slice(0, 14), color: getComputedStyle(icon).color, btnColor: getComputedStyle(btn).color, rect: rectOf(icon), shellLum: document.getElementById('top-center-actions').getAttribute('data-gev-lum') });
  }
  return { list, htmlLum: document.documentElement.dataset.gevGlassLum, topBg: getComputedStyle(document.getElementById('top-center-actions')).backgroundColor };
});
out.htmlLum = targets.htmlLum;
out.topBg = targets.topBg;
out.surfaces = await page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(3)]) : null));

const parseRgb = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};

const results = [];
for (const t of targets.list) {
  if (!t.rect) { results.push(t); continue; }
  const clip = { x: Math.max(0, t.rect.x - 1), y: Math.max(0, t.rect.y - 1), width: Math.max(6, t.rect.w + 2), height: Math.max(6, t.rect.h + 2) };
  const tag = t.group === 'card' ? 'p12-' + MODE + '-card-' + t.id : t.group === 'voice' ? 'p12-' + MODE + '-voice-' + (t.id || (t.cls || 'lbl').replace(/[^a-z]/gi, '').slice(0, 10)) : 'p12-' + MODE + '-top-' + t.id;
  const c = await contrastPx(clip, tag);
  // 声明色法：computed color（含 alpha，按实测底合成）vs 实测底
  const rgb = parseRgb(t.color);
  let decl = null;
  if (rgb) {
    const bgL = c.bg;
    const fgL = lumOf(rgb.r, rgb.g, rgb.b);
    const effL = rgb.a >= 1 ? fgL : fgL * rgb.a + bgL * (1 - rgb.a);
    decl = +ratio(effL, bgL).toFixed(2);
  }
  results.push({ ...t, pixels: c, declared: decl });
}
out.tests = results;
const painted = results.filter((r) => r.pixels && r.pixels.peak - r.pixels.bg > 0.015);
out.notPainted = results.filter((r) => r.pixels && r.pixels.peak - r.pixels.bg <= 0.015).map((r) => [r.group, r.id || r.text]);
out.summary = {
  total: painted.length,
  failUnder4_5: painted.filter((r) => r.pixels.ratio < 4.5).map((r) => [r.group, r.id || r.text, r.pixels.ratio, r.declared]),
  failUnder3: painted.filter((r) => r.pixels.ratio < 3).map((r) => [r.group, r.id || r.text, r.pixels.ratio, r.declared]),
};
await page.screenshot({ path: path.join(OUT, 'p12-' + MODE + '-full.png') });
// 语音卡与顶栏特写
const crops = await page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; };
  return { voice: r(document.getElementById('gev-voice-control')), top: r(document.getElementById('top-center-actions')) };
});
for (const [k, c] of Object.entries(crops)) {
  if (c.width < 4) continue;
  const buf = await page.screenshot({ clip: { x: Math.max(0, c.x - 6), y: Math.max(0, c.y - 6), width: c.width + 12, height: c.height + 12 } });
  fs.writeFileSync(path.join(OUT, 'p12-' + MODE + '-' + k + '-crop.png'), await sharp(buf).resize({ width: (c.width + 12) * 3, kernel: 'nearest' }).png().toBuffer());
}
fs.writeFileSync(path.join(OUT, 'review-probe12-' + MODE + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ htmlLum: out.htmlLum, topBg: out.topBg, surfaces: out.surfaces?.filter((s) => ['voice', 'topbar'].includes(s[0]) || true).slice(0, 20), summary: out.summary, rows: results.map((r) => [r.group, r.id || r.text, r.shellLum, r.color, r.pixels && r.pixels.ratio, r.declared]) }, null, 1));
console.log('errors=' + JSON.stringify(out.errors.slice(0, 6)));
await browser.close();
