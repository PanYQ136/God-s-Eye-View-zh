#!/usr/bin/env node
/** qa-lg-pdb.mjs —— 诊断 preserveDrawingBuffer / 玻璃启动条件 */
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() !== 'log') errs.push(m.type() + ': ' + m.text()); });
page.on('framenavigated', (f) => { if (f === page.mainFrame()) errs.push('NAV ' + f.url()); });
await page.goto(process.argv[2] || 'http://localhost:5183/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
const out = await page.evaluate(() => {
  const cv = window.__gevViewer && window.__gevViewer.scene && window.__gevViewer.scene.context;
  let attrs = null;
  try { attrs = cv._gl.getContextAttributes(); } catch (e) { attrs = 'err ' + e.message; }
  const canvases = [...document.querySelectorAll('canvas')].map((c) => ({ id: c.id, w: c.width, h: c.height }));
  // 直接按 bigGLCanvas 逻辑取一个，测可读性
  let readable = null, lum = null;
  try {
    const list = [...document.querySelectorAll('canvas')].filter((c) => c.id !== 'gev-gl-glass' && c.width >= 800 && c.height >= 500);
    const c = list.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const t = document.createElement('canvas'); t.width = 32; t.height = 32;
    const g2 = t.getContext('2d'); g2.drawImage(c, 0, 0, c.width, c.height, 0, 0, 32, 32);
    const d = g2.getImageData(0, 0, 32, 32).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    lum = s / (d.length / 4 * 3); readable = lum > 8;
  } catch (e) { readable = 'err ' + e.message; }
  return {
    gfx: localStorage.getItem('gev.gfx'), armed: sessionStorage.getItem('gev.gl.armed'),
    htmlClass: document.documentElement.className,
    hasStats: !!window.__gevGlStats, hasSet: typeof window.__gevGlSet,
    pdb: attrs && attrs.preserveDrawingBuffer, attrs,
    canvases, readable, lum,
  };
});
console.log(JSON.stringify({ errs: errs.slice(0, 12), out }, null, 1));
await browser.close();
