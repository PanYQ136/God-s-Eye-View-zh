#!/usr/bin/env node
/**
 * qa-lg-contrast-ab3.mjs —— 折叠态「内层 .22 暗底」A/B 对比度实测（t_b8251f33 第 1 项）
 *  A = 修前（页面内注入旧规则，把折叠态内层背景还原成 var(--gev-std-bg)）
 *  B = 修后（当前仓库 CSS，内层 transparent）
 * 方法：按「文字叶子元素实际矩形」截图像素法 —— p50 = 底、p95 = 像素最亮处，
 *       ratio = (Lfg+.05)/(Lbg+.05)；同时给 DOM 声明色的 ratio，避免 p95 混入亮块导致误判。
 * 暗/亮两个场景都测；同一页面同一相机，A/B 只差一条 CSS。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(SCR, { recursive: true });
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const out = { url, errors: [] };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push(String(e.message)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
await page.evaluate(() => { try { const api = window.__gevLc; ['data-panel', 'scene-panel', 'cctv-panel', 'global-context-panel'].forEach((id) => api && api.close && api.close(id)); } catch (e) {} });
await new Promise((r) => setTimeout(r, 800));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
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

const setBefore = (on) => page.evaluate((on, css) => {
  let el = document.getElementById('__ab_before');
  if (on) {
    if (!el) { el = document.createElement('style'); el.id = '__ab_before'; el.textContent = css; document.head.appendChild(el); }
  } else if (el) el.remove();
}, on, BEFORECSS);

const measure = async (label) => {
  const cards = [];
  for (const id of IDS) {
    const info = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const inner = el.querySelector('[class$="-inner"], .panel-inner, .location-inner, .pp-panel-body');
      const ics = inner ? getComputedStyle(inner) : null;
      const texts = [];
      el.querySelectorAll('*').forEach((n) => {
        const raw = (n.textContent || '').trim();
        if (!raw || raw.length > 8) return;
        /* 收「只含文字 + 图标(svg/path/img)」的节点：折叠态标题常常是 <span>文字 + <svg> */
        let textChildren = 0;
        n.childNodes.forEach((cn) => {
          if (cn.nodeType === 3 && cn.textContent.trim()) textChildren++;
          else if (cn.nodeType === 1 && !/^(svg|path|img|i)$/i.test(cn.tagName)) textChildren += 2;
        });
        if (textChildren !== 1) return;
        const r = n.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) return;
        if (r.bottom < 0 || r.top > innerHeight) return;
        texts.push({ t: raw, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], color: getComputedStyle(n).color });
      });
      const card = el.getBoundingClientRect();
      return {
        innerBg: ics ? ics.backgroundColor : null,
        lcBg: getComputedStyle(el).backgroundColor,
        lum: el.dataset.gevLum || null,
        card: [Math.round(card.left), Math.round(card.top), Math.round(card.width), Math.round(card.height)],
        texts: texts.slice(0, 6),
      };
    }, id);
    if (!info) { cards.push({ id, skip: 'no-el' }); continue; }
    const row = { id, innerBg: info.innerBg, lcBg: info.lcBg, lum: info.lum, texts: [] };
    for (const tx of info.texts) {
      const clip = { x: tx.rect[0] - 1, y: tx.rect[1] - 1, width: tx.rect[2] + 2, height: tx.rect[3] + 2 };
      if (clip.x < 0 || clip.y < 0 || clip.width < 4 || clip.height < 4) continue;
      const buf = await page.screenshot({ clip });
      const { data, info: ii } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const L = [];
      for (let i = 0; i < data.length; i += ii.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
      L.sort((a, b) => a - b);
      const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
      const bg = q(0.5), fg = q(0.95);
      const m = tx.color.match(/[\d.]+/g) || [255, 255, 255];
      const Ld = 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
      row.texts.push({ t: tx.t, color: tx.color, pixel: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), declared: +(((Ld + 0.05) / (bg + 0.05))).toFixed(2), bg: +bg.toFixed(3), fg: +fg.toFixed(3) });
    }
    row.worstPixel = row.texts.length ? Math.min(...row.texts.map((t) => t.pixel)) : null;
    row.worstDeclared = row.texts.length ? Math.min(...row.texts.map((t) => t.declared)) : null;
    cards.push(row);
  }
  return { label, glassLum: await page.evaluate(() => document.documentElement.dataset.gevGlassLum), cards };
};

/* 暗场景 A/B */
await setBefore(false);
await page.evaluate(() => { try { const C = window.Cesium || window.__CESIUM__; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} });
await new Promise((r) => setTimeout(r, 14000));
out.darkAfter = await measure('dark-after');
await setBefore(true);
await new Promise((r) => setTimeout(r, 900));
out.darkBefore = await measure('dark-before');
await setBefore(false);
await new Promise((r) => setTimeout(r, 600));

/* 亮场景 A/B */
await page.evaluate(() => { try { const C = window.Cesium || window.__CESIUM__; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} });
await new Promise((r) => setTimeout(r, 15000));
out.brightAfter = await measure('bright-after');
await setBefore(true);
await new Promise((r) => setTimeout(r, 900));
out.brightBefore = await measure('bright-before');
await setBefore(false);

fs.writeFileSync(`${SCR}/tail3-contrast-ab.json`, JSON.stringify(out, null, 1));
const short = (r) => r.cards.map((c) => ({ id: c.id, innerBg: c.innerBg, lcBg: c.lcBg, worstPixel: c.worstPixel, worstDeclared: c.worstDeclared, texts: c.texts.map((t) => `${t.t}:${t.pixel}/${t.declared}`) }));
console.log(JSON.stringify({ darkAfter: short(out.darkAfter), darkBefore: short(out.darkBefore), brightAfter: short(out.brightAfter), brightBefore: short(out.brightBefore), errors: out.errors.slice(0, 3) }, null, 1));
await browser.close();
