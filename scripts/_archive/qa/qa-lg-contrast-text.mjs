#!/usr/bin/env node
/** qa-lg-contrast-text.mjs —— 按「文字元素实际矩形」测量对比度（比整条 header 更准） */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
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
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

const measure = async (label) => {
  const res = { label, html: await page.evaluate(() => document.documentElement.dataset.gevGlassLum), cards: [] };
  for (const id of IDS) {
    const info = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const lum = el.dataset.gevLum || null;
      const texts = [];
      el.querySelectorAll('*').forEach((n) => {
        if (n.children.length) return;
        const t = (n.textContent || '').trim();
        if (!t || t.length > 8) return;
        const r = n.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) return;
        const c = getComputedStyle(n).color;
        texts.push({ t, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], color: c });
      });
      const card = el.getBoundingClientRect();
      return { lum, card: [Math.round(card.left), Math.round(card.top), Math.round(card.width), Math.round(card.height)], texts: texts.slice(0, 4) };
    }, id);
    if (!info) { res.cards.push({ id, skip: 'no-el' }); continue; }
    const row = { id, lum: info.lum, texts: [] };
    for (const tx of info.texts) {
      const clip = { x: tx.rect[0] - 1, y: tx.rect[1] - 1, width: tx.rect[2] + 2, height: tx.rect[3] + 2 };
      if (clip.x < 0 || clip.y < 0 || clip.width < 4 || clip.height < 4) continue;
      const buf = await page.screenshot({ clip });
      const { data, info: ii } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const L = [];
      let fgCount = 0;
      for (let i = 0; i < data.length; i += ii.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
      L.sort((a, b) => a - b);
      const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
      const bg = q(0.5), fg = q(0.95);
      /* 声明色对比（用 DOM 声明色，避免 p97 混入背景亮块） */
      const m = tx.color.match(/[\d.]+/g) || [255, 255, 255];
      const Ld = 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
      row.texts.push({ t: tx.t, color: tx.color, pixel: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), declared: +(((Ld + 0.05) / (bg + 0.05))).toFixed(2), bg: +bg.toFixed(3), fg: +fg.toFixed(3) });
    }
    res.cards.push(row);
  }
  return res;
};
const dark = await measure('dark');
await page.evaluate(() => {
  try { const C = window.Cesium || window.__CESIUM__; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {}
});
await new Promise((r) => setTimeout(r, 15000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1500));
const bright = await measure('bright');
const summarize = (r) => r.cards.map((c) => ({ id: c.id, lum: c.lum, html: r.html, texts: (c.texts || []).map((t) => `${t.t}:${t.pixel}/${t.declared}`) }));
fs.writeFileSync(`${SCR}/qa-lg-contrast-text.json`, JSON.stringify({ dark, bright, errors: errs }, null, 1));
console.log(JSON.stringify({ dark: summarize(dark), bright: summarize(bright), errors: errs.slice(0, 3) }, null, 1));
await browser.close();
