#!/usr/bin/env node
/**
 * qa-lg-tray-vis.mjs —— 位置托盘「展开后到底有没有画出来」的 A/B 诊断
 *  A: 当前 CSS（折叠态 display:none + starting-style）
 *  B: 旧行为（注入 display:flex !important 覆盖折叠态，等同修前）
 * 对每种：点 disclosure 展开 → 等 700ms → 读 elementFromPoint / z-index / 祖先 overflow，
 * 并截 tray 矩形区域算平均亮度，判断像素上是否真的画了托盘。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(SCR, { recursive: true });
const OLD = `#command-dock #location-bar.collapsed .dock-popover-content,
#command-dock #control-panel.collapsed .dock-popover-content { display: flex !important; }`;
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

const probe = async (tag) => {
  const open = await page.evaluate(() => {
    const panel = document.getElementById('location-bar');
    const d = panel.querySelector('.dock-tray-toggle, button[aria-expanded]');
    d.dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
    return panel.classList.contains('collapsed');
  });
  await new Promise((r) => setTimeout(r, 800));
  const info = await page.evaluate(() => {
    const panel = document.getElementById('location-bar');
    const tray = panel.querySelector('.dock-popover-content');
    const cs = getComputedStyle(tray);
    const r = tray.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    let n = tray;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      chain.push({ tag: n.tagName + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''), zIndex: s.zIndex, position: s.position, overflow: s.overflow, transform: s.transform === 'none' ? 'none' : 'yes', opacity: s.opacity, visibility: s.visibility, display: s.display });
      n = n.parentElement;
    }
    return {
      collapsed: panel.classList.contains('collapsed'),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      center: { cx, cy },
      topAtCenter: top ? top.tagName + (top.id ? '#' + top.id : '') + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\s+/).slice(0, 3).join('.') : '') : null,
      topIsTrayOrChild: !!top && (top === tray || tray.contains(top)),
      trayStyle: { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, zIndex: cs.zIndex, bg: cs.backgroundColor, transform: cs.transform },
      chain,
      glassLayer: (() => { const g = document.getElementById('gev-gl-glass'); if (!g) return null; const s = getComputedStyle(g); return { zIndex: s.zIndex, position: s.position, pointerEvents: s.pointerEvents, display: s.display }; })(),
    };
  });
  const clip = { x: info.rect.x, y: info.rect.y, width: Math.max(4, info.rect.w), height: Math.max(4, info.rect.h) };
  if (clip.width < 8 || clip.height < 8) { info.trayAreaMeanLum = null; info.clip = clip; } else {
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(`${SCR}/trayvis-${tag}.png`, buf);
  const { data, info: ii } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i += ii.channels) { s += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]); n++; }
  info.trayAreaMeanLum = +(s / n).toFixed(4);
  }
  info.openAtStart = open;
  /* 收起，准备下一轮 */
  await page.evaluate(() => {
    const panel = document.getElementById('location-bar');
    panel.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  });
  await new Promise((r) => setTimeout(r, 700));
  return info;
};

out.A_current = await probe('A-current');
await page.evaluate((css) => { const el = document.createElement('style'); el.id = '__old'; el.textContent = css; document.head.appendChild(el); }, OLD);
await new Promise((r) => setTimeout(r, 500));
out.B_oldBehaviour = await probe('B-old');
await page.evaluate(() => document.getElementById('__old')?.remove());

fs.writeFileSync(`${SCR}/tail3-trayvis.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
