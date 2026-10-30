#!/usr/bin/env node
/* 只读诊断：reveal 全黑的原因 —— 是「没有重绘」还是「真的没图」？
   在 mask:gone 之后截图 A，然后 requestRender + 250ms 截图 B，比较中心 std/uniq，
   并读 viewer 的 renderMode / canvas 尺寸 / 上下文状态。 */
import puppeteer from 'puppeteer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL0 = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gev-p7ablk-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
await page.goto(`${URL0}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

const measure = async () => {
  const png = await page.screenshot({ encoding: 'base64' }).catch(() => null);
  if (!png) return null;
  return page.evaluate(async (b64) => {
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
    return { std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2) };
  }, png);
};

for (let k = 0; k < 2500; k++) {
  const v = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.interactive)).catch(() => false);
  if (v) break;
  await sleep(20);
}
const afterGone = await measure();
const viewerState1 = await page.evaluate(() => {
  const v = window.__gevViewer;
  return {
    requestRenderMode: v?.scene?.requestRenderMode ?? null,
    maximumRenderTimeChange: v?.scene?.maximumRenderTimeChange ?? null,
    globeShow: v?.scene?.globe?.show ?? null,
    canvas: (() => { const c = v?.scene?.canvas; return c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null; })(),
    ctxLost: (() => { try { const gl = v?.scene?.canvas?.getContext('webgl2') || v?.scene?.canvas?.getContext('webgl'); return gl ? gl.isContextLost() : null; } catch (_) { return null; } })(),
    layers: (() => { try { return v.scene.imageryLayers.length; } catch (_) { return null; } })(),
  };
});
await page.evaluate(() => {
  try { window.__gevViewer?.scene?.requestRender?.(); } catch (_) {}
});
await sleep(250);
const afterRender = await measure();
const probe = await page.evaluate(() => window.__gevBoot.snapshot().viewProbe);
const goneMs = await page.evaluate(() => window.__gevBoot.snapshot().interactiveAt);
console.log(JSON.stringify({ goneAt: goneMs, afterGone, afterRender, viewerState1, lastProbe: probe }, null, 1));
await browser.close();
