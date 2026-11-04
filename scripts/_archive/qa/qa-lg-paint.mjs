#!/usr/bin/env node
/** qa-lg-paint.mjs —— 列出 9 张卡内部所有「有实色背景/描边/模糊」的元素（找出遮住玻璃的那层） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5183/';
const label = process.argv[3] || 'paint';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1500));
const rep = await page.evaluate(() => {
  const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
    'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const out = {};
  IDS.forEach((id) => {
    const root = document.getElementById(id);
    if (!root) { out[id] = 'MISSING'; return; }
    const rows = [];
    const walk = (e, d) => {
      const cs = getComputedStyle(e);
      const bg = cs.backgroundColor, bi = cs.backgroundImage, sh = cs.boxShadow, bd = cs.borderTopWidth + ' ' + cs.borderTopColor;
      const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const shadow = sh && sh !== 'none';
      const blurred = bf && bf !== 'none';
      const bordered = parseFloat(cs.borderTopWidth) > 0;
      if ((opaque || shadow || blurred || bordered) && e.getBoundingClientRect().width > 4) {
        rows.push(`${'  '.repeat(d)}${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${(e.className || '').toString().split(' ').slice(0, 3).join('.')} bg=${bg}${bi !== 'none' ? ' bi=' + bi.slice(0, 40) : ''} sh=${shadow ? sh.slice(0, 60) : 'none'} bf=${blurred ? bf : 'none'} bd=${bordered ? bd : '0'}`);
      }
      [...e.children].forEach((c) => walk(c, d + 1));
    };
    walk(root, 0);
    out[id] = rows;
  });
  return out;
});
fs.writeFileSync(`evidence/lg-glass-shots/p0/${label}.txt`, JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1).slice(0, 9000));
await browser.close();
