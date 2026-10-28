#!/usr/bin/env node
/* qa-t4a03-measure.mjs — t_4a03bd30 验收实测
   用法：node scripts/qa-t4a03-measure.mjs <before|after> <cold|geom|nowebgl|all>
   输出：out-qa/t4a03/<phase>/{*.json,*.png}
*/
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const PHASE = process.argv[2] || 'after';
const MODE = process.argv[3] || 'geom';
const URL = process.argv[4] || 'http://127.0.0.1:4173/';
const OUT = path.resolve(`out-qa/t4a03/${PHASE}`);
fs.mkdirSync(OUT, { recursive: true });
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const EXPANDABLE = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel'];

const ARGS = ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
  '--ignore-gpu-blocklist', '--window-size=1536,760', '--hide-scrollbars'];

async function launch() {
  return puppeteer.launch({ headless: true, executablePath: CHROME, args: ARGS, defaultViewport: null });
}
async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  return { page, errs };
}

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

async function regionStats(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    sr += r; sg += g; sb += b;
    L.push(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
  }
  const n = L.length;
  const mean = L.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  const sorted = L.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    px: n, mean: +mean.toFixed(4), sd: +sd.toFixed(4),
    p50: +q(0.5).toFixed(4), p97: +q(0.97).toFixed(4),
    rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
  };
}
const contrast = (bg, fg) => +(((fg + 0.05) / (bg + 0.05))).toFixed(2);

/* ── 几何工具 ── */
const ov = (a, b) => {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
};
const gap = (a, b) => {
  const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
  const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
  return Math.round(Math.hypot(dx, dy));
};
const rectOf = (o) => ({ left: o.left, top: o.top, right: o.left + o.w, bottom: o.top + o.h });

async function readCards(page) {
  return await page.evaluate((IDS) => {
    const out = {};
    for (const id of IDS) {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[id] = {
        left: Math.round(r.left), top: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
        collapsed: el.classList.contains('collapsed'),
        floating: el.classList.contains('gev-lc-floating'),
        visible: cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.width > 4 && r.height > 4,
        vis: cs.visibility, disp: cs.display, op: cs.opacity,
        lum: el.dataset.gevLum || null,
      };
    }
    return out;
  }, IDS);
}

async function ensureMap(page, waitMs = 13000) {
  await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
  await sleep(waitMs);
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('div,button,a')]
      .find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
    if (x) x.click();
  });
  await sleep(4500);
  await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
  await sleep(800);
}

