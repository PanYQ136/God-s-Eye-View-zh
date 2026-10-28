#!/usr/bin/env node
/** 诊断 #location-bar 里文字为「位置」的那个节点：color/opacity/filter/class 及祖先链 */
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
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
const info = await page.evaluate(() => {
  const out = [];
  const el = document.getElementById('location-bar');
  el.querySelectorAll('*').forEach((n) => {
    let direct = '';
    n.childNodes.forEach((c) => { if (c.nodeType === 3) direct += c.textContent; });
    direct = direct.trim();
    if (!direct) return;
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    const chain = [];
    let p = n;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      chain.push(`${p.tagName}${p.id ? '#' + p.id : ''}.${(typeof p.className === 'string' ? p.className : '').trim().split(/\s+/).join('.')} color=${s.color} opacity=${s.opacity} filter=${s.filter}`);
      p = p.parentElement;
    }
    out.push({ text: direct, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], color: cs.color, opacity: cs.opacity, filter: cs.filter, mix: cs.mixBlendMode, cls: typeof n.className === 'string' ? n.className : '', chain: chain.slice(0, 5) });
  });
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
