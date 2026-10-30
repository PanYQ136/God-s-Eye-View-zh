#!/usr/bin/env node
/* Phase7A-D 单跑探针：只读，打印 inputRelease / B5 / photoreal / 卡片真实点击结果。
   用法: node scripts/lc/_diag/phase7a-d-probe.mjs [url] */
import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL0 = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'gev-p7ad-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: [
    '--no-sandbox',
    '--window-size=1372,934',
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 240));
});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});

const wall0 = Date.now();
await page.goto(`${URL0}&d=${Date.now()}`, { waitUntil: 'domcontentloaded' });

const poll = async (fn, timeout = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return { at: Date.now() - t0, wall: Date.now() - wall0, v };
    await sleep(20);
  }
  return null;
};

const released = await poll(() => {
  const g = window.__gevBoot;
  return !!(g && g.inputReleased) || null;
});
const releasedShot = await page
  .screenshot({ encoding: 'base64' })
  .catch(() => null);
if (releasedShot)
  await import('node:fs').then((fs) =>
    fs.writeFileSync('.gev-logs/lc/phase7a/p7ad-input-released.png',
      Buffer.from(releasedShot, 'base64')),
  );

/* 真实鼠标点击一张卡（CDP Input.dispatchMouseEvent，不用 element.click()） */
let click = null;
if (released) {
  const hit = await page.evaluate(() => {
    const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const h = (el.querySelector('.card-header, header, .lc-head, [data-lc-header]') || el).getBoundingClientRect();
      if (h.width < 8 || h.height < 8) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.2) continue;
      return { id, x: Math.round(h.left + h.width / 2), y: Math.round(h.top + h.height / 2) };
    }
    return null;
  });
  if (hit) {
    const before = await page.evaluate((id) => window.__lc?.api?.phases()?.[id] ?? null, hit.id);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
    await sleep(400);
    const after = await page.evaluate((id) => window.__lc?.api?.phases()?.[id] ?? null, hit.id);
    const topEl = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.id || el.className || el.tagName).toString().slice(0, 60) : null;
    }, hit);
    click = { hit, before, after, topEl, at: Date.now() - wall0 };
  }
}

const b5 = await poll(() => {
  const g = window.__gevBoot;
  return !!(g && g.interactive) || null;
}, 45000);
const photo = await poll(() => {
  const p = window.__gevPhotoreal;
  return !!(p && p.ready) || null;
}, 45000);

const snap = await page.evaluate(() => {
  const g = window.__gevBoot;
  const s = g ? g.snapshot() : null;
  const tl = window.__bootTimeline && window.__bootTimeline.snapshot ? window.__bootTimeline.snapshot() : null;
  const marks = tl && tl.marks ? tl.marks.filter((m) => /^gate:|^chrome:|^mask:|^app:|^stack:|^base|^tileset|^photoreal|^main|^scene|^viewer/.test(m.name)).map((m) => [m.name, Math.round(m.t)]) : null;
  const gpu = (() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
    } catch (_) { return null; }
  })();
  return { snapshot: s, marks, gpu, lc: { mounted: window.__lc?.api?.mounted, ready: window.__lc?.api?.ready, readyAt: window.__lc?.api?.readyAt, interactiveAt: window.__lc?.api?.interactiveAt } };
});

/* 交互后 10s 帧率 */
let fps = null;
if (b5) {
  fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const t = [];
        let last = performance.now();
        const t0 = last;
        const step = () => {
          const now = performance.now();
          t.push(now - last);
          last = now;
          if (now - t0 < 10000) requestAnimationFrame(step);
          else {
            const f = t.slice(2);
            const sum = f.reduce((a, b) => a + b, 0);
            resolve({
              frames: f.length,
              fps: +((f.length / sum) * 1000).toFixed(1),
              worst: +Math.max(...f).toFixed(1),
              over100: f.filter((x) => x > 100).length,
            });
          }
        };
        requestAnimationFrame(step);
      }),
  );
}

console.log(JSON.stringify({ url: URL0, inputReleased: released, click, b5, photo, fps, snap, errors: errors.slice(0, 12) }, null, 1));
await browser.close();
