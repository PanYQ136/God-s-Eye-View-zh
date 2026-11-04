#!/usr/bin/env node
/**
 * qa-edge-accept.mjs —— t_9739e3a7 验收：CSS 中心 + 只边缘真折射
 *   Q1 帧率（同页 A/B：off/on × 折叠/展开，各 3 次取中位）
 *   Q2 边缘色散（R=G=B 合成条纹；dispPx 4.2 vs 0；互相关最优位移 + |R-B|）
 *   Q3 中心通透 + 边缘锐利（CSS 条纹底探针，绕开 Cesium）
 *   Q4 回归：展开/收缩 rect、页面宽度、滚动条、假彩边=0、9 层 warp
 *   Q5 截图：全屏 / 边缘 6x 特写 / 与 3:25 真 SVG 模式对比
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730;
const OUT = 'evidence/_collab/t_9739e3a7';
fs.mkdirSync(OUT, { recursive: true });
const res = { when: new Date().toISOString(), viewport: [W, H] };

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1536,820'],
  protocolTimeout: 900000,
});

async function load(q) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (/gev-edge|shader|WebGL|ERR|error/i.test(t)) logs.push(t.slice(0, 200)); });
  page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 200)));
  await page.goto('http://localhost:4173/' + q, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
  await sleep(12000);
  await page.keyboard.press('Escape');
  await sleep(2000);
  page.__logs = logs;
  return page;
}
const rectOf = (page, id) => page.evaluate((id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
}, id);
const toggle = async (page, id) => {
  await page.evaluate((id) => {
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    const x = r.left + Math.min(30, r.width / 2), y = r.top + Math.min(16, r.height / 2);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
  }, id);
};
async function fpsOnce(page, ms = 4000) {
  return page.evaluate(async (ms) => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { const a = performance.now(); await new Promise((r) => requestAnimationFrame(r)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    return { p50: p(0.5), p90: p(0.9), fps50: +(1000 / p(0.5)).toFixed(1), fps90: +(1000 / p(0.9)).toFixed(1) };
  }, ms);
}
async function fpsBest(page, on, reps = 3) {
  const arr = [];
  for (let i = 0; i < reps; i++) {
    await page.evaluate((v) => (v ? window.__gevEdge.on() : window.__gevEdge.off()), on);
    await sleep(500);
    arr.push(await fpsOnce(page));
  }
  const med = (k) => arr.map((a) => a[k]).sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return { reps: arr.map((a) => a.fps50), fps50: med('fps50'), fps90: med('fps90'), p50: med('p50') };
}

/* ═══ Q1 帧率 ═══════════════════════════════════════════════════════════ */
{
  const page = await load('?gevEdge=1');
  res.q1 = { collapsed: { off: await fpsBest(page, false), on: await fpsBest(page, true) } };
  await page.evaluate(() => window.__gevEdge.on());
  await page.screenshot({ path: `${OUT}/accept-collapsed.png` });
  await toggle(page, 'data-panel'); await sleep(1600);
  res.q1.expanded = { off: await fpsBest(page, false), on: await fpsBest(page, true) };
  await page.evaluate(() => window.__gevEdge.on());
  await sleep(600);
  await page.screenshot({ path: `${OUT}/accept-expanded.png` });
  res.q1.stats = await page.evaluate(() => window.__gevEdge.stats());
  const box = await rectOf(page, 'data-panel');
  const pp = await rectOf(page, 'pp-toggles');
  // 边缘 6x 特写（真实地图）
  const crop = async (r, name, z = 6) => {
    await sharp(`${OUT}/accept-expanded.png`).extract({ left: Math.max(0, r.x), top: Math.max(0, r.y), width: r.w, height: r.h })
      .resize({ width: r.w * z, height: r.h * z, kernel: 'nearest' }).toFile(`${OUT}/${name}.png`);
  };
  await crop({ x: box[0] - 6, y: box[1] + 30, w: 56, h: 110 }, 'zoom-expanded-left-6x');
  await crop({ x: box[0] + 40, y: box[1] - 6, w: 110, h: 56 }, 'zoom-expanded-top-6x');
  await crop({ x: pp[0] - 6, y: pp[1] - 6, w: 60, h: 64 }, 'zoom-pp-corner-6x');

  /* ═══ Q4 回归 ═══ */
  const r1 = await rectOf(page, 'data-panel');
  await toggle(page, 'data-panel'); await sleep(1800);
  const r2 = await rectOf(page, 'data-panel');
  const dom = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const pp = document.getElementById('pp-toggles');
    const warp = pp.querySelector('.gev-lg-warp');
    const cs = warp ? getComputedStyle(warp) : null;
    return {
      pageScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      docScrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight,
      cardSbW: el.scrollWidth - el.clientWidth,
      hiddenCards: document.querySelectorAll('.gev-lc-hid').length,
      floating: document.querySelectorAll('.gev-lc-floating').length,
      placeholder: document.querySelectorAll('.gev-lc-placeholder').length,
      rimCount: document.querySelectorAll('.gev-lg-rim').length,
      warpCount: document.querySelectorAll('.gev-lg-warp').length,
      edgeCanvas: !!document.getElementById('gev-edge-lens'),
      htmlClass: document.documentElement.className,
      warpInset: cs && cs.inset, warpFilter: cs && (cs.backdropFilter || cs.webkitBackdropFilter),
      warpMaskComposite: cs && (cs.maskComposite || cs.webkitMaskComposite),
      scrollbarWidth: getComputedStyle(pp, '::-webkit-scrollbar').width,
    };
  });
  res.q4 = { expandedRect: r1, collapsedRect: r2, dom };
  await page.screenshot({ path: `${OUT}/accept-after-collapse.png` });

  /* ═══ Q3 中心通透 + 边缘锐利（CSS 条纹底探针） ═══ */
  const SW = 64, SH = 64, buf = Buffer.alloc(SW * SH * 3);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const v = Math.floor(x / 8) % 2 ? 240 : 16; const i = (y * SW + x) * 3; buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; }
  const b64 = 'data:image/png;base64,' + (await sharp(buf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');
  await toggle(page, 'data-panel'); await sleep(1600);
  await page.evaluate((b64) => {
    const st = document.createElement('style'); st.id = '__cssprobe';
    st.textContent = `.cesium-widget, .cesium-widget canvas{visibility:hidden!important}
      #__probe_bg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}
      .gev-lc,.gev-lc *{color:transparent!important;text-shadow:none!important}
      .gev-lc img,.gev-lc svg,.gev-lc video,.gev-lc .material-symbols-outlined{visibility:hidden!important}`;
    document.head.appendChild(st);
    const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
  }, b64);
  await sleep(800);
  await page.screenshot({ path: `${OUT}/accept-probe-pattern.png` });
  {
    const box2 = await rectOf(page, 'data-panel');
    const { data, info } = await sharp(`${OUT}/accept-probe-pattern.png`).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels, iw = info.width;
    const stat = (x0, y0, w, h) => {
      let n = 0, s = 0, ss = 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const i = (y * iw + x) * ch; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        n++; s += l; ss += l * l;
      }
      const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, ss / n - m * m)).toFixed(1) };
    };
    res.q3 = {
      card: box2,
      outside: stat(700, 380, 60, 40),
      band0_8: stat(box2[0] + 1, box2[1] + 60, 8, 120),
      band8_14: stat(box2[0] + 8, box2[1] + 60, 6, 120),
      center: stat(box2[0] + 100, box2[1] + 150, 80, 60),
      ratio_center_over_outside: null,
    };
    res.q3.ratio_center_over_outside = +(res.q3.center.mean / Math.max(1, res.q3.outside.mean)).toFixed(3);
    res.q3.sharpen_ratio_band_over_center = +(res.q3.band0_8.sd / Math.max(0.1, res.q3.center.sd)).toFixed(2);
  }

  /* ═══ Q2 色散（合成纹理直灌 shader，量 R/B 空间错位） ═══ */
  await page.evaluate(() => { document.getElementById('__cssprobe').remove(); const d = document.getElementById('__probe_bg'); if (d) d.remove(); });
  const ringRows = {};
  for (const [name, disp] of [['on', 4.2], ['off', 0]]) {
    await page.evaluate(async (disp) => {
      window.__gevEdge.only(['data-panel']); window.__gevEdge.testBg(true, 8); window.__gevEdge.set({ dispPx: disp });
      await new Promise((r) => setTimeout(r, 500));
      const b = document.getElementById('data-panel').getBoundingClientRect();
      window.__gevEdgeGrab = null; window.__gevEdgeGrabOut = null;
      window.__gevEdgeGrab = { x: b.left, y: Math.round(b.top + b.height * 0.5), w: 24 };
      await new Promise((r) => setTimeout(r, 450));
    }, disp);
    const g = await page.evaluate(() => window.__gevEdgeGrabOut);
    await sleep(200);
    await page.screenshot({ path: `${OUT}/accept-disp-${name}.png` });
    ringRows[name] = g;
  }
  // 互相关：R 与 B 的最优横向位移（行内 0..12px 环带）
  const xcorr = (row) => {
    const R = row.slice(1, 13).map((p) => p[0]), B = row.slice(1, 13).map((p) => p[2]), G = row.slice(1, 13).map((p) => p[1]);
    const best = (a, b) => {
      let bs = 0, bv = -9;
      const curve = {};
      for (let sh = -3; sh <= 3; sh++) {
        let s = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { const j = i + sh; if (j < 0 || j >= b.length) continue; s += a[i] * b[j]; na += a[i] * a[i]; nb += b[j] * b[j]; }
        const v = s / Math.sqrt(Math.max(1e-6, na * nb)); curve[sh] = +v.toFixed(3);
        if (v > bv) { bv = v; bs = sh; }
      }
      return { shift: bs, corr: +bv.toFixed(3), curve };
    };
    let dRB = 0, dRG = 0;
    for (let i = 0; i < R.length; i++) { dRB += Math.abs(R[i] - B[i]); dRG += Math.abs(R[i] - G[i]); }
    return { RB: best(R, B), RG: best(R, G), meanAbsRB: +(dRB / R.length).toFixed(1), meanAbsRG: +(dRG / R.length).toFixed(1), strip: row.slice(0, 14).map((p) => p[0] + '/' + p[1] + '/' + p[2]) };
  };
  res.q2 = { on: ringRows.on && ringRows.on.row ? xcorr(ringRows.on.row) : ringRows.on, off: ringRows.off && ringRows.off.row ? xcorr(ringRows.off.row) : ringRows.off };
  res.logs = page.__logs.slice(-12);
  await page.close();
}

/* ═══ Q5 与 3:25 真 SVG 模式对比（同机同帧） ═══ */
{
  const page = await load('?gevEdge=1');
  await toggle(page, 'data-panel'); await sleep(1600);
  await page.evaluate(() => window.__gevEdge.on());
  await sleep(500);
  await page.screenshot({ path: `${OUT}/cmp-edge-ring.png` });
  await page.evaluate(() => { window.__gevEdge.off(); document.documentElement.classList.add('gev-lens-svg'); });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/cmp-svg-lens.png` });
  await page.evaluate(() => { document.documentElement.classList.remove('gev-lens-svg'); window.__gevEdge.on(); });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/cmp-edge-ring2.png` });
  await page.close();
}

fs.writeFileSync(`${OUT}/qa-edge-accept.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify({
  q1: res.q1 && { collapsed: res.q1.collapsed, expanded: res.q1.expanded, tex: res.q1.stats.tex, count: res.q1.stats.count, fps: res.q1.stats.fps },
  q2: res.q2, q3: res.q3, q4: res.q4, logs: res.logs,
}, null, 1));
await browser.close();
