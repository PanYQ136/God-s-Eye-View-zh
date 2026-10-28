#!/usr/bin/env node
/**
 * review-lg-probe14.mjs —— 第三轮复核（Contract lens）· 独立度量
 * reviewer 专用，只读，不修改实现。
 *
 * 与实现者 probe12 刻意不同的度量：
 *   1) 亮底不靠 __gevGlStats 自证：先 gl.clear 纯白，再**从截图像素**证明地图区真的是白（卡外区域 lum≥0.95），
 *      才采信该状态；同时仍报 surfaces.lum 供交叉对照。
 *   2) 对比度不用「元素矩形 p50 当底色」（小字号标签里 p50 可能落在笔画上，会虚高）：
 *      底色 = **整张卡区域** 亮度直方图众数（面积占比最大的面色），前景 = 文字矩形 p99.5（笔画峰值）。
 *      另外单独报卡片玻璃面实测亮度（卡内无文字条纹的 p50）。
 *   3) 覆盖率检查：只在 effOpacity>0.15 且矩形有墨迹（p99.5-p50>0.02）的目标上判定 PASS/FAIL。
 * 用法：node scripts/review-lg-probe14.mjs http://127.0.0.1:4173/ white|dark
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const MODE = process.argv[3] === 'dark' ? 'dark' : 'white';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r3';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'review-lg-probe14', url, mode: MODE, errors: [] };

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
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1000));

/* ---------- 亮底：清成纯白 ---------- */
const clearWhite = async () => page.evaluate(() => {
  const cands = [...document.querySelectorAll('canvas')].filter((c) => c.id !== 'gev-gl-glass');
  const cv = cands.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  if (!gl) return { ok: false };
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  return { ok: true, size: [cv.width, cv.height] };
});
const surfLums = () => page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(3)]) : null));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);

const grab = async (clip) => {
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += info.channels) L.push(lumOf(data[i], data[i + 1], data[i + 2]));
  return { L, w: info.width, h: info.height };
};
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];
/** 面积众数：0.004 亮度分箱后取最密箱，再取该箱像素中位数（= 玻璃面色） */
const modalLum = (L) => {
  const bins = new Map();
  for (const v of L) { const k = Math.round(v / 0.004); bins.set(k, (bins.get(k) || 0) + 1); }
  let best = null, bestN = -1;
  for (const [k, n] of bins) if (n > bestN) { bestN = n; best = k; }
  const inBin = L.filter((v) => Math.round(v / 0.004) === best);
  const S = sorted(inBin);
  return { mode: +q(S, 0.5).toFixed(3), share: +(bestN / L.length).toFixed(2) };
};

if (MODE === 'white') {
  out.clearWhite = { attempts: 0 };
  for (let i = 0; i < 6; i++) {
    out.clearWhite.attempts++;
    out.clearWhite.last = await clearWhite();
    await new Promise((r) => setTimeout(r, 1300));
    const s = await surfLums();
    out.clearWhite.surfaces = s;
    if (s && s.length && Math.min(...s.map((x) => x[1])) >= 0.9) { out.clearWhite.statsAllWhite = true; break; }
  }
  await new Promise((r) => setTimeout(r, 700));
  /* 独立证明：卡外地图区（画面左下角空白处 320x120）真的是纯白 */
  const bgProof = await grab({ x: 8, y: 560, width: 240, height: 90 });
  const Sb = sorted(bgProof.L);
  out.whiteBgProof = { p50: +q(Sb, 0.5).toFixed(3), p05: +q(Sb, 0.05).toFixed(3), genuineWhite: q(Sb, 0.5) >= 0.9 };
} else {
  await new Promise((r) => setTimeout(r, 2500));
}

