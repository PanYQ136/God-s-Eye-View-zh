#!/usr/bin/env node
/**
 * review-lg-probe17.mjs —— 语音卡次级标签「局部底色」精测（reviewer 专用，只读）
 * 目的：probe16 的环带中位数在暗底场景给出 关 4.03 / 标准 3.96（<4.5），
 *       而实现者报 5.19–8.41。这里用 4 种底色估计法交叉，判断哪个是真相：
 *   A) 环带 pad=2/3/5/8 中位数   B) 文字矩形内亮度**众数**（0.004 分箱）
 *   C) 矩形内 p20（笔画间隙）    D) 矩形上/下各 2px 条带中位数
 * 输出每种底色下的对比度（前景 = 矩形内 p99.5），并保存 8x 放大图供肉眼核对。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r3';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2400));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];
const modal = (L) => { const b = new Map(); for (const v of L) { const k = Math.round(v / 0.004); b.set(k, (b.get(k) || 0) + 1); } let bk = 0, bn = -1; for (const [k, n] of b) if (n > bn) { bn = n; bk = k; } const inb = L.filter((v) => Math.round(v / 0.004) === bk).sort((x, y) => x - y); return { mode: +q(inb, 0.5).toFixed(3), share: +(bn / L.length).toFixed(2) }; };

const rects = await page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const voice = document.getElementById('gev-voice-control');
  const list = [...voice.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && e.offsetParent && eff(e) > 0.15).map((e) => ({ text: (e.textContent || '').trim().slice(0, 10), color: getComputedStyle(e).color, rect: r(e) }));
  const shell = voice.closest('.gev-lc');
  return { list, cardLum: shell.getAttribute('data-gev-lum'), cardBg: getComputedStyle(shell).backgroundColor, cardRect: r(shell) };
});

const res = [];
for (const it of rects.list) {
  const pad = 10;
  const clip = { x: Math.max(0, it.rect.x - pad), y: Math.max(0, it.rect.y - pad), width: it.rect.w + pad * 2, height: it.rect.h + pad * 2 };
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, `p17-${(it.text || 'x').replace(/[^\w\u4e00-\u9fa5]/g, '')}-x8.png`), await sharp(buf).resize({ width: clip.width * 8, kernel: 'nearest' }).png().toBuffer());
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / clip.width, sy = info.height / clip.height;
  const inX0 = pad * sx, inY0 = pad * sy, inX1 = (pad + it.rect.w) * sx, inY1 = (pad + it.rect.h) * sy;
  const core = [], rings = { 2: [], 3: [], 5: [], 8: [] }, strip = { above: [], below: [] };
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const L = lumOf(data[i], data[i + 1], data[i + 2]);
    const inCore = x >= inX0 && x < inX1 && y >= inY0 && y < inY1;
    if (inCore) { core.push(L); continue; }
    for (const p of [2, 3, 5, 8]) {
      const nearX = x >= (pad - p) * sx && x < (pad + it.rect.w + p) * sx;
      const nearY = y >= (pad - p) * sy && y < (pad + it.rect.h + p) * sy;
      if (nearX && nearY) rings[p].push(L);
    }
    if (x >= inX0 && x < inX1) {
      if (y >= inY0 - 2 * sy && y < inY0) strip.above.push(L);
      if (y >= inY1 && y < inY1 + 2 * sy) strip.below.push(L);
    }
  }
  const Sc = core.slice().sort((a, b) => a - b);
  if (!Sc.length) { res.push({ text: it.text, rect: it.rect, skipped: 'empty core', info: [info.width, info.height], clip }); continue; }
  const fg = q(Sc, 0.995);
  const bgA = Object.fromEntries(Object.entries(rings).map(([k, v]) => [k, +q(v.slice().sort((a, b) => a - b), 0.5).toFixed(3)]));
  const bgC = +q(Sc, 0.2).toFixed(3);
  const bgMod = modal(core);
  const bgD = {
    above: strip.above.length ? +q(strip.above.slice().sort((a, b) => a - b), 0.5).toFixed(3) : null,
    below: strip.below.length ? +q(strip.below.slice().sort((a, b) => a - b), 0.5).toFixed(3) : null,
  };
  res.push({
    text: it.text, color: it.color, rect: it.rect, fg: +fg.toFixed(3),
    bgRing: bgA, bgCoreMode: bgMod, bgCoreP20: bgC, bgStrip: bgD,
    ratioByRing2: ratio(fg, bgA[2]), ratioByRing3: ratio(fg, bgA[3]), ratioByRing5: ratio(fg, bgA[5]), ratioByRing8: ratio(fg, bgA[8]),
    ratioByMode: ratio(fg, bgMod.mode), ratioByP20: ratio(fg, bgC),
    ratioByAbove: bgD.above != null ? ratio(fg, bgD.above) : null,
    ratioByBelow: bgD.below != null ? ratio(fg, bgD.below) : null,
  });
}
const outJson = { url, card: { lum: rects.cardLum, bg: rects.cardBg, rect: rects.cardRect }, rows: res, errors: errs.slice(0, 5) };
fs.writeFileSync(path.join(OUT, 'p17.json'), JSON.stringify(outJson, null, 1));
console.log(JSON.stringify(outJson, null, 1));
await browser.close();
