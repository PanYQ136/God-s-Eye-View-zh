#!/usr/bin/env node
/* Phase7A-D · 冷启动验收（lead 决策 A+D 口径）
   ---------------------------------------------------------------------------
   判据（每跑一组，全部来自页内真实状态 + 真实鼠标事件）：
     1. cardsClickable = __bootTimeline mark 'mask:input-released'（遮罩放行输入）
        + 一次 CDP 真实 pointerdown/up 让卡片 mini → opening
     2. B5 = gate 'mask:gone'（遮罩视觉消失）时中心 640×420 截图 std ≥18 / uniq ≥800
     3. photoreal = __gevPhotoreal.ready && globe.show === false
     4. 交互后 0–10s 帧率 / 单帧 >100ms
   环境：全新 profile + clearBrowserCache，Chrome headed，RTX 3060。
   用法: node scripts/lc/phase7a-d-cold.mjs <tag> [runs] [base]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7ad';
const RUNS = Number(process.argv[3] || 3);
const BASE = process.argv[4] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7a';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1);
};

const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const runs = [];

for (let i = 1; i <= RUNS; i++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-`));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile,
    args: [
      '--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
      '--ignore-gpu-blocklist', '--force_high_performance_gpu',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
    ],
    protocolTimeout: 300000,
    defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)); });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  const wall0 = Date.now();
  await page.goto(`${BASE}&run=${i}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

  /* 1) 等遮罩放行输入（= 卡片可点） */
  let releasedWall = null;
  for (let k = 0; k < 2500; k++) {
    const v = await page.evaluate(() => {
      const g = window.__gevBoot;
      return !!(g && g.inputReleased);
    }).catch(() => false);
    if (v) { releasedWall = Date.now() - wall0; break; }
    await sleep(20);
  }

  /* 2) 真实鼠标点击一张卡：mini → opening/open */
  let click = null;
  if (releasedWall != null) {
    const hit = await page.evaluate((ids) => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.2) continue;
        const h = (el.querySelector('.panel-header, header, .lc-head') || el).getBoundingClientRect();
        if (h.width < 20 || h.height < 8) continue;
        return { id, x: Math.round(h.left + h.width / 2), y: Math.round(h.top + h.height / 2) };
      }
      return null;
    }, CARD_IDS).catch(() => null);
    if (hit) {
      const before = await page.evaluate((id) => window.__lc?.api?.phases()?.[id] ?? null, hit.id);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
      let after = null;
      for (let k = 0; k < 60; k++) {
        after = await page.evaluate((id) => window.__lc?.api?.phases()?.[id] ?? null, hit.id);
        if (after && after !== before) break;
        await sleep(50);
      }
      click = { id: hit.id, before, after, clickWall: Date.now() - wall0, ok: before !== after };
    }
  }

  /* 3) 等遮罩视觉消失（B5）→ 该时刻中心 640×420 取证 */
  let revealWall = null;
  for (let k = 0; k < 3000; k++) {
    const v = await page.evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      return !!(g && g.interactive) || (Number.isFinite(op) && op < 0.05);
    }).catch(() => false);
    if (v) { revealWall = Date.now() - wall0; break; }
    await sleep(20);
  }
  await sleep(100);
  const png = await page.screenshot({ encoding: 'base64' }).catch(() => null);
  if (png) writeFileSync(join(OUT, `${TAG}-${i}-reveal.png`), Buffer.from(png, 'base64'));
  const b5 = png ? await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
    const x = Math.max(0, Math.round((bmp.width - w) / 2)), y = Math.max(0, Math.round((bmp.height - h) / 2));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
    for (let p = 0; p < d.length; p += 4) {
      const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
      sum += l; sum2 += l * l; n += 1; uniq.add((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
    }
    const mean = sum / n;
    return { std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2), pass: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) >= 18 && uniq.size >= 800 };
  }, png).catch(() => null) : null;

  /* 4) 交互后 0–10s 帧率 + photoreal */
  const perf = await page.evaluate(() => new Promise((resolve) => {
    const ts = []; let last = performance.now(); const t0 = last;
    const step = () => {
      const now = performance.now(); ts.push(now - last); last = now;
      if (now - t0 < 10000) requestAnimationFrame(step);
      else {
        const f = ts.slice(2); const sum = f.reduce((a, b) => a + b, 0);
        resolve({ fps: +((f.length / sum) * 1000).toFixed(1), worst: +Math.max(...f).toFixed(1), over100: f.filter((x) => x > 100).length });
      }
    };
    requestAnimationFrame(step);
  }));
  let photo = null;
  for (let k = 0; k < 400; k++) {
    photo = await page.evaluate(() => {
      const p = window.__gevPhotoreal;
      const v = window.__gevViewer;
      return p && p.ready ? { ready: true, globeShow: v?.scene?.globe?.show, stack: window.__gevMapStack?.getActiveId?.() ?? null } : null;
    }).catch(() => null);
    if (photo) break;
    await sleep(100);
  }
  const gpu = await page.evaluate(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
    } catch (_) { return null; }
  });
  const snap = await page.evaluate(() => window.__gevBoot?.snapshot?.() ?? null).catch(() => null);

  const row = {
    run: i,
    cardsClickableWall: releasedWall,
    click,
    b5Wall: revealWall,
    b5,
    photoreal: photo,
    fps: perf,
    gate: snap ? { inputReleasedAt: snap.inputReleasedAt, interactiveAt: snap.interactiveAt, viewContentAt: snap.viewContentAt, decideAt: snap.decideAt } : null,
    gpu,
    errors: errors.slice(0, 6),
  };
  runs.push(row);
  console.log(JSON.stringify(row));
  await browser.close();
}

const summary = {
  tag: TAG,
  base: BASE,
  runs: runs.length,
  cardsClickable: runs.map((r) => r.cardsClickableWall),
  cardsClickableMedian: median(runs.map((r) => r.cardsClickableWall)),
  cardsClickableLe5s: runs.filter((r) => r.cardsClickableWall != null && r.cardsClickableWall <= 5000).length,
  clickOk: runs.filter((r) => r.click?.ok).length,
  b5Wall: runs.map((r) => r.b5Wall),
  b5WallMedian: median(runs.map((r) => r.b5Wall)),
  b5Le8s: runs.filter((r) => r.b5Wall != null && r.b5Wall <= 8000).length,
  b5Pass: runs.filter((r) => r.b5?.pass).length,
  photorealReady: runs.filter((r) => r.photoreal?.ready && r.photoreal?.globeShow === false).length,
  fps: runs.map((r) => r.fps?.fps),
  worst: runs.map((r) => r.fps?.worst),
  over100: runs.map((r) => r.fps?.over100),
  gpuAll3060: runs.every((r) => /RTX 3060/.test(r.gpu || '')),
};
writeFileSync(join(OUT, `${TAG}-summary.json`), JSON.stringify({ summary, runs }, null, 1));
console.log('SUMMARY ' + JSON.stringify(summary, null, 1));
