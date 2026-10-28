#!/usr/bin/env node
/* qa-lg-stack.mjs — 查玻璃层与卡片壳/伪元素的层叠顺序，定位「截图 alpha 比 framebuffer 高 6–12」的来源 */
import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,730'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(12000);
const out = await page.evaluate(() => {
  const cv = document.getElementById('gev-gl-glass');
  const cs = getComputedStyle(cv);
  const ids = ['data-panel', 'gev-voice-control', 'top-center-actions', 'gev-locate-btn'];
  const rows = ids.map((id) => {
    const el = document.getElementById(id);
    const shell = (el && el.closest('.gev-lc')) || el;
    if (!shell) return { id, missing: true };
    const s = getComputedStyle(shell);
    const before = getComputedStyle(shell, '::before');
    const after = getComputedStyle(shell, '::after');
    return {
      id, shellZ: s.zIndex, shellPos: s.position, shellBg: s.backgroundColor, shellOpacity: s.opacity,
      beforeBg: before.backgroundColor, beforeZ: before.zIndex, beforeContent: before.content,
      afterBg: after.backgroundColor, afterZ: after.zIndex,
      innerBg: (() => { const i = shell.querySelector('.panel-inner'); return i ? getComputedStyle(i).backgroundColor : null; })(),
      cvZ: cs.zIndex, cvPos: cs.position, cvOpacity: cs.opacity, cvMix: cs.mixBlendMode
    };
  });
  return { rows, docZ: getComputedStyle(document.documentElement).zIndex };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
