#!/usr/bin/env node
/* review-lg-probe20.mjs —— 第四轮复核：枚举 .gev-lc 内深色 (color 各通道<40) 且带文本的元素，判断是否为§5.5「纯黑文字」 */
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
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2500));

const res = await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('.gev-lc, .gev-lc *')) {
    const cs = getComputedStyle(e);
    const m = cs.color.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/);
    if (!m) continue;
    const [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    if (!(r < 40 && g < 40 && b < 40 && a > 0.5)) continue;
    if (!e.offsetParent) continue;
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    const txt = (e.textContent || '').trim();
    if (!txt) continue;
    const rect = e.getBoundingClientRect();
    const shell = e.closest('.gev-lc');
    out.push({
      card: shell ? (shell.id || String(shell.className).slice(0, 26)) : '?',
      tag: e.tagName, id: e.id || null, cls: String(e.className || '').slice(0, 46),
      color: cs.color, ownText: own.slice(0, 30), text: txt.slice(0, 30),
      rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      vis: cs.visibility, op: cs.opacity, fs: cs.fontSize,
      exactlyBlack: cs.color === 'rgb(0, 0, 0)',
    });
  }
  return out;
});
fs.writeFileSync(OUT + '/p20.json', JSON.stringify({ res, errs }, null, 1));
console.log(JSON.stringify({ count: res.length, exactlyBlack: res.filter((x) => x.exactlyBlack).length, sample: res.slice(0, 40), errs: errs.slice(0, 3) }, null, 1));
await browser.close();
