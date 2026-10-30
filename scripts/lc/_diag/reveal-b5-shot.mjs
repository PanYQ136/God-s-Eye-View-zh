#!/usr/bin/env node
/* reveal 截图中心 640×420 的 B5 读数（与 gate B5 同口径：中心裁切 / 8bit 唯一色 / 亮度 std）
   ----------------------------------------------------------------------------
   用途：冷启动 harness（boot-timeline-coldstart.mjs）在「遮罩刚消失」时截的那张图，
   直接按 gate 的 B5 判据（uniq ≥800 且 std ≥18）量一次，作为「收起时画面真的有影像」
   的独立证据 —— 不依赖页内探针，也不依赖 gate 全套 27 条。
   用法: node scripts/lc/_diag/reveal-b5-shot.mjs .gev-logs/lc/boot/baseline-xxx-run1.png [...]
*/
import puppeteer from 'puppeteer';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('need png paths');
  process.exit(2);
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.goto('about:blank');

for (const f of files) {
  if (!existsSync(f)) {
    console.log(`${f}: MISSING`);
    continue;
  }
  const b64 = readFileSync(resolve(f)).toString('base64');
  const st = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(
      await (await fetch('data:image/png;base64,' + b64)).blob(),
    );
    const w = Math.min(640, bmp.width);
    const h = Math.min(420, bmp.height);
    const x = Math.max(0, Math.round((bmp.width - w) / 2));
    const y = Math.max(0, Math.round((bmp.height - h) / 2));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let sum = 0,
      sum2 = 0,
      n = 0;
    const uniq = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sum2 += l * l;
      n += 1;
      uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    const m = sum / n;
    return {
      shot: bmp.width + 'x' + bmp.height,
      area: w + 'x' + h,
      std: +Math.sqrt(Math.max(0, sum2 / n - m * m)).toFixed(2),
      uniq: uniq.size,
      mean: +m.toFixed(2),
    };
  }, b64);
  const ok = st.uniq >= 800 && st.std >= 18;
  console.log(
    `${f}: B5 ${ok ? 'PASS' : 'FAIL'} std=${st.std} uniq=${st.uniq} mean=${st.mean} center=${st.area} shot=${st.shot}`,
  );
}
await browser.close();
