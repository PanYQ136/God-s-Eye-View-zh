#!/usr/bin/env node
/**
 * probe-ring.mjs —— 折射环内部取证（绕开卡壳 tint，直接读 canvas 像素）
 *  1) testBg 合成条纹（R=G=B）→ 读左边缘一条横带，看 R/G/B 是否真的错开
 *  2) dispPx=0 对照组
 *  3) 再叠真实地图，确认纹理来自 Cesium
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730, OUT = 'evidence/_collab/t_9739e3a7';
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.text().slice(0, 200)));
await page.goto('http://localhost:4173/?gevEdge=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && document.getElementById('data-panel'), { timeout: 120000 });
await sleep(10000);
await page.keyboard.press('Escape');
await sleep(1500);
// 展开 data-panel
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
});
await sleep(1400);

async function grab(conf) {
  return page.evaluate(async (conf) => {
    window.__gevEdge.only(['data-panel']);
    window.__gevEdge.testBg(conf.test, 8);
    window.__gevEdge.set({ dispPx: conf.disp });
    await new Promise((r) => setTimeout(r, 500));
    window.__gevEdgeGrab = null; window.__gevEdgeGrabOut = null;
    const b = document.getElementById('data-panel').getBoundingClientRect();
    window.__gevEdgeGrab = { x: b.left, y: Math.round(b.top + b.height / 2), w: 40 };
    await new Promise((r) => setTimeout(r, 500));
    const out = window.__gevEdgeGrabOut;
    const st = window.__gevEdge.stats();
    return { box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], out, frames: st.frames, tex: st.tex, err: st.err };
  }, conf);
}
const A = await grab({ test: true, disp: 4.2 });
const B = await grab({ test: true, disp: 0 });
const C = await grab({ test: false, disp: 4.2 });
fs.writeFileSync(`${OUT}/probe-ring.json`, JSON.stringify({ A, B, C, logs: logs.slice(-8) }, null, 1));

const show = (name, d) => {
  if (!d.out || !d.out.row) return console.log(name, 'NO ROW', JSON.stringify(d).slice(0, 300));
  const r = d.out.row;
  const fmt = (i) => '[' + r.map((p) => p[0]).slice(i, i + 1)[0];
  console.log(name, 'box', d.box, 'tex', d.tex, 'frames', d.frames);
  console.log('  x  R   G   B   A');
  for (let i = 0; i < Math.min(30, r.length); i++) {
    console.log('  ' + String(i).padStart(2) + ' ' + r[i].map((v) => String(v).padStart(3)).join(' '));
  }
  // 每像素 R-B 差
  console.log('  R-B:', r.slice(0, 30).map((p) => p[0] - p[2]).join(','));
};
show('A test-bg disp=4.2', A);
show('B test-bg disp=0  ', B);
show('C real-map disp=4.2', C);
await browser.close();
