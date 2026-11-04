#!/usr/bin/env node
/** crop-cards.mjs —— 逐卡导出 PNG（裁剪后 3x 放大，便于人工看边缘/彩边） */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'] });
const p = await b.newPage();
await p.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000); await p.keyboard.press('Escape'); await sleep(1200);
const cards = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
for (const id of cards) {
  const box = await p.evaluate((id) => { const c = document.getElementById(id); const r = c.getBoundingClientRect(); return { x: Math.max(0, Math.round(r.left) - 8), y: Math.max(0, Math.round(r.top) - 8), width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 }; }, id);
  const buf = await p.screenshot({ clip: box });
  await sharp(buf).resize({ width: box.width * 3, kernel: 'nearest' }).png().toFile(`evidence/_collab/t_8cf06356/card-${id}.png`);
  console.log(id, JSON.stringify(box));
}
await p.screenshot({ path: 'evidence/_collab/t_8cf06356/collapsed-full.png' });
await b.close();
