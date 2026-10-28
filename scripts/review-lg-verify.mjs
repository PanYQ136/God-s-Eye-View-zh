#!/usr/bin/env node
/**
 * review-lg-verify.mjs —— 独立复核脚本（reviewer 视角，不复用 implementer 的 qa-* 脚本）
 * 目标：用与实现者不同的度量方法验证规范 §5 关键项
 *  1) 折射带：以「gain=0 vs gain=0.9」隔离纯折射，按到边距离做差分剖面（实现者用的是 refr on/off + 全图）
 *  2) 白色 rim：以「玻璃开 vs 玻璃关」求逐像素增量，检查带内是否出现中性白增量（map 干扰被抵消）
 *  3) 色散：以「8 样本 vs eta 恒定」差分，检查带内是否分通道互异
 *  4) 展开/收起：兄弟卡是否 collapsed(header) 而非 display:none；raf FPS
 *  5) 控制台错误 / 玻璃面数量 / 截图供人工判读
 * 用法: node scripts/review-lg-verify.mjs <url> <outDir>
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = process.argv[3] || 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });

const res = { url, out: OUT, t: new Date().toISOString(), errors: [], tests: {} };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => res.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') res.errors.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape').catch(() => {});
await new Promise((r) => setTimeout(r, 800));
const cam = await page.evaluate(() => {
  try {
    const v = window.__gevViewer || window.viewer;
    if (v && v.camera && window.Cesium) {
      v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1600), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
      return true;
    }
  } catch (e) { return 'err:' + e.message; }
  return false;
});
res.tests.cameraSet = cam;

for (let i = 0; i < 20; i++) {
  const ok = await page.evaluate(() => !!(window.__gevGlStats && window.__gevGlStats().count >= 9 && window.__gevGlStats().fps > 0));
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1200));
}
await new Promise((r) => setTimeout(r, 3000));

/* ---------- 基础状态 ---------- */
res.stats = await page.evaluate(() => (window.__gevGlStats ? window.__gevGlStats() : null));
res.lcInfo = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const o = {};
  ids.forEach((id) => { o[id] = window.__gevLc ? window.__gevLc.info(id) : null; });
  return o;
});

/* ---------- 工具：截 clip 并取 raw ---------- */
async function grab(x, y, w, h, tag) {
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h }, captureBeyondViewport: false });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/* 选一张卡片做边缘剖面：用 collapsed 的 data-panel（小、边缘干净） */
const card = (res.stats.surfaces || []).find((s) => s.id === 'data-panel');
if (!card) { res.tests.fatal = 'no data-panel surface in stats'; }
res.card = card || null;

