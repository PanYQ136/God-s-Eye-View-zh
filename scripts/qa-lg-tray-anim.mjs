#!/usr/bin/env node
/** 托盘开合动画：按 rAF 采样 opacity（证明 display:none 改造后动画仍在） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1500));

const run = (action) => page.evaluate(async (action) => {
  const panel = document.getElementById('location-bar');
  const tray = panel.querySelector('.dock-popover-content');
  const samples = [];
  const t0 = performance.now();
  let stop = false;
  const tick = () => {
    if (stop) return;
    const cs = getComputedStyle(tray);
    samples.push({ t: +(performance.now() - t0).toFixed(0), display: cs.display, opacity: +Number(cs.opacity).toFixed(3), ct: tray.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').length });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  if (action === 'open') {
    panel.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  } else {
    await new Promise((r) => setTimeout(r, 20));
    panel.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  }
  await new Promise((r) => setTimeout(r, 420));
  stop = true;
  return { action, samples };
}, action);

const open = await page.evaluate(() => {
  const panel = document.getElementById('location-bar');
  panel.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  return panel.classList.contains('collapsed');
});
const openSamples = await page.evaluate(async () => {
  const panel = document.getElementById('location-bar');
  const tray = panel.querySelector('.dock-popover-content');
  const samples = []; const t0 = performance.now(); let stop = false;
  const tick = () => { if (stop) return; const cs = getComputedStyle(tray); samples.push({ t: +(performance.now() - t0).toFixed(0), display: cs.display, opacity: +Number(cs.opacity).toFixed(3), ct: tray.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').length }); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 380)); stop = true; return samples;
});
const closeSamples = await page.evaluate(async () => {
  const panel = document.getElementById('location-bar');
  const tray = panel.querySelector('.dock-popover-content');
  const samples = []; const t0 = performance.now(); let stop = false;
  const tick = () => { if (stop) return; const cs = getComputedStyle(tray); samples.push({ t: +(performance.now() - t0).toFixed(0), display: cs.display, opacity: +Number(cs.opacity).toFixed(3), ct: tray.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').length }); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 30));
  panel.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  await new Promise((r) => setTimeout(r, 380)); stop = true; return samples;
});
const out = { openSamples, closeSamples };
fs.writeFileSync(`${SCR}/tail3-tray-anim.json`, JSON.stringify(out, null, 1));
const thin = (a) => a.filter((_, i) => i % 2 === 0).slice(0, 14);
console.log(JSON.stringify({ open: thin(openSamples), close: thin(closeSamples) }, null, 1));
await browser.close();
