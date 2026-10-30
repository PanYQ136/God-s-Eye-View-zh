import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = mkdtempSync(join(tmpdir(), 'gev-probe2-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

/* 页内采样器：每 100ms 记一次「屏幕像素 + 场景状态」 */
await page.evaluateOnNewDocument(() => {
  window.__sample = [];
  const tick = () => {
    const v = window.__gevViewer;
    const g = window.__gevBoot;
    const mask = document.getElementById('loading-screen');
    const rec = {
      t: Math.round(performance.now()),
      mask: mask ? +(getComputedStyle(mask).opacity || 0).toFixed(2) : null,
      globe: v && v.scene && v.scene.globe ? !!v.scene.globe.show : null,
      cw: v && v.canvas ? v.canvas.width : null,
      ch: v && v.canvas ? v.canvas.height : null,
      tiles: (() => { try { return v && v.scene && v.scene.primitives.length; } catch (e) { return null; } })(),
      photo: globalThis.__gevPhotoreal ? { ready: !!globalThis.__gevPhotoreal.ready } : null,
      interactive: !!(g && g.interactive),
    };
    /* 中心 80×80 直接读画面（屏幕合成不可得，这里读 canvas 2D 快照不可用 →
       用 drawImage 到 2D canvas 取均值：需要 pdb=false 时也能读到当前帧内容） */
    try {
      const c = v && v.canvas;
      if (c && c.width > 0) {
        const cv = window.__cv || (window.__cv = document.createElement('canvas'));
        cv.width = 160; cv.height = 120;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(c, c.width / 2 - 80, c.height / 2 - 60, 160, 120, 0, 0, 160, 120);
        const d = ctx.getImageData(0, 0, 160, 120).data;
        let s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2989 + d[i + 1] * 0.587 + d[i + 2] * 0.114; s += l; s2 += l * l; n++; }
        const mean = s / n;
        rec.canvasMean = +mean.toFixed(1);
        rec.canvasStd = +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(1);
      }
    } catch (e) { rec.err = String(e).slice(0, 60); }
    window.__sample.push(rec);
    if (window.__sample.length < 140) setTimeout(tick, 100);
  };
  setTimeout(tick, 3000);
});

await page.goto('http://127.0.0.1:4174/?welcome=0&p=' + Date.now(), { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 14000));
const samples = await page.evaluate(() => window.__sample);
for (const s of samples) console.log(JSON.stringify(s));
const tl = await page.evaluate(() => { try { return window.__bootTimeline.snapshot().marks.map((m) => [m.name, Math.round(m.t)]); } catch (e) { return null; } });
console.log('marks', JSON.stringify(tl));
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
