#!/usr/bin/env node
/** Probe: DOM skeleton for glass-surface mapping. */
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 8000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 800));

const out = await page.evaluate(() => {
  const walk = (el, depth) => {
    if (depth > 3) return [];
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const line = `${'  '.repeat(depth)}${el.tagName.toLowerCase()}#${el.id || '-'}.${(el.className || '').toString().split(' ').slice(0, 3).join('.')} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}] pos=${cs.position} z=${cs.zIndex} disp=${cs.display}`;
    const kids = [...el.children].flatMap((c) => walk(c, depth + 1));
    return [line, ...kids];
  };
  const tops = [...document.body.children].filter((e) => e.tagName !== 'SCRIPT' && e.tagName !== 'CANVAS');
  const body = tops.flatMap((e) => walk(e, 0));
  const fixedSmall = [...document.querySelectorAll('body *')]
    .filter((e) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return cs.position === 'fixed' && r.width > 8 && r.height > 8 && r.width < 700 && r.height < 200;
    })
    .map((e) => `${e.id || '-'}.${(e.className || '').toString().split(' ').slice(0, 2).join('.')} [${Math.round(e.getBoundingClientRect().left)},${Math.round(e.getBoundingClientRect().top)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}]`);
  return { body, fixedSmall };
});
console.log('=== TREE ===');
console.log(out.body.join('\n'));
console.log('=== FIXED SMALL ===');
console.log(out.fixedSmall.join('\n'));
await page.screenshot({ path: 'evidence/lg-glass-shots/p0/probe.png' });
await browser.close();