const DSF = 2;
const bandTest = async () => {
  const r = card.rect; // css px
  const x0 = Math.max(0, Math.round(r[0] - 14));
  const y0 = Math.round(r[1] + 4);
  const w = 46;
  const h = Math.max(8, Math.round(r[3] - 8));
  const edgeCol = Math.round(r[0]) - x0; // 卡片左边在 clip 内的列

  const on = await grab(x0, y0, w, h, 'band-glass-on');
  await page.evaluate(() => window.__gevGlSet({ gain: 0 }));
  await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2))).catch(() => {});
  await new Promise((r3) => setTimeout(r3, 350));
  const gain0 = await grab(x0, y0, w, h, 'band-gain0');
  await page.evaluate(() => window.__gevGlSet({ gain: 0.9 }));
  await new Promise((r4) => setTimeout(r4, 350));

  const off = await page.evaluate(() => {
    const c = document.getElementById('gev-gl-glass');
    c.dataset.prevVis = c.style.visibility;
    c.style.visibility = 'hidden';
    return true;
  });
  await new Promise((r5) => setTimeout(r5, 350));
  const noGlass = await grab(x0, y0, w, h, 'band-glass-off');
  await page.evaluate(() => {
    const c = document.getElementById('gev-gl-glass');
    c.style.visibility = c.dataset.prevVis || '';
  });
  await new Promise((r6) => setTimeout(r6, 350));

  // 逐列（CSS px）统计：折射差分(on vs gain0) / 白 rim 增量(on vs off)
  const cols = [];
  for (let cx = 0; cx < w; cx++) {
    let refr = 0, refrN = 0, dR = 0, dG = 0, dB = 0, dlum = 0, dmax = 0;
    for (let px = 0; px < DSF; px++) {
      const sx = cx * DSF + px;
      if (sx >= on.w) continue;
      for (let y = 0; y < h * DSF; y++) {
        const i = (y * on.w + sx) * on.ch;
        const a = [on.data[i], on.data[i + 1], on.data[i + 2]];
        const b = [gain0.data[i], gain0.data[i + 1], gain0.data[i + 2]];
        const c2 = [noGlass.data[i], noGlass.data[i + 1], noGlass.data[i + 2]];
        refr += Math.abs(luma(a, 0) - luma(b, 0)); refrN++;
        const p = [a[0] - c2[0], a[1] - c2[1], a[2] - c2[2]];
        dR += p[0]; dG += p[1]; dB += p[2];
        dlum += (p[0] + p[1] + p[2]) / 3;
        const m = Math.max(p[0], p[1], p[2]);
        if (m > dmax) dmax = m;
      }
    }
    cols.push({
      d: cx - edgeCol,
      refr: +(refr / Math.max(1, refrN)).toFixed(2),
      dR: +(dR / Math.max(1, refrN)).toFixed(2),
      dG: +(dG / Math.max(1, refrN)).toFixed(2),
      dB: +(dB / Math.max(1, refrN)).toFixed(2),
      dlum: +(dlum / Math.max(1, refrN)).toFixed(2),
      dmax: dmax,
    });
  }
  return { clip: [x0, y0, w, h], edgeCol, cols };
};
if (card) res.tests.band = await bandTest();

/* ---------- 色散：8 样本 vs eta 恒定 ---------- */
const dispTest = async () => {
  const r = card.rect;
  const x0 = Math.max(0, Math.round(r[0] - 14)), y0 = Math.round(r[1] + 4);
  const w = 46, h = Math.max(8, Math.round(r[3] - 8));
  const edgeCol = Math.round(r[0]) - x0;
  const a = await grab(x0, y0, w, h, 'disp-on');
  await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
  await new Promise((r2) => setTimeout(r2, 400));
  const b = await grab(x0, y0, w, h, 'disp-off');
  await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
  await new Promise((r3) => setTimeout(r3, 400));
  const out = { byD: [] };
  for (let cx = 0; cx < w; cx++) {
    let dR = 0, dG = 0, dB = 0, n = 0;
    for (let px = 0; px < DSF; px++) {
      const sx = cx * DSF + px; if (sx >= a.w) continue;
      for (let y = 0; y < h * DSF; y++) {
        const i = (y * a.w + sx) * a.ch;
        dR += Math.abs(a.data[i] - b.data[i]);
        dG += Math.abs(a.data[i + 1] - b.data[i + 1]);
        dB += Math.abs(a.data[i + 2] - b.data[i + 2]);
        n++;
      }
    }
    if (n) out.byD.push({ d: cx - edgeCol, R: +(dR / n).toFixed(2), G: +(dG / n).toFixed(2), B: +(dB / n).toFixed(2) });
  }
  return out;
};
if (card) res.tests.dispersion = await dispTest();

/* ---------- 展开：兄弟卡状态 + fps ---------- */
const fpsIdle = await page.evaluate(() => new Promise((done) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else done({ fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1) }); };
  requestAnimationFrame(tick);
}));
res.tests.fpsIdle = fpsIdle;

