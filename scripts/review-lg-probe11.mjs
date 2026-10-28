#!/usr/bin/env node
/** review-lg-probe11.mjs —— 只做 DOM 结构/颜色盘点（语音卡 + 顶部动作条），用于定位亮底可读性根因 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1000));
const dump = await page.evaluate(() => {
  const walk = (root, depth = 0, acc = []) => {
    if (!root || depth > 5) return acc;
    for (const el of root.children) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!el.offsetParent && cs.position !== 'fixed') continue;
      acc.push({
        d: depth, tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 60),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        color: cs.color, opacity: cs.opacity, fill: cs.fill, stroke: cs.stroke, bg: cs.backgroundColor,
        text: (el.textContent || '').trim().slice(0, 16),
      });
      if (depth < 4) walk(el, depth + 1, acc);
    }
    return acc;
  };
  const voice = document.getElementById('gev-voice-control');
  const top = document.getElementById('top-center-actions');
  const shellOf = (el) => el && (el.closest('.gev-lc') || el);
  const shell = shellOf(voice);
  return {
    voiceShell: shell && {
      tag: shell.tagName, id: shell.id, cls: String(shell.className).slice(0, 120),
      isGevLc: shell.classList.contains('gev-lc'),
      lum: shell.getAttribute('data-gev-lum'),
      bg: getComputedStyle(shell).backgroundColor,
      rect: (() => { const b = shell.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })(),
    },
    voiceTree: walk(voice).slice(0, 40),
    top: top && { cls: String(top.className).slice(0, 80), lum: top.getAttribute('data-gev-lum'), bg: getComputedStyle(top).backgroundColor },
    topTree: walk(top).slice(0, 40),
    htmlLum: document.documentElement.dataset.gevGlassLum,
  };
});
fs.writeFileSync(OUT + '/review-probe11.json', JSON.stringify(dump, null, 1));
console.log(JSON.stringify(dump, null, 1));
await browser.close();
