#!/usr/bin/env node
/**
 * probe-pdb.mjs —— 两个问题一起验：
 *  1) preserveDrawingBuffer:true 时 Cesium 画面是否变黑（msaa4 + pdb 的驱动坑）
 *  2) 不开 pdb 也能不能读到地图：在 scene.postRender 里当场 drawImage（同一 task 内缓冲仍有效）
 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'http://localhost:4173/';
const W = 1536, H = 730;

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});

async function open(q, init) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  if (init) await page.evaluateOnNewDocument(init);
  const logs = [];
  page.on('console', (m) => logs.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 200)));
  await page.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__gevViewer && document.getElementById('data-panel'), { timeout: 120000 });
  await sleep(9000);
  await page.keyboard.press('Escape');
  await sleep(1500);
  page.__logs = logs;
  return page;
}

// A) 现状：?gevEdge=2（pdb=true, msaa=4）
{
  const p = await open('?gevEdge=2');
  const r = await p.evaluate(async () => {
    const v = window.__gevViewer;
    const t = document.createElement('canvas'); t.width = 32; t.height = 32;
    const x = t.getContext('2d'); x.drawImage(v.canvas, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { lum: +(s / (d.length / 4 * 3)).toFixed(1), canvas: [v.canvas.width, v.canvas.height],
      ctx: v.scene.context && v.scene.context._gl ? 'ok' : 'none',
      pdb: (() => { try { return v.scene.context._gl.getContextAttributes().preserveDrawingBuffer; } catch (e) { return 'err'; } })() };
  });
  await p.screenshot({ path: 'evidence/_collab/t_9739e3a7/pdb-A-screen.png' });
  console.log('A pdb=true(msaa4) drawImage-lum:', JSON.stringify(r), '| logs', p.__logs.filter((l) => /gev-edge|WebGL|gl/i.test(l)).slice(-3));
  await p.close();
}

// B) pdb 关闭 + postRender 内取像素
{
  const p = await open('?gevEdge=0');
  const r = await p.evaluate(async () => {
    const v = window.__gevViewer;
    const t = document.createElement('canvas'); t.width = 32; t.height = 32;
    const x = t.getContext('2d', { willReadFrequently: true });
    const out = { postLum: null, outsideLum: null, ticks: 0 };
    const grab = () => {
      out.ticks++;
      if (out.postLum != null) return;
      try {
        x.drawImage(v.canvas, 0, 0, 32, 32);
        const d = x.getImageData(0, 0, 32, 32).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
        out.postLum = +(s / (d.length / 4 * 3)).toFixed(1);
      } catch (e) { out.postLum = 'err:' + e.message; }
    };
    v.scene.postRender.addEventListener(grab);
    await new Promise((r2) => setTimeout(r2, 1500));
    // 对照：rAF 里（不是 postRender）读同一 canvas
    await new Promise((res) => requestAnimationFrame(() => {
      try {
        x.drawImage(v.canvas, 0, 0, 32, 32);
        const d = x.getImageData(0, 0, 32, 32).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
        out.outsideLum = +(s / (d.length / 4 * 3)).toFixed(1);
      } catch (e) { out.outsideLum = 'err:' + e.message; }
      res();
    }));
    return out;
  });
  await p.screenshot({ path: 'evidence/_collab/t_9739e3a7/pdb-B-screen.png' });
  console.log('B pdb=false postRender-grab:', JSON.stringify(r));
  await p.close();
}

// C) pdb=true + msaa=0（看是不是 MSAA 解析后的黑屏）
{
  const p = await open('?gevEdge=2', () => { try { localStorage.setItem('gev.gfx', JSON.stringify({ msaa: 0 })); } catch (e) {} });
  const r = await p.evaluate(() => {
    const v = window.__gevViewer;
    const t = document.createElement('canvas'); t.width = 32; t.height = 32;
    const x = t.getContext('2d'); x.drawImage(v.canvas, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { lum: +(s / (d.length / 4 * 3)).toFixed(1), msaa: v.scene.msaaSampleCount };
  });
  await p.screenshot({ path: 'evidence/_collab/t_9739e3a7/pdb-C-screen.png' });
  console.log('C pdb=true(msaa0):', JSON.stringify(r));
  await p.close();
}
await browser.close();
