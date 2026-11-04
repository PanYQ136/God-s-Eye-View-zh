#!/usr/bin/env node
/**
 * qa-gev-contrast.mjs —— 标题/标签对比度（像素法），两种背景：
 *   ① 真实地图  ② 纯白底（最坏情况：雪地/盐湖/白楼）
 * 做法：对每个文字元素取 rect（deviceScaleFactor=2），把像素按亮度分两组：
 *   「字形像素」= 亮度前 15%；「局部底」= 亮度后 40% 的中位数；再按 WCAG 算比值。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const OUT = 'evidence/_collab/t_8cf06356';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730;

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1200);

const TARGETS = [
  ['data-panel', '.panel-title'],
  ['scene-panel', '.panel-title'],
  ['pp-toggles', '.pp-header-label'],
  ['cctv-panel', '.panel-title'],
  ['global-context-panel', '.panel-title'],
  ['location-bar', '.dock-tray-toggle, .location-pill, .panel-title'],
  ['control-panel', '.dock-tray-toggle, .location-pill, .panel-title'],
];

async function measure(tag) {
  const out = [];
  for (const [cardId, sel] of TARGETS) {
    const box = await page.evaluate(([cardId, sel]) => {
      const card = document.getElementById(cardId); if (!card) return null;
      const el = card.querySelector(sel); if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 6) return null;
      return { x: Math.floor(b.left), y: Math.floor(b.top), w: Math.ceil(b.width), h: Math.ceil(b.height), text: (el.textContent || '').trim().slice(0, 12) };
    }, [cardId, sel]);
    if (!box) { out.push({ card: cardId, sel, skip: 'no element' }); continue; }
    const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: ch } = info;
    const lums = [];
    for (let i = 0; i < w * h; i++) {
      const p = i * ch;
      const L = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
      lums.push(L);
    }
    const sorted = [...lums].sort((a, b) => a - b);
    const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
    const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const rel = (v) => srgb(v);
    // 字形：亮端 88 分位；底：暗端 35 分位（文字投影/底材）
    const textL = q(0.88), bgL = q(0.35);
    const ratio = (Math.max(textL, bgL) + 5 * 0) ? ((Math.max(rel(textL), rel(bgL)) + 0.05) / (Math.min(rel(textL), rel(bgL)) + 0.05)) : 0;
    out.push({ card: cardId, sel, text: box.text, textL: Math.round(textL), bgL: Math.round(bgL), contrast: +ratio.toFixed(2) });
  }
  return { tag, rows: out };
}

const onMap = await measure('真实地图');

// 纯白底最坏情况：白底铺在卡片后面
await page.evaluate(() => {
  const st = document.createElement('style'); st.id = '__white';
  st.textContent = `.cesium-widget,.cesium-widget canvas{visibility:hidden!important}
    #__white_bg{position:fixed;inset:0;z-index:0;background:#ffffff}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__white_bg'; document.body.appendChild(d);
});
await sleep(700);
const onWhite = await measure('纯白底(最坏)');
await page.screenshot({ path: path.join(OUT, 'white-bg-full.png') });

const report = { onMap, onWhite };
fs.writeFileSync(path.join(OUT, 'contrast.json'), JSON.stringify(report, null, 1));
for (const r of [onMap, onWhite]) {
  console.log('== ' + r.tag);
  r.rows.forEach((x) => console.log('  ', (x.card || '').padEnd(22), (x.text || x.skip || '').padEnd(14), 'textL', x.textL, 'bgL', x.bgL, 'contrast', x.contrast ?? '-', (x.contrast && x.contrast < 4.5) ? '  FAIL' : '  ok'));
}
await browser.close();
