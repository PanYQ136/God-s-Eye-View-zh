#!/usr/bin/env node
/**
 * _rv2-t829-toast.mjs — reviewer probe B: identify the #toast element that still
 * carries rgba dark fill + backdrop blur(16px), its relation to #gev-toast,
 * and capture a crop so we can see what the user actually sees.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });

const probe = async (tag) => page.evaluate((tag) => {
  const el = document.getElementById('toast');
  if (!el) return { tag, found: false };
  const c = getComputedStyle(el); const r = el.getBoundingClientRect();
  const chain = [];
  let p = el;
  for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
    if (!p.getBoundingClientRect) break;
    const pc = getComputedStyle(p); const pr = p.getBoundingClientRect();
    chain.push({ id: p.id || '', tag: p.tagName, cls: String(p.className || '').slice(0, 30),
      bg: pc.backgroundColor, bf: pc.backdropFilter, bgI: String(pc.backgroundImage).slice(0, 30),
      rect: [+pr.x.toFixed(0), +pr.y.toFixed(0), +pr.width.toFixed(0), +pr.height.toFixed(0)] });
  }
  return {
    tag,
    found: true,
    html: el.outerHTML.slice(0, 400),
    cls: el.className, text: (el.textContent || '').trim().slice(0, 60),
    rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
    bg: c.backgroundColor, bf: c.backdropFilter, bgI: String(c.backgroundImage).slice(0, 40),
    opacity: c.opacity, visibility: c.visibility, display: c.display, zIndex: c.zIndex,
    containsGevToast: !!el.querySelector('#gev-toast'),
    gevToastRect: (() => { const g = document.getElementById('gev-toast'); if (!g) return null; const gr = g.getBoundingClientRect(); const gc = getComputedStyle(g); return { rect: [+gr.x.toFixed(0), +gr.y.toFixed(0), +gr.width.toFixed(0), +gr.height.toFixed(0)], bg: gc.backgroundColor, bf: gc.backdropFilter, opacity: gc.opacity, parent: g.parentElement && (g.parentElement.id || g.parentElement.className) }; })(),
    chain,
  };
}, tag);

const t0 = await probe('t+2s');
console.log('T2', JSON.stringify(t0, null, 1));
await page.screenshot({ path: path.join(OUT, 'B-toast-t2.png'), clip: { x: 600, y: 560, width: 340, height: 110 } });
await sleep(9000);
const t1 = await probe('t+11s');
console.log('T11 found=' + t1.found + ' rect=' + JSON.stringify(t1.rect) + ' bg=' + t1.bg + ' bf=' + t1.bf + ' opacity=' + t1.opacity + ' text=' + t1.text);
await page.screenshot({ path: path.join(OUT, 'B-toast-t11.png'), clip: { x: 600, y: 560, width: 340, height: 110 } });
await page.screenshot({ path: path.join(OUT, 'B-full-t11.png') });
fs.writeFileSync(path.join(OUT, 'B-toast.json'), JSON.stringify({ t0, t1 }, null, 1));
await browser.close();
