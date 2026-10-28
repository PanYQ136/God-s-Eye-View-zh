#!/usr/bin/env node
/** 探 #gev-voice-control 的可读性要素：卡片/子层背景、标签颜色，暗 & bright 两态。 */
import puppeteer from 'puppeteer';
const URL = process.env.GEV_URL || 'http://127.0.0.1:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);

const dump = () => page.evaluate(() => {
  const card = document.getElementById('gev-voice-control');
  if (!card) return { missing: true };
  const chain = (el) => {
    const out = [];
    let n = el;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      const cs = getComputedStyle(n);
      const b = n.getBoundingClientRect();
      out.push({
        tag: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
        bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 60), bd: cs.borderRadius,
        box: [Math.round(b.width), Math.round(b.height)],
      });
    }
    return out;
  };
  const leaves = [];
  card.querySelectorAll('*').forEach((n) => {
    if (n.children.length) return;
    const t = (n.textContent || '').trim();
    if (!t) return;
    const cs = getComputedStyle(n);
    const b = n.getBoundingClientRect();
    if (!b.width) return;
    leaves.push({ t, color: cs.color, fs: cs.fontSize, fw: cs.fontWeight, box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], chain: chain(n).slice(0, 3) });
  });
  const cs = getComputedStyle(card);
  return { bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 80), shadow: cs.boxShadow.slice(0, 200), cls: card.className, leaves: leaves.slice(0, 8) };
});

const dark = await dump();
await page.evaluate(() => document.documentElement.setAttribute('data-gev-glass-lum', 'bright'));
await sleep(300);
const bright = await dump();
console.log(JSON.stringify({ dark, bright }, null, 1));
await browser.close();
