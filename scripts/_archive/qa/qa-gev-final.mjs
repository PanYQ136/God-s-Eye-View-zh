#!/usr/bin/env node
/**
 * qa-gev-final.mjs —— t_8cf06356 最终验收
 *  1) 实时地图截图：折叠全页 / 数据卡展开 / 7 卡各自展开 / 3 卡组合
 *  2) 冻结条纹底图（展开态 data-panel 320x380）：
 *     filter 开 vs 关 逐像素差分，按「离卡片边框距离」分桶 → 边缘位移/色散 vs 中心干净
 *  3) 中心透明：卡内 patch 与「纯条纹」帧相关/亮度比
 *  4) 对比度（像素环法）：真实地图 / 纯白底最坏情况
 *  5) 滚动条：页面 scrollWidth、展开卡 scrollWidth=clientWidth、卡内 webkit scrollbar=0、右侧无竖条截图
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'evidence/_collab/t_8cf06356';
fs.mkdirSync(OUT, { recursive: true });
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 条纹底图 */
const SW = 64, SH = 64, pbuf = Buffer.alloc(SW * SH * 3);
const cols = [[235, 55, 55], [55, 225, 90], [70, 95, 240], [245, 245, 245]];
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const c = cols[Math.floor(x / 16) % 4], k = y % 16 === 0 ? 0.45 : 1, i = (y * SW + x) * 3;
  pbuf[i] = c[0] * k; pbuf[i + 1] = c[1] * k; pbuf[i + 2] = c[2] * k;
}
const patB64 = 'data:image/png;base64,' + (await sharp(pbuf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', `--window-size=${W},${H + 90}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500);
await page.keyboard.press('Escape');
await sleep(1500);

const report = { errs, screenshots: {}, material: {}, expand: {}, edge: {}, transparency: {}, contrast: {}, scrollbar: {}, perf: {} };

/* ── 材质 ─────────────────────────────────────────────────────────────── */
report.material = await page.evaluate(() => {
  const el = document.getElementById('data-panel'), cs = getComputedStyle(el);
  const warps = [...document.querySelectorAll('.gev-lg-warp')];
  const w0 = warps[0] && getComputedStyle(warps[0]);
  return {
    gevGlOn: document.documentElement.classList.contains('gev-gl-on'),
    glCanvas: !!document.getElementById('gev-gl-glass'),
    glScript: [...document.scripts].some((s) => (s.src || '').includes('gev-gl-glass')),
    warpCount: warps.length,
    warpFilter: w0 && w0.filter, warpBackdrop: w0 && (w0.backdropFilter || w0.webkitBackdropFilter),
    cardBg: cs.backgroundColor, cardBackdrop: cs.backdropFilter,
    svgFilter: !!document.getElementById('gev-lg-filter'),
    lum: document.documentElement.dataset.gevGlassLum,
  };
});

/* ── 1. 实时地图截图 ─────────────────────────────────────────────────── */
await page.screenshot({ path: path.join(OUT, 'live-collapsed.png') });
report.screenshots.collapsed = 'live-collapsed.png';

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
for (const id of CARDS) {
  await page.evaluate((id) => window.__gevLc.open(id), id);
  await sleep(800);
  const info = await page.evaluate((id) => window.__gevLc.info(id), id);
  await page.screenshot({ path: path.join(OUT, `live-expand-${id}.png`) });
  report.expand[id] = { shot: `live-expand-${id}.png`, ...info };
  await page.evaluate((id) => window.__gevLc.close(id), id);
  await sleep(700);
}

// 数据卡展开的「右侧无滚动条」特写
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(900);
const dRect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.right) - 40, y: Math.round(b.top) - 6, width: 64, height: Math.round(b.height) + 12 }; });
await page.screenshot({ path: path.join(OUT, 'live-data-right-edge.png'), clip: dRect });
await page.screenshot({ path: path.join(OUT, 'live-data-expanded.png') });

