#!/usr/bin/env node
/**
 * qa-lg-tail3-final.mjs —— 补充证据
 *  1) dock 两张折叠卡（位置 / 视觉预设）标题对比度（修前注入 vs 修后），暗/亮
 *  2) DPR1 精确 1536×730 截图：暗 / 亮 / 展开托盘
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/tail3';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(DIR, { recursive: true });
const BEFORECSS = `
html.gev-gl-on .gev-lc.collapsed > .panel-inner,
html.gev-gl-on .gev-lc.collapsed > .data-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .scene-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .cctv-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .global-context-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .location-inner,
html.gev-gl-on .gev-lc.collapsed > .pp-panel-body { background: var(--gev-std-bg) !important; }
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .data-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .scene-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .cctv-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .global-context-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .location-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .pp-panel-body { background: var(--gev-std-bg-bright) !important; }
`;
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
const fly = async (lon, lat, h) => {
  await page.evaluate(([lon, lat, h]) => { try { const C = window.Cesium || window.__CESIUM__; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, h), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} }, [lon, lat, h]);
  await new Promise((r) => setTimeout(r, 14000));
};
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const setBefore = (on) => page.evaluate((on, css) => {
  let el = document.getElementById('__ab_before');
  if (on) { if (!el) { el = document.createElement('style'); el.id = '__ab_before'; el.textContent = css; document.head.appendChild(el); } } else if (el) el.remove();
}, on, BEFORECSS);

/* dock 两张卡的标题：放宽到「自身有文字节点」的节点（标题里可能嵌 svg/span） */
const dockTitles = async () => {
  const items = await page.evaluate(() => {
    const res = [];
    for (const id of ['location-bar', 'control-panel']) {
      const el = document.getElementById(id);
      el.querySelectorAll('*').forEach((n) => {
        let direct = '';
        n.childNodes.forEach((cn) => { if (cn.nodeType === 3) direct += cn.textContent; });
        direct = direct.trim();
        if (!direct || direct.length > 10) return;
        const r = n.getBoundingClientRect();
        if (r.width < 8 || r.height < 6) return;
        /* 用 Range 取「文字实际墨迹范围」，避免 144px 宽的 label 把 p95 稀释掉 */
        const range = document.createRange();
        range.selectNodeContents(n);
        const tr = range.getBoundingClientRect();
        range.detach?.();
        if (tr.width < 6 || tr.height < 4) return;
        res.push({ id, t: direct, rect: [Math.round(tr.left), Math.round(tr.top), Math.round(tr.width), Math.round(tr.height)], color: getComputedStyle(n).color });
      });
    }
    return res;
  });
  const rows = [];
  for (const it of items) {
    const clip = { x: it.rect[0] - 1, y: it.rect[1] - 1, width: Math.max(4, it.rect[2] + 2), height: Math.max(4, it.rect[3] + 2) };
    if (clip.x < 0 || clip.y < 0) continue;
    const buf = await page.screenshot({ clip });
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const L = [];
    for (let i = 0; i < data.length; i += info.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
    L.sort((a, b) => a - b);
    const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
    const bg = q(0.5), fg = q(0.95);
    rows.push({ id: it.id, t: it.t, pixel: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), bg: +bg.toFixed(3), fg: +fg.toFixed(3) });
  }
  return rows;
};

await fly(-73.9857, 40.7484, 2200);
out.darkAfter = await dockTitles();
await setBefore(true); await new Promise((r) => setTimeout(r, 900));
out.darkBefore = await dockTitles();
await setBefore(false); await new Promise((r) => setTimeout(r, 600));

await fly(-67.5, -20.13, 12000);
out.brightAfter = await dockTitles();
await setBefore(true); await new Promise((r) => setTimeout(r, 900));
out.brightBefore = await dockTitles();
await setBefore(false); await new Promise((r) => setTimeout(r, 600));

fs.writeFileSync(`${SCR}/tail3-dock-titles.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();

/* ── DPR1 精确 1536×730 截图 ─────────────────────────────────── */
const b2 = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const p2 = await b2.newPage();
await p2.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await p2.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p2.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
await p2.keyboard.press('Escape');
await p2.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
const fly2 = async (lon, lat, h) => {
  await p2.evaluate(([lon, lat, h]) => { try { const C = window.Cesium || window.__CESIUM__; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, h), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} }, [lon, lat, h]);
  await new Promise((r) => setTimeout(r, 15000));
};
await fly2(-73.9857, 40.7484, 2200);
await p2.screenshot({ path: `${DIR}/dark-1536x730-dpr1.png` });
await p2.evaluate(() => { const el = document.getElementById('location-bar'); el.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 })); });
await new Promise((r) => setTimeout(r, 900));
await p2.screenshot({ path: `${DIR}/dark-expanded-tray-1536x730-dpr1.png` });
await p2.evaluate(() => { const el = document.getElementById('location-bar'); el.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 })); });
await new Promise((r) => setTimeout(r, 800));
await fly2(-67.5, -20.13, 12000);
await p2.screenshot({ path: `${DIR}/bright-1536x730-dpr1.png` });
const meta = {};
for (const f of ['dark-1536x730-dpr1.png', 'dark-expanded-tray-1536x730-dpr1.png', 'bright-1536x730-dpr1.png', 'dark-1536x730.png', 'bright-1536x730.png']) {
  const m = await sharp(`${DIR}/${f}`).metadata();
  meta[f] = { w: m.width, h: m.height };
}
fs.writeFileSync(`${DIR}/screenshot-meta.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1));
await b2.close();
