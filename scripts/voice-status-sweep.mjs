#!/usr/bin/env node
/**
 * voice-status-sweep.mjs —— 各语音状态（idle/connecting/listening/executing/error）
 * 下 #gev-voice-control 的 scrollWidth/clientWidth，以及 tray-open 状态。
 */
import puppeteer from 'puppeteer';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2500));

const measure = (label) => page.evaluate((label) => {
  const vc = document.getElementById('gev-voice-control');
  const over = [];
  const vr = vc.getBoundingClientRect();
  const walk = (el) => {
    for (const ch of el.children) {
      const cs = getComputedStyle(ch);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0) {
        const r = ch.getBoundingClientRect();
        if (Math.round(r.right - vr.left) > vc.clientWidth) over.push((ch.id || ch.className || ch.tagName) + ' →' + Math.round(r.right - vr.left));
      }
      walk(ch);
    }
  };
  walk(vc);
  return { label, status: vc.dataset.status || null, sw: vc.scrollWidth, cw: vc.clientWidth, over };
}, label);

const out = [];
out.push(await measure('as-loaded'));
for (const st of ['idle', 'connecting', 'listening', 'executing', 'error']) {
  await page.evaluate((st) => { document.getElementById('gev-voice-control').dataset.status = st; }, st);
  await new Promise((r) => setTimeout(r, 350));
  out.push(await measure('status=' + st));
}
await page.evaluate(() => { document.getElementById('gev-voice-control').dataset.status = 'idle'; });
// dock tray open（点开定位 tray）
await page.evaluate(() => {
  const bar = document.getElementById('location-bar');
  if (bar) { bar.classList.remove('collapsed'); bar.classList.add('open'); }
  document.getElementById('command-dock')?.classList.add('tray-open');
});
await new Promise((r) => setTimeout(r, 700));
out.push(await measure('tray-open'));
console.log(JSON.stringify(out, null, 1));
await browser.close();
