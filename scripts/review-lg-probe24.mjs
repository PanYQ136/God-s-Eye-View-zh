#!/usr/bin/env node
/* review-lg-probe24.mjs —— 第四轮复核：prefers-reduced-motion 回退（取消 morph、保留材质） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r4';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2000));
const before = await page.evaluate(() => {
  const sh = document.getElementById('data-panel').closest('.gev-lc');
  const cs = getComputedStyle(sh);
  const cv = document.getElementById('gev-gl-glass');
  return { shellBg: cs.backgroundColor, shellBgImg: cs.backgroundImage.slice(0, 40), transition: cs.transitionDuration, glassDisplay: cv ? getComputedStyle(cv).display : 'missing', matchesMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
});
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await new Promise((r) => setTimeout(r, 900));
const after = await page.evaluate(() => {
  const sh = document.getElementById('data-panel').closest('.gev-lc');
  const cs = getComputedStyle(sh);
  const cv = document.getElementById('gev-gl-glass');
  const inner = sh.querySelector('.panel-inner');
  return { shellBg: cs.backgroundColor, transition: cs.transitionDuration, anim: cs.animationName, glassDisplay: cv ? getComputedStyle(cv).display : 'missing', glassOpacity: cv ? getComputedStyle(cv).opacity : null, innerTransition: inner ? getComputedStyle(inner).transitionDuration : null, matchesMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
});
await page.screenshot({ path: OUT + '/p24-reduced-motion.png' });
fs.writeFileSync(OUT + '/p24.json', JSON.stringify({ before, after, errs }, null, 1));
console.log(JSON.stringify({ before, after, errs: errs.slice(0, 3) }, null, 1));
await browser.close();