/* ── 1) 冷启动 fallback 时间线 ── */
async function cold() {
  const browser = await launch();
  const { page, errs } = await newPage(browser);
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const samples = [];
  const shots = [{ t: 400, done: false }, { t: 1000, done: false }, { t: 3000, done: false }, { t: 8000, done: false }];
  let firstGlass = null, firstCards = null, glassShot = false, lastShot = null;
  for (let i = 0; i < 200; i++) {
    const wall = Date.now() - t0;
    const s = await page.evaluate(() => {
      const d = document.getElementById('data-panel');
      const glc = document.getElementById('gev-gl-glass');
      const cs = d ? getComputedStyle(d) : null;
      return {
        wall: performance.now(),
        on: document.documentElement.classList.contains('gev-gl-on'),
        gl: !!glc,
        cards: !!d,
        bg: cs ? cs.backgroundColor : null,
        bf: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
        cls: (d && d.className || '').slice(0, 80),
      };
    });
    samples.push({ wall, ...s });
    if (s.cards && firstCards == null) firstCards = wall;
    if (s.on && firstGlass == null) { firstGlass = wall; }
    for (const sh of shots) {
      if (!sh.done && wall >= sh.t) {
        sh.done = true;
        const p = `${OUT}/cold-${String(sh.t).padStart(4, '0')}ms.png`;
        await page.screenshot({ path: p });
        sh.path = p;
      }
    }
    if (s.on && !glassShot) {
      glassShot = true;
      const p = `${OUT}/cold-glass-on.png`;
      await page.screenshot({ path: p });
      shots.push({ t: -1, done: true, path: p });
    }
    if ((s.on && wall > 4000) || wall > 40000) break;
    await sleep(250);
  }
  if (!glassShot) await page.screenshot({ path: `${OUT}/cold-final.png` });
  const res = {
    phase: PHASE, url: URL, firstCardsMs: firstCards && Math.round(firstCards),
    firstGlassMs: firstGlass && Math.round(firstGlass),
    shots: shots.filter((s) => s.path).map((s) => ({ t: s.t, path: path.basename(s.path) })),
    timeline: samples.filter((s, i) => i === 0 || i % 4 === 0 || s.on).map((s) => ({
      wall: Math.round(s.wall), on: s.on, gl: s.gl, cards: s.cards, bg: s.bg, bf: s.bf,
    })),
    errors: errs.slice(0, 6),
  };
  fs.writeFileSync(`${OUT}/cold.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ firstCardsMs: res.firstCardsMs, firstGlassMs: res.firstGlassMs,
    firstRows: res.timeline.slice(0, 6) }, null, 1));
  await browser.close();
}

/* ── 2) 几何 + 中心透明 + 对比度 + GPU/帧率 ── */
async function geom() {
  const browser = await launch();
  const { page, errs } = await newPage(browser);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ensureMap(page);
  const res = { phase: PHASE, url: URL, errors: errs, cards: {}, expansions: [], gpu: null, contrast: {} };

  /* 全屏截图（默认折叠态） */
  await page.screenshot({ path: `${OUT}/canvas-collapsed.png` });

  /* GPU / renderer / cap */
  res.gpu = await page.evaluate(() => {
    const glInfo = (cv) => {
      if (!cv) return null;
      let gl = null;
      try { gl = cv.getContext('webgl2') || cv.getContext('webgl'); } catch (e) { return null; }
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const attrs = gl.getContextAttributes ? gl.getContextAttributes() : null;
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        powerPreference: attrs ? attrs.powerPreference : null,
        size: [cv.width, cv.height],
      };
    };
    const mapCv = [...document.querySelectorAll('canvas')].filter((c) => c.id !== 'gev-gl-glass')
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const glassCv = document.getElementById('gev-gl-glass');
    const st = window.__gevGlStats ? window.__gevGlStats() : null;
    return {
      map: glInfo(mapCv), glass: glInfo(glassCv),
      glOn: document.documentElement.classList.contains('gev-gl-on'),
      stats: st ? { fps: st.fps, cap: st.fpsCap ?? null, tier: st.capTier ?? null, scale: st.scale, avgMs: st.avgMs } : null,
      glassApi: {
        setCap: typeof window.__gevGlassSetCap,
        renderer: window.__gevGlassRenderer || null,
      },
    };
  });

  /* 帧率门控实测：60 档 vs 30 档（统计 2s 内玻璃实际渲染帧数） */
  const measureFrames = async (tier) => {
    const has = await page.evaluate(() => typeof window.__gevGlassSetCap === 'function');
    if (!has) return null;
    await page.evaluate((t) => window.__gevGlassSetCap(t), tier);
    await sleep(1200);
    const a = await page.evaluate(() => window.__gevGlStats().frames);
    const t0 = Date.now();
    await sleep(3000);
    const b = await page.evaluate(() => window.__gevGlStats().frames);
    const dt = (Date.now() - t0) / 1000;
    return { tier, frames: b - a, fps: +((b - a) / dt).toFixed(1), cap: await page.evaluate(() => window.__gevGlStats().fpsCap) };
  };
  res.gpu.capTest = { t60: await measureFrames('60'), t30: await measureFrames('30'), auto: await measureFrames('auto') };

  /* 中心透明 + 边缘 + 地图参考（卡片 opacity=0 一帧） */
  const measureTransparency = async (tag) => {
    const rects = await readCards(page);
    const shot = await page.screenshot();
    const glass = await page.evaluate((IDS) => {
      const out = {};
      if (!window.__gevGlReadPixel) return out;
      for (const id of IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 8 || b.height < 8) continue;
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const c = window.__gevGlReadPixel(cx, cy);
        const e = window.__gevGlReadPixel(cx, b.top + 3);
        const e2 = window.__gevGlReadPixel(cx, b.top + 9);
        out[id] = { centerAlpha: c ? c[3] : null, edge3pxAlpha: e ? e[3] : null, edge9pxAlpha: e2 ? e2[3] : null };
      }
      return out;
    }, IDS);
    /* 地图参考：临时隐藏所有卡壳（不改布局），同帧截屏后恢复 */
    await page.evaluate(() => {
      const s = document.createElement('style'); s.id = 'qa-hide-cards';
      s.textContent = '.gev-lc{opacity:0 !important;}';
      document.head.appendChild(s);
    });
    await sleep(320);
    const mapShot = await page.screenshot();
    await page.evaluate(() => { const s = document.getElementById('qa-hide-cards'); if (s) s.remove(); });
    await sleep(320);

    const rows = [];
    for (const id of IDS) {
      const r = rects[id];
      if (!r || r.w < 20 || r.h < 20) continue;
      const cx = Math.round(r.left + r.w * 0.32), cy = Math.round(r.top + r.h * 0.36);
      const cw = Math.max(8, Math.round(r.w * 0.36)), ch = Math.max(8, Math.round(r.h * 0.28));
      const clip = { x: cx, y: cy, width: cw, height: ch };
      const ctr = await regionStats(await sharp(shot).extract(clip).png().toBuffer());
      const ref = await regionStats(await sharp(mapShot).extract(clip).png().toBuffer());
      /* 边缘带：紧贴内边 4px 的一圈（卡片内侧） */
      const eClip = { x: Math.round(r.left + 3), y: Math.round(r.top + 3), width: Math.max(6, r.w - 6), height: 6 };
      const edge = await regionStats(await sharp(shot).extract(eClip).png().toBuffer());
      rows.push({
        id, rect: [r.left, r.top, r.w, r.h], lum: r.lum,
        center: ctr, mapRef: ref, edge: { mean: edge.mean, sd: edge.sd },
        retainedDetail: +(ctr.sd / Math.max(1e-6, ref.sd)).toFixed(3),
        deltaLuma: +(ctr.mean - ref.mean).toFixed(4),
        glass: glass[id] || null,
      });
    }
    if (tag) await page.screenshot({ path: `${OUT}/${tag}.png` });
    return rows;
  };
  res.cards.centerTransparency = await measureTransparency('center-collapsed');

  /* 对比度：每卡标题行（像素法 p50/p97） */
  const measureContrast = async (tag) => {
    const rects = await readCards(page);
    const shot = await page.screenshot();
    const rows = [];
    for (const id of IDS) {
      const r = rects[id];
      if (!r || r.w < 40 || r.h < 20) continue;
      const clip = { x: r.left + 6, y: r.top + 6, width: Math.max(10, r.w - 12), height: Math.min(24, Math.max(8, r.h - 12)) };
      const s = await regionStats(await sharp(shot).extract(clip).png().toBuffer());
      rows.push({ id, ratio: contrast(s.p50, s.p97), bg: s.p50, fg: s.p97, sd: s.sd });
    }
    return rows;
  };
  res.contrast.dark = await measureContrast();

  /* ── 展开几何 ── */
  const closeAll = async () => {
    await page.evaluate((IDS) => { IDS.forEach((id) => { try { window.__gevLc.close(id); } catch (e) {} }); }, EXPANDABLE);
    await sleep(700);
  };
  for (const id of EXPANDABLE) {
    await closeAll();
    const before = await readCards(page);
    const opened = await page.evaluate((id) => { window.__gevLc.open(id); return true; }, id);
    await sleep(1100);                       // 等 spring morph 落定（350ms）+ 视口钳制（180ms）
    const after = await readCards(page);
    const self = after[id];
    const selfRect = rectOf(self);
    const hdr = before[id] ? rectOf(before[id]) : null;
    const overlaps = [];
    for (const oid of IDS) {
      if (oid === id) continue;
      const o = after[oid];
      if (!o || !o.visible) continue;
      const a = ov(selfRect, rectOf(o));
      overlaps.push({ id: oid, area: a, rect: [o.left, o.top, o.w, o.h] });
    }
    const hiddenSibs = IDS.filter((oid) => oid !== id && after[oid] && !after[oid].visible)
      .map((oid) => ({ id: oid, vis: after[oid].vis, disp: after[oid].disp }));
    res.expansions.push({
      id, opened,
      collapsedHeader: hdr ? [Math.round(hdr.left), Math.round(hdr.top), Math.round(hdr.right - hdr.left), Math.round(hdr.bottom - hdr.top)] : null,
      expanded: [self.left, self.top, self.w, self.h],
      shift: hdr ? [Math.round(selfRect.left - hdr.left), Math.round(selfRect.top - hdr.top)] : null,
      anchorGap: hdr ? gap(selfRect, hdr) : null,
      overlapTotal: overlaps.reduce((a, b) => a + b.area, 0),
      overlaps: overlaps.filter((o) => o.area > 0),
      hiddenSibs,
      inViewport: self.left >= -1 && self.top >= -1 && self.left + self.w <= 1537 && self.top + self.h <= 731,
    });
    await page.screenshot({ path: `${OUT}/expanded-${id}.png` });
    await page.evaluate((id) => window.__gevLc.close(id), id);
    await sleep(700);
  }
  await closeAll();

  /* 亮场景（盐湖纯白）对比度 + 中心透明 */
  await page.evaluate(() => {
    try {
      window.__gevViewer.useDefaultRenderLoop = true;
      const C = window.Cesium || window.__CESIUM__;
      window.__gevViewer.camera.setView({
        destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
    } catch (e) {}
  });
  await sleep(14000);
  await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
  await sleep(1200);
  res.contrast.bright = await measureContrast();
  res.cards.centerTransparencyBright = await measureTransparency('center-bright');
  res.gpuFinal = await page.evaluate(() => {
    const st = window.__gevGlStats ? window.__gevGlStats() : null;
    return st ? { fps: st.fps, cap: st.fpsCap ?? null, tier: st.capTier ?? null, renderer: window.__gevGlassRenderer || null } : null;
  });

  fs.writeFileSync(`${OUT}/geom.json`, JSON.stringify(res, null, 1));

  /* 控制台摘要 */
  const tbl = res.expansions.map((e) => ({
    id: e.id, expanded: e.expanded, gap: e.anchorGap, overlap: e.overlapTotal,
    hidden: e.hiddenSibs.map((h) => h.id).join(','), inVp: e.inViewport,
  }));
  console.log(JSON.stringify({
    gpu: res.gpu, capTest: res.gpu.capTest,
    contrastDark: res.contrast.dark, contrastBright: res.contrast.bright,
    center: res.cards.centerTransparency.map((c) => ({ id: c.id, centerAlpha: c.glass && c.glass.centerAlpha,
      edge3: c.glass && c.glass.edge3pxAlpha, mean: c.center.mean, mapMean: c.mapRef.mean, retained: c.retainedDetail })),
    expansions: tbl, errors: errs.slice(0, 5),
  }, null, 1));
  await browser.close();
}

/* ── 3) 无 WebGL fallback ── */
async function nowebgl() {
  const browser = await launch();
  const { page, errs } = await newPage(browser);
  await page.evaluateOnNewDocument(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/i.test(String(type))) return null;
      return orig.call(this, type, ...rest);
    };
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(6000);
  const info = await page.evaluate((IDS) => {
    const out = { glOn: document.documentElement.classList.contains('gev-gl-on'),
      glCanvas: !!document.getElementById('gev-gl-glass'), cards: [] };
    for (const id of IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out.cards.push({ id, bg: cs.backgroundColor, bf: cs.backdropFilter || cs.webkitBackdropFilter,
        border: cs.boxShadow.slice(0, 40) });
    }
    out.notice = document.getElementById('gev-gpu-notice') ? document.getElementById('gev-gpu-notice').textContent : null;
    return out;
  }, IDS);
  await page.screenshot({ path: `${OUT}/nowebgl-fallback.png` });
  fs.writeFileSync(`${OUT}/nowebgl.json`, JSON.stringify({ ...info, errors: errs.slice(0, 5) }, null, 1));
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
}

const t0 = Date.now();
if (MODE === 'cold' || MODE === 'all') await cold();
if (MODE === 'geom' || MODE === 'all') await geom();
if (MODE === 'nowebgl' || MODE === 'all') await nowebgl();
console.log(`done ${MODE} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
