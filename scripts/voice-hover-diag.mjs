#!/usr/bin/env node
import puppeteer from 'puppeteer';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2500));

const snap = (label) => page.evaluate((label) => {
  const vc = document.getElementById('gev-voice-control');
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const d = document.querySelector('#gev-voice-control .gev-voice-help-detail');
  const cs = getComputedStyle(t), cd = getComputedStyle(d);
  const r = t.getBoundingClientRect(), rd = d.getBoundingClientRect();
  return {
    label,
    tray: { display: cs.display, width: cs.width, maxWidth: cs.maxWidth, widthStyle: cs.width, offsetW: t.offsetWidth, rect: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)], pos: cs.position, transform: cs.transform, scale: cs.scale },
    detail: { whiteSpace: cd.whiteSpace, width: cd.width, font: cd.fontSize, rect: [Math.round(rd.width), Math.round(rd.height)], sw: d.scrollWidth },
    card: { sw: vc.scrollWidth, cw: vc.clientWidth },
  };
}, label);

console.log(JSON.stringify(await snap('idle')));
const box = await page.evaluate(() => {
  const r = document.getElementById('gev-voice-control').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
for (const ms of [80, 300, 900, 1600]) {
  await new Promise((r) => setTimeout(r, ms - (ms > 80 ? (ms === 300 ? 80 : ms === 900 ? 300 : 900) : 0)));
  console.log(JSON.stringify(await snap('hover+' + ms)));
}
await browser.close();