/* ── 2/3. 冻结条纹底图（data-panel 仍展开） ─────────────────────────── */
await page.evaluate((b64) => {
  const st = document.createElement('style'); st.id = '__freeze';
  st.textContent = `.cesium-widget,.cesium-widget canvas{visibility:hidden!important}
    .cesium-widget-credits,.cesium-viewer-bottom{display:none!important} video{visibility:hidden!important}
    #__probe_bg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
}, patB64);
await sleep(900);
const cardBox = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });

const shotOn = path.join(OUT, 'frozen2-on.png'); await page.screenshot({ path: shotOn });
await page.evaluate(() => window.__gevLc.nofilter(true));
await sleep(700);
const shotOff = path.join(OUT, 'frozen2-filter-off.png'); await page.screenshot({ path: shotOff });
await page.evaluate(() => window.__gevLc.nofilter(false));
await sleep(500);
await page.evaluate(() => { const s = document.createElement('style'); s.id = '__maponly'; s.textContent = '.gev-lc{background:transparent!important;box-shadow:none!important}.gev-lg-warp{display:none!important}.gev-lc .panel-header,.gev-lc .panel-title,.gev-lc span,.gev-lc i{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(700);
const shotMap = path.join(OUT, 'frozen2-pattern-only.png'); await page.screenshot({ path: shotMap });
await page.evaluate(() => { const s = document.getElementById('__maponly'); if (s) s.remove(); });
await sleep(600);

const rawOf = async (p) => { const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const A = await rawOf(shotOn), B = await rawOf(shotOff), C = await rawOf(shotMap);
const { width: w, channels: ch } = A.info;

// 距离分桶（data-panel 展开卡内部）
const buckets = {};
const put = (k, m, dr, dg, db) => { const b = buckets[k] = buckets[k] || { n: 0, s: 0, max: 0, sr: 0, sg: 0, sb: 0 }; b.n++; b.s += m; b.max = Math.max(b.max, m); b.sr += dr; b.sg += dg; b.sb += db; };
for (let y = cardBox.y; y < cardBox.y + cardBox.h; y++) {
  for (let x = cardBox.x; x < cardBox.x + cardBox.w; x++) {
    const d = Math.min(x - cardBox.x, cardBox.x + cardBox.w - x, y - cardBox.y, cardBox.y + cardBox.h - y);
    const i = (y * w + x) * ch;
    const dr = Math.abs(A.data[i] - B.data[i]), dg = Math.abs(A.data[i + 1] - B.data[i + 1]), db = Math.abs(A.data[i + 2] - B.data[i + 2]);
    const m = Math.max(dr, dg, db);
    const k = d <= 1 ? '1) 边框 0-1px' : d <= 3 ? '2) 边框 2-3px' : d <= 8 ? '3) 边框 4-8px' : d <= 30 ? '4) 边框 9-30px' : '5) 中心 >30px';
    put(k, m, dr, dg, db);
  }
}
for (const k of Object.keys(buckets).sort()) {
  const b = buckets[k];
  report.edge[k] = { px: b.n, meanMaxChannelDiff: +(b.s / b.n).toFixed(2), maxDiff: b.max, meanAbsDr: +(b.sr / b.n).toFixed(2), meanAbsDg: +(b.sg / b.n).toFixed(2), meanAbsDb: +(b.sb / b.n).toFixed(2) };
}

// 中心透明（卡内 patch vs 纯条纹）
function corr(x0, y0, ww, hh) {
  const lum = (b, i) => 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) {
    const i = (y * w + x) * ch, a = lum(A.data, i), b = lum(C.data, i);
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  const ma = sa / n, mb = sb / n, va = saa / n - ma * ma, vb = sbb / n - mb * mb;
  return { meanCard: +ma.toFixed(1), meanPattern: +mb.toFixed(1), ratio: +(ma / Math.max(1, mb)).toFixed(3), corr: +((sab / n - ma * mb) / Math.sqrt(Math.max(1e-6, va * vb))).toFixed(3), sdCard: +Math.sqrt(Math.max(0, va)).toFixed(1), sdPattern: +Math.sqrt(Math.max(0, vb)).toFixed(1) };
}
report.transparency['data-panel 展开卡中心(纯条纹底)'] = corr(cardBox.x + 60, cardBox.y + 150, 120, 60);
report.transparency['data-panel 展开卡边缘带(纯条纹底)'] = corr(cardBox.x + 6, cardBox.y + 150, 10, 60);

// 清掉冻结层
await page.evaluate(() => { const f = document.getElementById('__freeze'); if (f) f.remove(); const b = document.getElementById('__probe_bg'); if (b) b.remove(); });
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(900);

/* ── 4. 对比度（像素环法） ───────────────────────────────────────────── */
const TARGETS = [
  ['data-panel', '.panel-title'], ['scene-panel', '.panel-title'], ['pp-toggles', '.pp-header-label'],
  ['cctv-panel', '.panel-title'], ['global-context-panel', '.panel-title'],
  ['location-bar', '.dock-tray-toggle, .location-pill, .panel-title'], ['control-panel', '.dock-tray-toggle, .location-pill, .panel-title'],
];
async function contrastLab(tag) {
  const rows = [];
  for (const [cardId, sel] of TARGETS) {
    const box = await page.evaluate(([cardId, sel]) => {
      const card = document.getElementById(cardId); if (!card) return null;
      const el = card.querySelector(sel); if (!el) return null;
      const t = el.getBoundingClientRect(), c = card.getBoundingClientRect();
      if (t.width < 8 || t.height < 6) return null;
      // 底样：标题右侧的卡内空白（离字形 8px 以上），不够就往标题下方取
      let bg = { x: Math.round(t.right + 8), y: Math.round(t.top), width: 36, height: Math.max(6, Math.round(t.height)) };
      if (bg.x + bg.width > c.right - 4) bg = { x: Math.round(c.left + 8), y: Math.round(t.bottom + 4), width: Math.min(60, Math.round(c.width - 16)), height: 8 };
      bg.x = Math.max(Math.round(c.left + 4), bg.x); bg.y = Math.max(Math.round(c.top + 2), bg.y);
      return {
        text: { x: Math.floor(t.left), y: Math.floor(t.top), width: Math.ceil(t.width), height: Math.ceil(t.height), label: (el.textContent || '').trim().slice(0, 10) },
        bg,
      };
    }, [cardId, sel]);
    if (!box) { rows.push({ card: cardId, skip: true }); continue; }
    const lumStats = async (clip) => {
      const buf = await page.screenshot({ clip });
      const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      const L = [];
      for (let i = 0; i < info.width * info.height; i++) { const p = i * info.channels; L.push(0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]); }
      L.sort((a, b) => a - b);
      return L;
    };
    const tl = await lumStats(box.text);
    const bl = await lumStats(box.bg);
    const fg = tl[Math.floor(tl.length * 0.95)];                 // 字形亮端
    const bgL = bl[Math.floor(bl.length * 0.5)];                 // 局部底中位数
    const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const ratio = (Math.max(srgb(fg), srgb(bgL)) + 0.05) / (Math.min(srgb(fg), srgb(bgL)) + 0.05);
    rows.push({ card: cardId, text: box.text.label, fg: Math.round(fg), bg: Math.round(bgL), contrast: +ratio.toFixed(2) });
  }
  return { tag, rows };
}
report.contrast.onMap = await contrastLab('真实地图(默认 0.52 档)');

await page.evaluate(() => {
  const st = document.createElement('style'); st.id = '__white';
  st.textContent = `.cesium-widget,.cesium-widget canvas{visibility:hidden!important}#__white_bg{position:fixed;inset:0;z-index:0;background:#fff}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__white_bg'; document.body.appendChild(d);
});
await sleep(800);
report.contrast.onWhite = await contrastLab('纯白底 默认0.52 档(最坏)');
await page.evaluate(() => { document.documentElement.dataset.gevGlassLum = 'bright'; });
await sleep(400);
report.contrast.onWhiteBright = await contrastLab('纯白底 bright0.62 档');
await page.screenshot({ path: path.join(OUT, 'live-white-bg-bright.png') });
report.contrast.lumAttrOnWhite = await page.evaluate(() => document.documentElement.dataset.gevGlassLum || null);
await page.evaluate(() => { const s = document.getElementById('__white'); if (s) s.remove(); const b = document.getElementById('__white_bg'); if (b) b.remove(); });
await sleep(700);

