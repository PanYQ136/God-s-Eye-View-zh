#!/usr/bin/env node
/** check-fps-chip.mjs —— 对照：页面自带 FPS 读数 vs rAF 实测，环开/环关各 8s */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1536,820'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && window.__gevEdge.stats().frames > 0, { timeout: 120000 });
await sleep(14000);
await page.keyboard.press('Escape'); await sleep(2500);
const chip = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('body *')].find((e) => /^\s*FPS\s*\d+/i.test(e.textContent || '') && e.children.length === 0);
  return el ? el.textContent.trim() : null;
});
async function sample(label) {
  const r = await page.evaluate(async () => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < 8000) { const a = performance.now(); await new Promise((x) => requestAnimationFrame(x)); t.push(performance.now() - a); }
    t.sort((a, b) => a - b); const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    return { rafP50: p(0.5), rafFps: +(1000 / p(0.5)).toFixed(1), rafP90: p(0.9), n: t.length, ring: window.__gevEdge.stats().fps };
  });
  console.log(label.padEnd(10), JSON.stringify({ chip: await chip(), ...r }));
  return r;
}
await page.evaluate(() => window.__gevEdge.on()); await sleep(800);
await sample('ring ON');
await page.evaluate(() => window.__gevEdge.off()); await sleep(800);
await sample('ring OFF');
await page.evaluate(() => window.__gevEdge.on()); await sleep(800);
await sample('ring ON#2');
await page.screenshot({ path: 'evidence/_collab/t_9739e3a7/chipstate.png' });
await browser.close();
