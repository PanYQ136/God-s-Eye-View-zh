#!/usr/bin/env node
/**
 * qa-lg-tray-contrast.mjs —— 托盘（.dock-popover-content）文字对比度：当前 scrim vs 加强 scrim
 *  A: 当前（var(--gev-std-bg) = 0.22 单层 scrim）
 *  B: 注入候选 rgba(5,9,14,0.86)
 * 方法同 qa-lg-contrast-ab3：文字矩形 p50=底 / p95=像素，另给声明色 ratio。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const CAND = `html.gev-gl-on #command-dock .dock-popover-content { background: rgba(5, 9, 14, 0.86) !important; }`;
const out = {};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
await page.evaluate(() => { try { const C = window.Cesium || window.__CESIUM__; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} });
await new Promise((r) => setTimeout(r, 14000));
await page.evaluate(() => {
  const panel = document.getElementById('location-bar');
  panel.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
});
await new Promise((r) => setTimeout(r, 900));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

const measure = async (tag) => {
  const texts = await page.evaluate(() => {
    const tray = document.querySelector('#location-bar .dock-popover-content');
    const list = [];
    tray.querySelectorAll('*').forEach((n) => {
      const raw = (n.textContent || '').trim();
      if (!raw || raw.length > 20) return;
      let textChildren = 0;
      n.childNodes.forEach((cn) => {
        if (cn.nodeType === 3 && cn.textContent.trim()) textChildren++;
        else if (cn.nodeType === 1 && !/^(svg|path|img|i|span)$/i.test(cn.tagName)) textChildren += 2;
      });
      if (textChildren > 1) return;
      const r = n.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) return;
      list.push({ t: raw, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], color: getComputedStyle(n).color });
    });
    const trayEl = document.querySelector('#location-bar .dock-popover-content');
    const box = trayEl.getBoundingClientRect();
    return { list: list.slice(0, 14), tray: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)], bg: getComputedStyle(trayEl).backgroundColor };
  });
  const rows = [];
  for (const tx of texts.list) {
    const clip = { x: tx.rect[0] - 1, y: tx.rect[1] - 1, width: Math.max(4, tx.rect[2] + 2), height: Math.max(4, tx.rect[3] + 2) };
    if (clip.x < 0 || clip.y < 0) continue;
    const buf = await page.screenshot({ clip });
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const L = [];
    for (let i = 0; i < data.length; i += info.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
    L.sort((a, b) => a - b);
    const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
    const bg = q(0.5), fg = q(0.95);
    const m = tx.color.match(/[\d.]+/g) || [255, 255, 255];
    const Ld = 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
    rows.push({ t: tx.t, pixel: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), declared: +(((Ld + 0.05) / (bg + 0.05))).toFixed(2), bg: +bg.toFixed(3), fg: +fg.toFixed(3) });
  }
  const trayBuf = await page.screenshot({ clip: { x: texts.tray[0], y: texts.tray[1], width: texts.tray[2], height: texts.tray[3] } });
  fs.writeFileSync(`${SCR}/tray-${tag}.png`, trayBuf);
  return { tag, trayBg: texts.bg, trayRect: texts.tray, rows, minPixel: rows.length ? Math.min(...rows.map((r) => r.pixel)) : null, minDeclared: rows.length ? Math.min(...rows.map((r) => r.declared)) : null };
};

out.A_current = await measure('A-current');
await page.evaluate((css) => { const el = document.createElement('style'); el.id = '__cand'; el.textContent = css; document.head.appendChild(el); }, CAND);
await new Promise((r) => setTimeout(r, 700));
out.B_candidate = await measure('B-086');
await page.evaluate(() => document.getElementById('__cand')?.remove());

fs.writeFileSync(`${SCR}/tail3-tray-contrast.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