/* ── 5. 滚动条（数据卡展开态） ───────────────────────────────────────── */
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(900);
report.scrollbar = await page.evaluate(() => {
  const card = document.getElementById('data-panel');
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.appendChild(probe);
  const sbPx = probe.offsetWidth - probe.clientWidth;
  const list = card.querySelector('.data-toggle-list');
  const res = {
    pageScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    classicScrollbarPx: sbPx,
    cardScrollWidth: card.scrollWidth, cardClientWidth: card.clientWidth, cardScrollable: card.scrollHeight > card.clientHeight,
    listSbWidth: list ? getComputedStyle(list, '::-webkit-scrollbar').width : null,
    listScrollbarWidthProp: list ? getComputedStyle(list).scrollbarWidth : null,
    cardScrollbarWidthProp: getComputedStyle(card).scrollbarWidth,
  };
  probe.remove();
  return res;
});
// 滚轮仍可滚（展开卡）
const before = await page.evaluate(() => document.getElementById('data-panel').scrollTop);
await page.mouse.move(200, 300);
await page.mouse.wheel({ deltaY: 300 });
await sleep(400);
const after = await page.evaluate(() => document.getElementById('data-panel').scrollTop);
report.scrollbar.wheelWorks = { before, after, moved: after !== before };
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(800);

