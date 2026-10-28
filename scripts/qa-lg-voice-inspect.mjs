#!/usr/bin/env node
/**
 * qa-lg-voice-inspect.mjs —— 第四轮整改：语音卡标签的 computed 背景/颜色链路（自查用，只读）
 */
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

const info = await page.evaluate(() => {
  const vc = document.getElementById('gev-voice-control');
  if (!vc) return { missing: true };
  const out = { shell: null, items: [] };
  const cs = getComputedStyle(vc);
  const r = vc.getBoundingClientRect();
  out.shell = { bg: cs.backgroundColor, bf: cs.backdropFilter, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], lum: vc.dataset.gevLum };
  const skip = new Set(['SVG', 'PATH', 'SCRIPT', 'STYLE']);
  vc.querySelectorAll('*').forEach((el) => {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 12) return;
    if (el.querySelector('*')) return;
    if (el.offsetParent === null) return;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || +s.opacity < 0.15) return;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return;
    // 祖先链背景
    const chain = [];
    let p = el;
    for (let i = 0; i < 6 && p && p !== document.documentElement; i++) {
      const ps = getComputedStyle(p);
      chain.push({ tag: p.tagName, id: p.id, cls: (p.className || '').toString().slice(0, 46), bg: ps.backgroundColor, bi: ps.backgroundImage.slice(0, 40), bf: ps.backdropFilter });
      p = p.parentElement;
    }
    out.items.push({ text: t, id: el.id, cls: (el.className || '').toString().slice(0, 40), color: s.color, fs: s.fontSize, weight: s.fontWeight, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], chain });
  });
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
