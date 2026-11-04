#!/usr/bin/env node
/** dbg-squircle-measure.mjs —— 排查测量截图的坐标系/位置 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const OUT = 'evidence/_collab/t_3e129970';
const DSF = 2;
const b = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730', '--hide-scrollbars'],
});
const page = await b.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: DSF });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const btn = w.querySelector('button'); if (btn) btn.click(); } });
await new Promise((r) => setTimeout(r, 3000));
const before = await page.evaluate(() => {
  const ids = ['data-panel', 'cctv-panel', 'global-context-panel'];
  return ids.map((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return [id, r.left, r.top, r.width, r.height]; });
});
await page.evaluate(() => {
  const s = document.createElement('style');
  s.id = 'qa-measure-bg';
  s.textContent = `#cesiumContainer, .cesium-widget, .cesium-widget canvas, #gev-edge-lens { visibility: hidden !important; }
    html, body { background: #fff !important; }
    .gev-lc { background: #000 !important; box-shadow: none !important; }
    .gev-lc * { color: transparent !important; text-shadow: none !important; }
    .gev-lc .gev-lg-warp { display: none !important; }`;
  document.head.appendChild(s);
  try { window.__gevEdge.off(); } catch (e) {}
});
await new Promise((r) => setTimeout(r, 1200));
const after = await page.evaluate(() => {
  const ids = ['data-panel', 'cctv-panel', 'global-context-panel'];
  return ids.map((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [id, r.left, r.top, r.width, r.height, cs.visibility, cs.opacity, cs.backgroundColor]; });
});
const scroll = await page.evaluate(() => [window.scrollX, window.scrollY, document.documentElement.scrollLeft, document.documentElement.scrollTop, document.body.scrollTop]);
await page.screenshot({ path: `${OUT}/dbg-full-white.png` });
const r = after[1];
await page.screenshot({ path: `${OUT}/dbg-cctv-big.png`, clip: { x: Math.round(r[1]) - 40, y: Math.round(r[2]) - 40, width: 260, height: 140 } });
fs.writeFileSync(`${OUT}/dbg-measure.json`, JSON.stringify({ before, after, scroll }, null, 1));
console.log(JSON.stringify({ before, after, scroll }, null, 1));
await b.close();