const openRes = await page.evaluate(() => new Promise((done) => {
  const sib = document.getElementById('scene-panel');
  const before = sib ? { collapsed: sib.classList.contains('collapsed'), h: Math.round(sib.getBoundingClientRect().height) } : null;
  let n = 0; const t0 = performance.now();
  try { window.__gevLc.open('data-panel'); } catch (e) { /* noop */ }
  const tick = () => {
    n++;
    if (performance.now() - t0 < 900) requestAnimationFrame(tick);
    else {
      const cs = sib ? getComputedStyle(sib) : null;
      done({
        fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1),
        sibBefore: before,
        sibAfter: sib ? { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, collapsed: sib.classList.contains('collapsed'), h: Math.round(sib.getBoundingClientRect().height) } : null,
        info: window.__gevLc.info('data-panel'),
      });
    }
  };
  requestAnimationFrame(tick);
}));
res.tests.openAnim = openRes;
res.shotExpanded = path.join(OUT, 'expanded-full.png');
await page.screenshot({ path: res.shotExpanded });
const expRect = openRes.info;
if (expRect) {
  const clip = { x: Math.max(0, expRect.x - 6), y: Math.max(0, expRect.y - 6), width: Math.min(1536 - Math.max(0, expRect.x - 6), 260), height: Math.min(730 - Math.max(0, expRect.y - 6), 180) };
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, 'expanded-corner.png'), buf);
  await sharp(buf).resize({ width: clip.width * 3, kernel: 'nearest' }).png().toFile(path.join(OUT, 'expanded-corner-3x.png'));
}
await page.evaluate(() => { try { window.__gevLc.close('data-panel'); } catch (e) {} });
await new Promise((r) => setTimeout(r, 700));

/* ---------- 全图 + 放大截图（人工判读） ---------- */
res.shotFull = path.join(OUT, 'full-1536.png');
await page.screenshot({ path: res.shotFull });
if (card) {
  const fx = Math.max(0, card.rect[0] - 10), fy = Math.max(0, card.rect[1] - 10);
  const clip = { x: fx, y: fy, width: Math.min(1536 - fx, card.rect[2] + 20), height: Math.min(730 - fy, card.rect[3] + 20) };
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, 'card-zoom.png'), buf);
  await sharp(buf).resize({ width: clip.width * 4, kernel: 'nearest' }).png().toFile(path.join(OUT, 'card-zoom-4x.png'));
  res.cardClip = clip;
}
const fab = (res.stats.surfaces || []).find((s) => s.id === 'gev-gfx-fab');
if (fab) {
  const fx = Math.max(0, fab.rect[0] - 12), fy = Math.max(0, fab.rect[1] - 12);
  const clip = { x: fx, y: fy, width: Math.min(1536 - fx, fab.rect[2] + 24), height: Math.min(730 - fy, fab.rect[3] + 24) };
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, 'fab-zoom.png'), buf);
  await sharp(buf).resize({ width: clip.width * 6, kernel: 'nearest' }).png().toFile(path.join(OUT, 'fab-zoom-6x.png'));
  res.fabClip = clip;
}

res.gl = await page.evaluate(() => {
  const c = document.getElementById('gev-gl-glass');
  if (!c) return null;
  const gl = c.getContext('webgl2');
  return {
    canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight],
    renderer: gl ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL || gl.RENDERER) : null,
    contextLost: gl ? gl.isContextLost() : null,
  };
});

fs.writeFileSync(path.join(OUT, 'review-verify.json'), JSON.stringify(res, null, 1));
console.log('WROTE', path.join(OUT, 'review-verify.json'));
console.log(JSON.stringify({
  stats: res.stats && { fps: res.stats.fps, count: res.stats.count, scale: res.stats.scale },
  errors: res.errors.slice(0, 6), nErr: res.errors.length,
  fpsIdle: res.tests.fpsIdle, open: res.tests.openAnim,
  gl: res.gl,
  band: res.tests.band && res.tests.band.cols.filter((c) => c.d >= -2 && c.d <= 20),
}, null, 1));
await browser.close();
