#!/usr/bin/env node
/* Phase4A 验收：① 边框条栅格化 vs 整卡 quad 的像素级 A/B（必须逐字节相同）
                ② 8s 帧率采样（页面 rAF / 折射 pass）
                ③ stats().fps 不再恒 0
   跑法: node scripts/lc/_diag/edge4a-verify.mjs */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const SAMPLE_MS = 8000;
mkdirSync('.gev-logs/lc', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 200)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  const ready = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ready) break;
  await sleep(400);
}
await sleep(12000);

const out = { renderer: null, stats0: null, ab: [], perf: [], errs };

out.stats0 = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { fps: s.fps, drawFps: s.drawFps, p50: s.p50, p95: s.p95, frames: s.frames, count: s.count, tex: s.tex, err: s.err, renderer: s.renderer }; });

/* ── ① 像素 A/B：冻结地图，同一行取样 strips ON vs OFF ─────────────────── */
const rows = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  const pick = (id) => s.surfaces.find((x) => x.id === id);
  const dp = pick('data-panel'), pp = pick('pp-toggles');
  const list = [];
  const add = (id, r, y, x, w) => list.push({ id, y, x, w });
  if (dp) {
    const [x, y, w, h] = dp.rect;
    add('data-panel', dp.rect, y + 3, Math.max(0, x - 2), 140);
    add('data-panel', dp.rect, y + Math.round(h / 2), Math.max(0, x - 4), 34);
    add('data-panel', dp.rect, y + h - 3, Math.max(0, x - 2), 140);
    add('data-panel', dp.rect, y + Math.round(h / 2), Math.max(0, x + w - 30), 34);
  }
  if (pp) {
    const [x, y, w, h] = pp.rect;
    add('pp-toggles', pp.rect, y + 3, Math.max(0, x - 2), 140);
    add('pp-toggles', pp.rect, y + Math.round(h / 2), Math.max(0, x + w - 30), 34);
  }
  return list;
});

async function grab(row) {
  const r = await page.evaluate(async (row) => {
    window.__gevEdgeGrabOut = null;
    window.__gevEdgeGrab = { x: row.x, y: row.y, w: row.w };
    window.__gevEdge.on();                 // 强制重画一帧（清 lastSig）
    const t0 = performance.now();
    while (!window.__gevEdgeGrabOut && performance.now() - t0 < 2500) {
      await new Promise((res) => requestAnimationFrame(res));
    }
    const g = window.__gevEdgeGrabOut;
    window.__gevEdgeGrab = null;
    return g ? (g.row || g) : null;
  }, row);
  return r;
}

await page.evaluate(() => { window.__gevViewer.useDefaultRenderLoop = false; });
await sleep(900);

for (const row of rows) {
  await page.evaluate(() => { window.__gevEdge.set({ strips: false }); });
  await sleep(120);
  const a = await grab(row);
  await page.evaluate(() => { window.__gevEdge.set({ strips: true }); });
  await sleep(120);
  const b = await grab(row);
  const same = JSON.stringify(a) === JSON.stringify(b);
  let diff = 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) diff++;
    }
  }
  out.ab.push({ id: row.id, y: row.y, x: row.x, w: row.w, same, diffPx: diff, len: [a && a.length, b && b.length], sample: (a || []).slice(0, 6) });
  console.log(`AB ${row.id.padEnd(12)} y=${row.y} x=${row.x} w=${row.w} same=${same} diffPx=${diff}`);
}
await page.evaluate(() => { window.__gevEdge.set({ strips: true }); window.__gevViewer.useDefaultRenderLoop = true; });
await sleep(1500);

/* ── ② 8s 帧率采样 ─────────────────────────────────────────────────────── */
async function sample(tag, ms = SAMPLE_MS) {
  const r = await page.evaluate(async (ms) => {
    const e0 = window.__gevEdge.stats();
    const ts = [];
    const t0 = performance.now();
    await new Promise((res) => { const f = (x) => { ts.push(x); if (x - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const g = []; for (let i = 1; i < ts.length; i++) g.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = g.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const avg = g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0;
    const e1 = window.__gevEdge.stats();
    return {
      ms, frames: g.length, avgFps: avg ? +(1000 / avg).toFixed(1) : 0, p50: q(0.5), p95: q(0.95), max: s[s.length - 1],
      edgeFps: e1.fps, edgeDrawFps: e1.drawFps, edgeDrawP50: e1.drawP50, edgeDrawP95: e1.drawP95,
      edgeFrames: e1.frames - e0.frames, edgeSkip: e1.skip - e0.skip, count: e1.count, tex: e1.tex, err: e1.err,
    };
  }, ms);
  console.log(tag.padEnd(14) + JSON.stringify(r));
  return { tag, ...r };
}
out.perf.push(await sample('lens-on#1'));
out.perf.push(await sample('lens-on#2'));
await page.evaluate(() => window.__gevEdge.off());
await sleep(500);
out.perf.push(await sample('lens-off'));
await page.evaluate(() => window.__gevEdge.on());
await sleep(500);
out.perf.push(await sample('lens-on#3'));

/* 截图（只截一块卡角，避免「整页截图」） */
try {
  const clip = await page.evaluate(() => { const s = window.__gevEdge.stats().surfaces[0]; return s ? { x: s.rect[0], y: s.rect[1], width: 120, height: 90 } : null; });
  if (clip) await page.screenshot({ path: '.gev-logs/lc/edge4a-corner.png', clip });
} catch (e) { errs.push('shot: ' + e.message); }

writeFileSync('.gev-logs/lc/edge4a-verify.json', JSON.stringify(out, null, 2));
console.log('ERRS ' + JSON.stringify(errs.slice(0, 8)));
await browser.close();