/* ── 6. 性能：空闲 FPS + 展开/收起动画帧时长 ────────────────────────── */
report.perf = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const idle = [];
  for (let i = 0; i < 90; i++) { const t = performance.now(); await raf(); idle.push(performance.now() - t); }
  idle.sort((a, b) => a - b);
  const anim = [];
  const el = document.getElementById('data-panel');
  const t0 = performance.now();
  window.__gevLc.open('data-panel');
  while (performance.now() - t0 < 500) { const t = performance.now(); await raf(); anim.push(performance.now() - t); }
  window.__gevLc.close('data-panel');
  anim.sort((a, b) => a - b);
  return {
    idleFrames: idle.length, idleMedianMs: +idle[Math.floor(idle.length / 2)].toFixed(2), idleP95Ms: +idle[Math.floor(idle.length * 0.95)].toFixed(2),
    animFrames: anim.length, animMedianMs: +anim[Math.floor(anim.length / 2)].toFixed(2), animP95Ms: +anim[Math.floor(anim.length * 0.95)].toFixed(2),
    longFramesOver33: anim.filter((x) => x > 33).length,
  };
});

/* ── 7. 3 卡组合总览图 + 真 SVG 折射模式对照图 ──────────────────────── */
for (const id of ['data-panel', 'pp-toggles', 'location-bar']) { await page.evaluate((id) => window.__gevLc.open(id), id); await sleep(600); }
await page.screenshot({ path: path.join(OUT, 'live-combo3.png') });
for (const id of ['data-panel', 'pp-toggles', 'location-bar']) { await page.evaluate((id) => window.__gevLc.close(id), id); await sleep(500); }

// 真 SVG 位移折射模式（gev-lens-svg）：截图 + 同机帧时长，供用户选择
await page.evaluate(() => window.__gevLc.lensSvg(true));
await sleep(1200);
await page.screenshot({ path: path.join(OUT, 'mode-lens-svg-collapsed.png') });
report.svgMode = await page.evaluate(async () => {
  const t = [];
  for (let i = 0; i < 40; i++) { const a = performance.now(); await new Promise((r) => requestAnimationFrame(r)); t.push(performance.now() - a); }
  t.sort((x, y) => x - y);
  return { filter: getComputedStyle(document.querySelector('.gev-lg-warp')).filter, rimHidden: getComputedStyle(document.querySelector('.gev-lg-rim')).display, medianMs: +t[Math.floor(t.length / 2)].toFixed(1) };
});
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(1200);
await page.screenshot({ path: path.join(OUT, 'mode-lens-svg-data-expanded.png') });
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(600);
await page.evaluate(() => window.__gevLc.lensSvg(false));
await sleep(1500);
// 收尾清态复测（此时无任何测试样式残留）
report.perfClean = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const t = [];
  for (let i = 0; i < 120; i++) { const a = performance.now(); await raf(); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  const w = document.querySelector('.gev-lg-warp');
  const probe = document.getElementById('__probe_bg') || document.getElementById('__gbg') || document.getElementById('__white_bg');
  return {
    htmlClass: document.documentElement.className,
    warpFilter: getComputedStyle(w).filter, rimDisplay: getComputedStyle(document.querySelector('.gev-lg-rim')).display,
    leftoverProbes: !!probe,
    medianMs: +t[Math.floor(t.length / 2)].toFixed(2), p95Ms: +t[Math.floor(t.length * 0.95)].toFixed(2),
    framesOver20: t.filter((x) => x > 20).length,
  };
});

fs.writeFileSync(path.join(OUT, 'final-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
