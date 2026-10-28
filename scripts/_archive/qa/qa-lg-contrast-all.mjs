#!/usr/bin/env node
/** qa-lg-contrast-all.mjs —— 亮/暗背景下 9 张卡标题行的像素法对比度（WCAG p97/p50） */
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const measure = async (label) => {
  const out = { label, html: await page.evaluate(() => document.documentElement.dataset.gevGlassLum), cards: [] };
  for (const id of IDS) {
    const info = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const inner = el.querySelector('[class$="-inner"], .panel-inner, .location-inner, .pp-panel-body, .dock-tray-toggle');
      const cs = inner ? getComputedStyle(inner) : null;
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), innerBg: cs ? cs.backgroundColor : null, cls: inner ? inner.className : null };
    }, id);
    if (!info || info.w < 12 || info.h < 8) { out.cards.push({ id, skip: true }); continue; }
    /* 标题行：卡内上部 6..26px，避开圆角 */
    const clip = { x: info.x + 6, y: info.y + 6, width: Math.max(10, info.w - 12), height: Math.min(22, Math.max(8, info.h - 12)) };
    const buf = await page.screenshot({ clip });
    fs.writeFileSync(`${SCR}/ct-${label}-${id}.png`, buf);
    const { data, info: ii } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const L = [];
    for (let i = 0; i < data.length; i += ii.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
    L.sort((a, b) => a - b);
    const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
    const bg = q(0.5), fg = q(0.97);
    out.cards.push({ id, innerBg: info.innerBg, clip, ratio: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), bg: +bg.toFixed(3), fg: +fg.toFixed(3) });
  }
  return out;
};
const dark = await measure('dark');
/* 亮场景（盐湖） */
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 15000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1500));
const bright = await measure('bright');
const out = { url, dark, bright, errors: errs };
fs.writeFileSync(`${SCR}/qa-lg-contrast-all.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ dark: dark.cards, bright: bright.cards, errors: errs.slice(0, 3) }, null, 1));
await browser.close();
