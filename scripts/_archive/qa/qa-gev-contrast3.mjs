#!/usr/bin/env node
/**
 * qa-gev-contrast3.mjs —— 对比度：用「声明中的文字颜色」（computedStyle）+ 实测局部底色
 * （11px 中文抗锯齿会让「取最亮像素」低估字形亮度，所以文字侧直接用 CSS 颜色，底色侧用像素中位数）
 * 三个场景：真实地图 / 纯白底 0.52 档 / 纯白底 bright 0.72 档
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const OUT = 'evidence/_collab/t_8cf06356';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGETS = [
  ['data-panel', '.panel-title'], ['scene-panel', '.panel-title'], ['pp-toggles', '.pp-header-label'],
  ['cctv-panel', '.panel-title'], ['global-context-panel', '.panel-title'],
  ['location-bar', '.dock-tray-toggle, .location-pill, .panel-title'], ['control-panel', '.dock-tray-toggle, .location-pill, .panel-title'],
];
const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const relOf = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500); await page.keyboard.press('Escape'); await sleep(1500);

async function lab(tag) {
  const rows = [];
  for (const [cardId, sel] of TARGETS) {
    const info = await page.evaluate(([cardId, sel]) => {
      const card = document.getElementById(cardId); if (!card) return null;
      const el = card.querySelector(sel); if (!el) return null;
      const t = el.getBoundingClientRect(), c = card.getBoundingClientRect();
      let bg = { x: Math.round(t.right + 10), y: Math.round(t.top), width: 30, height: Math.max(6, Math.round(t.height)) };
      if (bg.x + bg.width > c.right - 4) bg = { x: Math.round(c.left + 8), y: Math.round(t.bottom + 5), width: Math.min(50, Math.round(c.width - 16)), height: 7 };
      const col = getComputedStyle(el).color.match(/[\d.]+/g).slice(0, 3).map(Number);
      return { color: col, bg, label: (el.textContent || '').trim().slice(0, 10) };
    }, [cardId, sel]);
    if (!info) { rows.push({ card: cardId, skip: true }); continue; }
    const buf = await page.screenshot({ clip: info.bg });
    const { data, info: ii } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const L = [];
    for (let i = 0; i < ii.width * ii.height; i++) { const p = i * ii.channels; L.push(0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]); }
    L.sort((a, b) => a - b);
    const bgL = L[Math.floor(L.length / 2)];
    const fgRel = relOf(info.color);
    const bgRel = srgb(bgL);
    const ratio = (Math.max(fgRel, bgRel) + 0.05) / (Math.min(fgRel, bgRel) + 0.05);
    rows.push({ card: cardId, text: info.label, colorRGB: info.color, bgLum: Math.round(bgL), contrast: +ratio.toFixed(2) });
  }
  return { tag, rows };
}
const onMap = await lab('真实地图(0.52)');
await page.evaluate(() => {
  const st = document.createElement('style'); st.id = '__w';
  st.textContent = `.cesium-widget,.cesium-widget canvas{visibility:hidden!important}#__wb{position:fixed;inset:0;z-index:0;background:#fff}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__wb'; document.body.appendChild(d);
});
await sleep(900);
const onWhite = await lab('纯白底(0.52)');
await page.evaluate(() => { document.documentElement.dataset.gevGlassLum = 'bright'; });
await sleep(500);
await page.screenshot({ path: path.join(OUT, 'white-bright-full.png') });
const onWhiteBright = await lab('纯白底(bright 0.72)');
await page.evaluate(() => { delete document.documentElement.dataset.gevGlassLum; const s = document.getElementById('__w'); if (s) s.remove(); const b = document.getElementById('__wb'); if (b) b.remove(); });

const rep = { onMap, onWhite, onWhiteBright };
fs.writeFileSync(path.join(OUT, 'contrast3.json'), JSON.stringify(rep, null, 1));
for (const r of [onMap, onWhite, onWhiteBright]) {
  console.log('== ' + r.tag);
  for (const x of r.rows) console.log('   ' + String(x.card).padEnd(22), String(x.text || '').padEnd(8), 'text', JSON.stringify(x.colorRGB), 'bg', x.bgLum, 'ratio', x.contrast, x.contrast < 4.5 ? 'FAIL' : 'ok');
}
await browser.close();
