#!/usr/bin/env node
/** qa-lg-pp-diag.mjs —— 诊断 pp-toggles / location-bar 标题对比度为何低 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
const diag = await page.evaluate(() => {
  const out = {};
  for (const id of ['pp-toggles', 'location-bar', 'control-panel', 'scene-panel']) {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const kids = [];
    el.querySelectorAll('*').forEach((n) => {
      if (kids.length > 14) return;
      const c = getComputedStyle(n);
      const b = n.getBoundingClientRect();
      const txt = (n.textContent || '').trim().slice(0, 12);
      if (!txt && !n.className) return;
      kids.push({ cls: String(n.className).slice(0, 40), txt, color: c.color, bg: c.backgroundColor, op: c.opacity, z: c.zIndex, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] });
    });
    out[id] = { lc: el.classList.contains('gev-lc'), bg: cs.backgroundColor, z: cs.zIndex, opacity: cs.opacity, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], kids: kids.slice(0, 8) };
  }
  return out;
});
const clip = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; });
const buf = await page.screenshot({ clip });
fs.writeFileSync(`${SCR}/pp-toggles-card.png`, buf);
const m = await sharp(buf).metadata();
await sharp(buf).resize(m.width * 3, m.height * 3, { kernel: 'nearest' }).png().toFile(`${SCR}/pp-toggles-card-3x.png`);
console.log(JSON.stringify({ diag, clip, errors: errs.slice(0, 3) }, null, 1));
await browser.close();
