#!/usr/bin/env node
/** qa-lg-wdebug.mjs —— 排查「纯白底」构造在本机为何不生效（只读诊断） */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2500));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const region = { x: 640, y: 120, width: 160, height: 70 };
const p50 = async () => {
  const buf = await page.screenshot({ clip: region });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += info.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
  L.sort((a, b) => a - b);
  return +L[Math.floor(L.length * 0.5)].toFixed(3);
};
const diag = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')].map((c, i) => {
    const r = c.getBoundingClientRect();
    let gl = null, kind = null;
    try { gl = c.getContext('webgl2'); if (gl) kind = 'webgl2'; } catch (e) {}
    if (!gl) { try { gl = c.getContext('webgl'); if (gl) kind = 'webgl'; } catch (e) {} }
    if (!gl) { try { if (c.getContext('2d')) kind = '2d'; } catch (e) {} }
    return { i, id: c.id, cls: (c.className || '').toString().slice(0, 40), size: [c.width, c.height], rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], kind, visible: c.offsetParent !== null, lost: gl && gl.isContextLost ? gl.isContextLost() : null };
  });
  const v = window.__gevViewer;
  const sc = v && v.scene;
  return {
    canvases,
    hasViewer: !!v,
    viewerKeys: v ? Object.keys(window).filter((k) => /viewer/i.test(k)) : [],
    sceneCanvasMatch: sc ? canvases.map((c) => c.size.join('x') === sc.canvas.width + 'x' + sc.canvas.height) : null,
    globeShow: sc && sc.globe ? sc.globe.show : null,
    bg: sc && sc.backgroundColor ? [sc.backgroundColor.red, sc.backgroundColor.green, sc.backgroundColor.blue] : null,
    defaultLoop: v ? v.useDefaultRenderLoop : null,
    cesiumGlobal: typeof window.__CESIUM__,
    cesiumGlobal2: typeof window.Cesium,
    glStats: typeof window.__gevGlStats === 'function',
    docCanvas: document.querySelector('#cesiumContainer canvas') ? 'yes' : 'no',
  };
});
const before = await p50();
const act = await page.evaluate(() => {
  const v = window.__gevViewer; const s = v.scene;
  const out = { steps: [] };
  out.steps.push('no-freeze');
  try { s.globe.show = false; out.steps.push('globe:' + s.globe.show); } catch (e) { }
  try { s.skyBox.show = false; s.skyAtmosphere.show = false; if (s.sun) s.sun.show = false; } catch (e) {}
  try { s.backgroundColor = window.__CESIUM__.Color.WHITE; out.steps.push('bg'); } catch (e) { out.steps.push('bg-fail:' + e.message); }
  try { v.render(); out.steps.push('render'); } catch (e) { out.steps.push('render-fail:' + e.message); }
  const cv = s.canvas; const gl = cv.getContext('webgl2');
  try { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); const px = new Uint8Array(4); gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.readPixel = [...px]; out.steps.push('cleared'); } catch (e) { out.steps.push('clear-fail:' + e.message); }
  out.globeAfter = s.globe.show;
  out.defaultLoopAfter = v.useDefaultRenderLoop;
  return out;
});
const t0 = await p50();
await new Promise((r) => setTimeout(r, 300));
const t300 = await p50();
await new Promise((r) => setTimeout(r, 1500));
const t1800 = await p50();
const after = await page.evaluate(() => ({ globe: window.__gevViewer.scene.globe.show, loop: window.__gevViewer.useDefaultRenderLoop, bg: [window.__gevViewer.scene.backgroundColor.red, window.__gevViewer.scene.backgroundColor.green, window.__gevViewer.scene.backgroundColor.blue], probe: window.__gevGlProbe ? window.__gevGlProbe().dsLum : null }));
const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1536, height: 730 } });
await sharp(buf).resize({ width: 1152 }).png().toFile('C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r4/wdebug.png');
console.log(JSON.stringify({ diag, act, p50: { before, t0, t300, t1800 }, after }, null, 1));
await browser.close();
