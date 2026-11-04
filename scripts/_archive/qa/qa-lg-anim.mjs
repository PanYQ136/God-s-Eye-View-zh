#!/usr/bin/env node
/**
 * qa-lg-anim.mjs —— P0-4 动效验收：展开/收起 morph + 兄弟卡收起 + 快速 10 次开合 + 60fps
 * 产出：evidence/lg-glass-shots/p0/anim/ 下 帧序列(jpg) + 报告 json
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5183/';
const tag = process.argv[3] || 'anim';
const CLON = Number(process.argv[4] || 139.7671), CLAT = Number(process.argv[5] || 35.6812), CHGT = Number(process.argv[6] || 40000);
const outDir = `evidence/lg-glass-shots/p0/${tag}`;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(`${outDir}/frames`, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--window-size=1536,730', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const c = w.querySelector('input'); if (c) c.click(); const b = w.querySelector('button'); if (b) b.click(); } });
// 城市纹理背景（便于看折射）
await page.evaluate((lon, lat, hgt) => { try { window.__gevViewer.camera.setView({ destination: window.__CESIUM__.Cartesian3.fromDegrees(lon, lat, hgt), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} }, CLON, CLAT, CHGT);
await new Promise((r) => setTimeout(r, 9000));

/* ── 逐帧采样：单次展开的几何 + 透镜调制 ─────────────────────────────── */
const single = await page.evaluate(async () => {
  const samples = [];
  const t0 = performance.now();
  window.__gevLc.open('data-panel');
  const id = setInterval(() => {
    const a = window.__gevLc.info('data-panel');
    const b = window.__gevLc.info('scene-panel');
    const g = window.__gevGlassAnim;
    samples.push({
      t: Math.round(performance.now() - t0),
      x: a.x, y: a.y, w: a.w, h: a.h,
      sibCollapsed: b.collapsed, sibW: b.w, sibH: b.h,
      lens: g ? +(((performance.now() - g.t0) / g.dur)).toFixed(2) : -1,
      glassFrames: window.__gevGlStats().frames,
      surf: window.__gevGlStats().count,
    });
  }, 16);
  await new Promise((r) => setTimeout(r, 900));
  clearInterval(id);
  return samples;
});
await page.screenshot({ path: `${outDir}/expanded.png` });
const sibDisplay = await page.evaluate(() => {
  const s = document.getElementById('scene-panel');
  const cs = getComputedStyle(s);
  return { display: cs.display, collapsed: s.classList.contains('collapsed'), opacity: cs.opacity, h: Math.round(s.getBoundingClientRect().height) };
});

/* ── 快速开合 10 次（检测拖影/跳位）；每次给足 600ms，避免慢机把「未落定」误判为跳位 ── */
await page.evaluate(() => window.__gevLc.close('data-panel'));
await new Promise((r) => setTimeout(r, 900));
const rapid = await page.evaluate(async () => {
  const jumps = [];
  let prev = null;
  for (let i = 0; i < 10; i++) {
    window.__gevLc.open('data-panel');
    await new Promise((r) => setTimeout(r, 600));
    window.__gevLc.close('data-panel');
    await new Promise((r) => setTimeout(r, 600));
    const cur = window.__gevLc.info('data-panel');
    if (prev && (Math.abs(cur.x - prev.x) > 2 || Math.abs(cur.y - prev.y) > 2 || Math.abs(cur.w - prev.w) > 2 || Math.abs(cur.h - prev.h) > 2)) jumps.push({ i, prev, cur });
    prev = cur;
  }
  return { jumps, finalInfo: prev };
});

/* ── 录屏：CDP screencast，一次展开 + 一次收起 + 连续拖动 ───────────── */
const client = await page.createCDPSession();
let frameNo = 0;
const frameTimes = [];
const onFrame = async ({ data, metadata, sessionId }) => {
  frameNo++;
  frameTimes.push(Date.now());
  fs.writeFileSync(`${outDir}/frames/f${String(frameNo).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'));
  try { await client.send('Page.screencastFrameAck', { sessionId }); } catch (e) {}
};
client.on('Page.screencastFrame', onFrame);
await client.send('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1, maxWidth: 1536, maxHeight: 730 });
const perf = await page.evaluate(async () => {
  const s0 = window.__gevGlStats();
  const f0 = s0.frames, t0 = performance.now();
  window.__gevLc.open('data-panel');
  await new Promise((r) => setTimeout(r, 1400));
  window.__gevLc.close('data-panel');
  await new Promise((r) => setTimeout(r, 1200));
  // 连续拖动地图（Cesium 移动，玻璃必须同步且不掉帧）
  const v = window.__gevViewer;
  for (let i = 0; i < 60; i++) {
    v.camera.moveRight(0.004);
    v.camera.moveUp(0.0015);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const f1 = window.__gevGlStats().frames, t1 = performance.now();
  return { glassFrames: f1 - f0, ms: Math.round(t1 - t0), fps: +(((f1 - f0) * 1000) / (t1 - t0)).toFixed(1), inAppFps: window.__gevGlStats().fps };
});
await new Promise((r) => setTimeout(r, 400));
await client.send('Page.stopScreencast');
await new Promise((r) => setTimeout(r, 600));

const gaps = frameTimes.slice(1).map((t, i) => t - frameTimes[i]);
const capFps = gaps.length ? +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1) : 0;
const perFrameFps = gaps.map((g) => +(1000 / g).toFixed(1));
const report = {
  url, single, sibDisplay, rapid, perf, errors: errs,
  screencast: { frames: frameNo, avgFps: capFps, minInstantFps: Math.min(...perFrameFps.slice(1)), p10: perFrameFps.slice().sort((a, b) => a - b)[Math.floor(perFrameFps.length * 0.1)] },
};
fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({
  sibDisplay, rapidJumps: rapid.jumps.length, perf,
  screencast: report.screencast, errors: errs.length,
  firstSamples: single.slice(0, 8), lastSamples: single.slice(-3),
}));
await browser.close();
