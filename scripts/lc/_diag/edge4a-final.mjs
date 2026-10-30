#!/usr/bin/env node
/* Phase4A 最终验收：真实浏览器 + 硬件 GPU
   ① 8s 帧率采样（初始 9 面 / 真点击展开 1 卡 / 开卡后）
   ② __gevEdge.stats() 接线：fps 非 0、tex 走 GPU 路径、9 面齐、参数未降级
   ③ 真实鼠标拖地图 + 真实点击（无 element.click 旁路）
   ④ 卡角特写截图（只截变化区域，不整页）
   跑法: node scripts/lc/_diag/edge4a-final.mjs */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
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
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240; i++) {
  const ready = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ready) break;
  await sleep(400);
}
await sleep(6000);

async function sample(tag, ms = 8000) {
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
      over20ms: g.filter((x) => x > 20).length,
      edgeFps: e1.fps, edgeP95: e1.p95, edgeDrawFps: e1.drawFps, edgeFrames: e1.frames - e0.frames, count: e1.count, tex: e1.tex,
      band: e1.band, dispPx: e1.dispPx, gain: e1.gain, ior: e1.ior, scale: e1.scale, canvas: e1.canvas, err: e1.err,
    };
  }, ms);
  console.log(tag.padEnd(18) + JSON.stringify(r));
  return { tag, ...r };
}

const rows = [];
rows.push(await sample('初始9面'));
rows.push(await sample('初始9面#2'));

/* 真实点击：点 data-panel 标题命中面（不是 element.click） */
const rect = await page.evaluate(() => {
  const e = document.querySelector('#data-panel .panel-header') || document.getElementById('data-panel');
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x + r.width * 0.5), y: Math.round(r.y + r.height * 0.5) };
});
const rtt = [];
for (let i = 0; i < 3; i++) { const a = Date.now(); await page.evaluate(() => 1 + 1); rtt.push(Date.now() - a); await sleep(120); }
await page.mouse.move(rect.x, rect.y);
await page.mouse.down(); await sleep(60); await page.mouse.up();
await sleep(1200);
const opened = await page.evaluate(() => {
  const e = document.getElementById('data-panel');
  const r = e.getBoundingClientRect();
  return { phase: e.dataset.lcPhase, collapsed: e.classList.contains('collapsed'), rect: [Math.round(r.width), Math.round(r.height)], surfaces: window.__gevEdge.stats().count };
});
console.log('CLICK ' + JSON.stringify({ rect, evalRttMs: rtt, opened }));
rows.push(await sample('展开1卡'));
rows.push(await sample('展开1卡#2'));

/* 真实滚轮/拖地图：相机运动 → postRender 驱动折射 pass */
const before = await page.evaluate(() => window.__gevEdge.stats().frames);
await page.mouse.move(W * 0.5, H * 0.62);
await page.mouse.down();
for (let i = 0; i < 30; i++) { await page.mouse.move(W * 0.5 + Math.sin(i / 3) * 260, H * 0.62 + Math.cos(i / 4) * 90); await sleep(16); }
await page.mouse.up();
await sleep(400);
const dragInfo = await page.evaluate((b) => ({ drawsDuringDrag: window.__gevEdge.stats().frames - b, fps: window.__gevEdge.stats().fps, tex: window.__gevEdge.stats().tex }), before);
console.log('DRAG ' + JSON.stringify(dragInfo));

/* 卡角特写（只截变化区域） */
try {
  const clip = await page.evaluate(() => {
    const s = window.__gevEdge.stats().surfaces.find((x) => x.id === 'data-panel');
    if (!s) return null;
    return { x: Math.max(0, s.rect[0] - 4), y: Math.max(0, s.rect[1] - 4), width: 140, height: 110 };
  });
  if (clip) await page.screenshot({ path: '.gev-logs/lc/edge4a-final-corner.png', clip });
  console.log('SHOT .gev-logs/lc/edge4a-final-corner.png');
} catch (e) { errs.push('shot ' + e.message); }

writeFileSync('.gev-logs/lc/edge4a-final.json', JSON.stringify({ rows, opened, dragInfo, errs }, null, 2));
console.log('ERRS ' + JSON.stringify(errs.slice(0, 6)));
await browser.close();
