#!/usr/bin/env node
/**
 * qa-edge-accept2.mjs —— 补测：Q2 色散（干净页）/ Q3 边缘锐利 vs 中心磨砂 / Q4 基线对照
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730, OUT = 'evidence/_collab/t_9739e3a7';
const res = {};

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
  protocolTimeout: 900000,
});
async function load(q) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('http://localhost:4173/' + q, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
  await sleep(11000);
  await page.keyboard.press('Escape');
  await sleep(1800);
  if (q.indexOf('gevEdge=1') >= 0) await page.waitForFunction(() => window.__gevEdge && window.__gevEdge.stats().frames > 0, { timeout: 60000 });
  return page;
}
const rectOf = (page, id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }, id);
const toggle = async (page, id) => {
  await page.evaluate((id) => {
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    const x = r.left + Math.min(30, r.width / 2), y = r.top + Math.min(16, r.height / 2);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
  }, id);
};

/* ══ Q2 色散：干净页，条纹 6px，多处取样 ═══════════════════════════════════ */
{
  const page = await load('?gevEdge=1');
  await toggle(page, 'data-panel'); await sleep(1500);
  const grabAt = async (disp, yFrac) => page.evaluate(async ([disp, yFrac]) => {
    window.__gevEdge.only(['data-panel']);
    window.__gevEdge.testBg(true, 6);
    window.__gevEdge.set({ dispPx: disp });
    await new Promise((r) => setTimeout(r, 450));
    const b = document.getElementById('data-panel').getBoundingClientRect();
    window.__gevEdgeGrab = null; window.__gevEdgeGrabOut = null;
    window.__gevEdgeGrab = { x: b.left, y: Math.round(b.top + b.height * yFrac), w: 22 };
    await new Promise((r) => setTimeout(r, 400));
    const o = window.__gevEdgeGrabOut;
    const st = window.__gevEdge.stats();
    return { row: o && o.row, tex: st.tex, frames: st.frames };
  }, [disp, yFrac]);
  const analyse = (row) => {
    if (!row || !row.length) return null;
    const R = row.map((p) => p[0]), G = row.map((p) => p[1]), B = row.map((p) => p[2]);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const d = (a) => { const m = mean(a); return a.map((v) => v - m); };
    const corr = (a, b, sh) => {
      let s = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { const j = i + sh; if (j < 0 || j >= b.length) continue; s += a[i] * b[j]; na += a[i] * a[i]; nb += b[j] * b[j]; }
      return s / Math.sqrt(Math.max(1e-9, na * nb));
    };
    const R0 = d(R), G0 = d(G), B0 = d(B);
    const curve = {}; let bs = 0, bv = -9;
    for (let sh = -4; sh <= 4; sh++) { const v = (corr(R0, B0, sh) + corr(R0, G0, sh)) / 2; curve[sh] = +v.toFixed(4); if (v > bv) { bv = v; bs = sh; } }
    let dR = 0, dB = 0;
    for (let i = 0; i < R.length; i++) { dR += Math.abs(R[i] - G[i]); dB += Math.abs(G[i] - B[i]); }
    return { bestShift: bs, bestCorr: +bv.toFixed(4), corr0: curve[0], curve, meanAbsRG: +(dR / R.length).toFixed(1), meanAbsGB: +(dB / R.length).toFixed(1), R: R.slice(0, 16), G: G.slice(0, 16), B: B.slice(0, 16) };
  };
  const ys = [0.3, 0.5, 0.7];
  const A = [], Bc = [];
  for (const y of ys) { const g = await grabAt(4.2, y); A.push(analyse(g.row)); }
  for (const y of ys) { const g = await grabAt(0, y); Bc.push(analyse(g.row)); }
  await page.evaluate(() => { window.__gevEdge.set({ dispPx: 4.2 }); });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/accept2-disp-on.png` });
  const g2 = await grabAt(4.2, 0.5);
  res.q2 = { tex: g2.tex, on: A, off: Bc, note: 'bestShift = R/B 互相关最优横向位移（px）；dispPx=0 应恒为 0' };
  await page.close();
}

/* ══ Q3 边缘锐利 vs 中心磨砂（CSS 条纹探针 + 环关掉） ═════════════════════ */
{
  const page = await load('?gevEdge=1');
  await toggle(page, 'data-panel'); await sleep(1500);
  const SW = 64, SH = 64, buf = Buffer.alloc(SW * SH * 3);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const v = Math.floor(x / 8) % 2 ? 240 : 16; const i = (y * SW + x) * 3; buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; }
  const b64 = 'data:image/png;base64,' + (await sharp(buf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');
  await page.evaluate((b64) => {
    const st = document.createElement('style'); st.id = '__cssprobe';
    st.textContent = `.cesium-widget, .cesium-widget canvas{visibility:hidden!important}
      #__probe_bg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}
      .gev-lc,.gev-lc *{color:transparent!important;text-shadow:none!important}
      .gev-lc img,.gev-lc svg,.gev-lc video,.gev-lc .material-symbols-outlined{visibility:hidden!important}`;
    document.head.appendChild(st);
    const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
    window.__gevEdge.off();
  }, b64);
  await sleep(900);
  const box = await rectOf(page, 'data-panel');
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); return `${OUT}/${name}.png`; };
  const statOf = async (png, x0, y0, w, h) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels, iw = info.width; let n = 0, s = 0, ss = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * iw + x) * ch; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; s += l; ss += l * l; }
    const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, ss / n - m * m)).toFixed(1) };
  };
  const p1 = await shot('accept2-ring-off-pattern');
  const outSide = await statOf(p1, 700, 380, 60, 40);
  const bandOff = await statOf(p1, box[0] + 1, box[1] + 60, 9, 120);       // 环关：应保持锐利
  const midOff = await statOf(p1, box[0] + 16, box[1] + 60, 8, 120);       // 羽化区
  const centerOff = await statOf(p1, box[0] + 110, box[1] + 150, 80, 60);  // 中心：磨砂
  await page.evaluate(() => window.__gevEdge.on());
  await sleep(800);
  const p2 = await shot('accept2-ring-on-pattern');
  const bandOn = await statOf(p2, box[0] + 1, box[1] + 60, 9, 120);
  const centerOn = await statOf(p2, box[0] + 110, box[1] + 150, 80, 60);
  res.q3 = {
    card: box, outside: outSide,
    ring_off: { edgeBand0_9: bandOff, feather16_24: midOff, center: centerOff },
    ring_on: { edgeBand0_9: bandOn, center: centerOn },
    center_mean_over_outside: +(centerOn.mean / Math.max(1, outSide.mean)).toFixed(3),
    verdict: {
      edge_keeps_stripes_ratio: +(bandOff.sd / Math.max(0.1, outSide.sd)).toFixed(2),
      center_frosted_ratio: +(centerOff.sd / Math.max(0.1, outSide.sd)).toFixed(2),
    },
  };
  await page.close();
}

/* ══ Q4 基线对照：?gevEdge=0 展开→收缩 的 rect ═══════════════════════════ */
{
  const page = await load('?gevEdge=0');
  const before = await rectOf(page, 'data-panel');
  await toggle(page, 'data-panel'); await sleep(1600);
  const exp = await rectOf(page, 'data-panel');
  await toggle(page, 'data-panel'); await sleep(1800);
  const after = await rectOf(page, 'data-panel');
  res.q4 = { baseline_before: before, baseline_expanded: exp, baseline_after: after };
  await page.close();
}
fs.writeFileSync(`${OUT}/qa-edge-accept2.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