/* ---------- 目标采集 ---------- */
const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];
const targets = await page.evaluate((CARD_IDS) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none' || cs.contentVisibility === 'hidden') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return el.offsetParent !== null && r.width > 3 && r.height > 3 && eff(el) > 0.15; };
  const cards = [];
  for (const id of CARD_IDS) {
    const root = document.getElementById(id);
    if (!root) { cards.push({ id, missing: true }); continue; }
    const shell = root.closest('.gev-lc') || root;
    cards.push({
      id, rect: rect(shell), shellLum: shell.getAttribute('data-gev-lum'),
      shellBg: getComputedStyle(shell).backgroundColor,
      backdrop: getComputedStyle(shell).backdropFilter || getComputedStyle(shell).webkitBackdropFilter,
    });
  }
  const voice = document.getElementById('gev-voice-control');
  const voiceTexts = voice ? [...voice.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && vis(e)).map((e) => ({ text: (e.textContent || '').trim().slice(0, 18), id: e.id || null, cls: String(e.className).slice(0, 30), color: getComputedStyle(e).color, rect: rect(e) })) : [];
  const voiceSurface = voice ? rect(voice) : null;
  const topBtns = [...document.querySelectorAll('#top-center-actions button')].filter(vis).map((b) => {
    const icon = [...b.querySelectorAll('span')].find(vis) || b;
    return { id: b.id, label: b.getAttribute('aria-label') || b.title || '', color: getComputedStyle(icon).color, rect: rect(icon), btnRect: rect(b) };
  });
  const top = document.getElementById('top-center-actions');
  return { cards, voiceTexts, voiceSurface, topBtns, topRect: top ? rect(top) : null, topBg: top ? getComputedStyle(top).backgroundColor : null, topLum: top ? top.getAttribute('data-gev-lum') : null, htmlLum: document.documentElement.dataset.gevGlassLum };
}, CARD_IDS);
out.targets = targets;
out.surfaces = await surfLums();

const clampClip = (c) => ({ x: Math.max(0, c.x), y: Math.max(0, c.y), width: Math.max(4, Math.min(c.w, 1536 - Math.max(0, c.x))), height: Math.max(4, Math.min(c.h, 730 - Math.max(0, c.y))) });

const rows = [];
/* 每卡：面色 = 卡区域亮度众数；每卡标题文字 = 最大短文本叶子 */
for (const c of targets.cards) {
  if (c.missing || !c.rect || c.rect.w < 8) continue;
  const cardGrab = await grab(clampClip({ x: c.rect.x + 2, y: c.rect.y + 2, w: c.rect.w - 4, h: c.rect.h - 4 }));
  const modal = modalLum(cardGrab.L);
  rows.push({ group: 'cardSurface', id: c.id, lum: c.shellLum, modal, declaredBg: c.shellBg, backdrop: c.backdrop });
}
/* 语音卡逐文本 */
for (const t of targets.voiceTexts) {
  const cardMode = rows.find((r) => r.id === 'gev-voice-control')?.modal.mode;
  const g = await grab(clampClip({ x: t.rect.x - 1, y: t.rect.y - 1, w: t.rect.w + 2, h: t.rect.h + 2 }));
  const S = sorted(g.L);
  const fg = q(S, 0.995), mid = q(S, 0.5);
  const ink = fg - mid;
  const painted = ink > 0.02;
  rows.push({ group: 'voiceText', text: t.text, id: t.id, cls: t.cls, declColor: t.color, cardMode, fg: +fg.toFixed(3), local: { p50: +mid.toFixed(3) }, contrast: cardMode != null ? ratio(fg, cardMode) : null, painted });
}
/* 顶部图标 */
const topMode = targets.topRect ? modalLum((await grab(clampClip({ x: targets.topRect.x + 4, y: targets.topRect.y + 2, w: targets.topRect.w - 8, h: targets.topRect.h - 4 }))).L).mode : null;
out.topSurfaceMode = topMode;
for (const b of targets.topBtns) {
  const g = await grab(clampClip({ x: b.rect.x - 1, y: b.rect.y - 1, w: b.rect.w + 2, h: b.rect.h + 2 }));
  const S = sorted(g.L);
  const fg = q(S, 0.995), mid = q(S, 0.5);
  rows.push({ group: 'topIcon', id: b.id, label: b.label, declColor: b.color, topMode, fg: +fg.toFixed(3), localP50: +mid.toFixed(3), contrast: topMode != null ? ratio(fg, topMode) : null, painted: fg - mid > 0.02 });
}
out.rows = rows;

