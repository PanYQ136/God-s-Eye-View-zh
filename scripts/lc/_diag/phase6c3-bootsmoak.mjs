#!/usr/bin/env node
/* Phase6C3-B 冷启动就绪门冒烟：只看 __gevBoot 状态机是否按预期推进，
   不做像素断言（那是 phase6c2-gate 的事）。
   用法: node scripts/lc/_diag/phase6c3-bootsmoak.mjs [tag] */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 's1';
const OUT = '.gev-logs/lc/phase6c3';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });

const t0 = Date.now();
const line = [];
let snap = null;
for (let i = 0; i < 120; i++) {
  snap = await page.evaluate(() => {
    const b = window.__gevBoot;
    const el = document.getElementById('loading-screen');
    const op = el ? parseFloat(getComputedStyle(el).opacity) : null;
    const cine = window.__gevCine || {};
    const v = window.__gevViewer;
    let tiles = null;
    try {
      const prims = v && v.scene && v.scene.primitives;
      for (let k = 0; prims && k < prims.length; k++) {
        const p = prims.get(k);
        if (p && p.initialTilesLoaded && typeof p.tilesLoaded === 'boolean') tiles = !!p.tilesLoaded;
      }
    } catch (e) {}
    return {
      t: Math.round(performance.now()),
      bg: b ? { state: b.state, reason: b.reason } : null,
      ready: !!(window.__lc && window.__lc.api && window.__lc.api.ready),
      mounted: !!(window.__lc && window.__lc.api && window.__lc.api.mounted),
      maskOp: op == null ? null : +op.toFixed(2),
      cine: cine.stage || null, cineDone: !!cine.done,
      tiles,
    };
  }).catch(() => null);
  line.push(snap);
  if (snap && snap.ready) break;
  await sleep(250);
}
await sleep(100);
/* 进入后 8s 逐帧采样（这是 lead 要求 #5 的口径）*/
const post = await page.evaluate(async (ms) => {
  const t0 = performance.now();
  const ft = [];
  let last = t0;
  let worst = 0;
  await new Promise((res) => {
    const tick = (ts) => {
      const dt = ts - last;
      last = ts;
      if (dt > 0) {
        ft.push(+dt.toFixed(1));
        if (dt > worst) worst = dt;
      }
      if (ts - t0 < ms) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  const s = ft.slice().sort((a, b) => a - b);
  return {
    frames: ft.length,
    fps: +(1000 / s[Math.floor(s.length * 0.5)]).toFixed(1),
    p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
    worst: +worst.toFixed(1),
    over100: ft.filter((v) => v > 100).length,
    over60: ft.filter((v) => v > 60).length,
    over33: ft.filter((v) => v > 33.4).length,
    top: ft.map((v, i) => [i, v]).filter((x) => x[1] > 40).slice(0, 12),
  };
}, 8000);
console.log('--- 进入后 8s ---');
console.log(JSON.stringify(post));
await sleep(2000);
const final = await page.evaluate(() => (window.__gevBoot ? window.__gevBoot.snapshot() : null));
const lf = (final && final.longFrames) || [];
console.log('--- 状态推进（每 250ms 采样，只打变化点）---');
let prev = '';
for (const s of line) {
  if (!s) continue;
  const key = JSON.stringify([s.bg && s.bg.state, s.bg && s.bg.reason, s.ready, s.maskOp, s.cine, s.tiles]);
  if (key === prev) continue;
  prev = key;
  console.log(s.t, 'state=' + (s.bg ? s.bg.state : '-'), 'reason=' + (s.bg ? s.bg.reason : '-'),
    'ready=' + s.ready, 'mounted=' + s.mounted, 'maskOp=' + s.maskOp, 'cine=' + s.cine + (s.cineDone ? '(done)' : ''), 'tilesLoaded=' + s.tiles);
}
console.log('--- snapshot ---');
console.log(JSON.stringify({ ...final, longFrames: undefined }, null, 1));
console.log('--- longFrames>100 ---');
const big = lf.filter((f) => f.dt > 100);
console.log('n>100 =', big.length);
for (const f of big.slice(0, 30)) console.log(' ', f.at, f.dt, 'maskOp', f.maskOp);
console.log('longFrames total', lf.length, 'worst', Math.max(0, ...lf.map((f) => f.dt)));
console.log('visibleLong', lf.filter((f) => f.dt > 100 && f.maskOp < 0.95).length);
console.log('errs', JSON.stringify(errs.slice(0, 6)));
writeFileSync(`${OUT}/bootsmoke-${TAG}.json`, JSON.stringify({ line, final, errs }, null, 1));
await browser.close();