const paintedRows = rows.filter((r) => r.group !== 'cardSurface' && r.painted);
out.summary = {
  painted: paintedRows.length,
  textUnder4_5: paintedRows.filter((r) => r.group === 'voiceText' && r.contrast < 4.5).map((r) => [r.text, r.contrast]),
  iconUnder3: paintedRows.filter((r) => r.group === 'topIcon' && r.contrast < 3).map((r) => [r.id, r.contrast]),
  minText: Math.min(...paintedRows.filter((r) => r.group === 'voiceText').map((r) => r.contrast)),
  minIcon: Math.min(...paintedRows.filter((r) => r.group === 'topIcon').map((r) => r.contrast)),
};

/* ---------- 合同审计（与色散/透镜无关的静态项） ---------- */
out.audit = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.gev-lc')];
  const innerBackdrop = [];
  const blackText = [];
  const scrollVis = [];
  const blackish = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return false; const p = m[1].split(',').map(Number); const a = p.length > 3 ? p[3] : 1; return a > 0.5 && (p[0] + p[1] + p[2]) / 3 < 24; };
  for (const card of cards) {
    for (const el of [card, ...card.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      if (el !== card && cs.backdropFilter && cs.backdropFilter !== 'none') innerBackdrop.push(el.className || el.id);
      if (el.tagName === 'CANVAS') continue;
      if ((el.textContent || '').trim() && !el.children.length && blackish(cs.color)) blackText.push((el.textContent || '').trim().slice(0, 16));
      if (cs.overflowY !== 'visible' && el.scrollHeight - el.clientHeight > 4 && cs.overflowY !== 'hidden') scrollVis.push(el.className || el.id);
      const sw = getComputedStyle(el, '::-webkit-scrollbar').width;
      void sw;
    }
  }
  const glc = document.getElementById('gev-gl-glass');
  const stats = window.__gevGlStats ? window.__gevGlStats() : null;
  return {
    cards: cards.length, surfaces: stats ? (stats.surfaces || []).length : null,
    quads: stats ? stats.quads : null,
    innerBackdropCount: innerBackdrop.length, innerBackdropSample: innerBackdrop.slice(0, 5),
    blackTextCount: blackText.length, blackTextSample: blackText.slice(0, 5),
    scrollVisibleCount: scrollVis.length, scrollSample: scrollVis.slice(0, 5),
    glassCanvas: glc ? [glc.width, glc.height] : null,
    dpr: window.devicePixelRatio, scale: stats ? stats.scale : null,
    glErrors: window.__gevGlProbe ? window.__gevGlProbe() : null,
  };
});

/* 兄弟卡 morph 状态：展开数据卡后看 scene-panel */
await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 900));
out.sibling = await page.evaluate(() => {
  const el = document.getElementById('scene-panel');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const shell = el.closest('.gev-lc');
  return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, h: Math.round(el.getBoundingClientRect().height), collapsed: el.getAttribute('data-gev-collapsed') || (shell && shell.getAttribute('data-gev-collapsed')) || null };
});

/* 证据图 */
await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(OUT, `p14-${MODE}-full.png`) });
if (targets.voiceSurface) {
  const c = targets.voiceSurface;
  const buf = await page.screenshot({ clip: clampClip({ x: c.x - 8, y: c.y - 8, w: c.w + 16, h: c.h + 16 }) });
  fs.writeFileSync(path.join(OUT, `p14-${MODE}-voice-x3.png`), await sharp(buf).resize({ width: Math.round((c.w + 16) * 3), kernel: 'nearest' }).png().toBuffer());
}
fs.writeFileSync(path.join(OUT, `p14-${MODE}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({
  mode: MODE, whiteBgProof: out.whiteBgProof, clearWhite: out.clearWhite ? { attempts: out.clearWhite.attempts, statsAllWhite: out.clearWhite.statsAllWhite } : null,
  htmlLum: targets.htmlLum, topLum: targets.topLum, topMode, voiceSurfaceRow: rows.find((r) => r.id === 'gev-voice-control'),
  cardSurfaces: rows.filter((r) => r.group === 'cardSurface').map((r) => [r.id, r.modal.mode, r.declaredBg]),
  voiceRows: rows.filter((r) => r.group === 'voiceText').map((r) => [r.text, r.contrast, r.painted]),
  iconRows: rows.filter((r) => r.group === 'topIcon').map((r) => [r.id, r.label, r.contrast, r.painted]),
  summary: out.summary, audit: out.audit, sibling: out.sibling, errors: out.errors.slice(0, 6),
}, null, 1));
await browser.close();
