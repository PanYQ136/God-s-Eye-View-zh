#!/usr/bin/env node
/**
 * voice-overflow-probe.mjs —— 定位 #gev-voice-control 内撑出 scrollWidth 的隐藏子元素（只读）
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
  const vr = vc.getBoundingClientRect();
  const out = {
    shell: { sw: vc.scrollWidth, cw: vc.clientWidth, ow: vc.offsetWidth,
             rect: [Math.round(vr.x), Math.round(vr.y), Math.round(vr.width), Math.round(vr.height)],
             overflowX: getComputedStyle(vc).overflowX, display: getComputedStyle(vc).display,
             w: getComputedStyle(vc).width, minW: getComputedStyle(vc).minWidth, maxW: getComputedStyle(vc).maxWidth },
    nodes: [],
  };
  const walk = (el, depth) => {
    for (const ch of el.children) {
      const cs = getComputedStyle(ch);
      const r = ch.getBoundingClientRect();
      const rel = Math.round(r.right - vr.left);
      const isHidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
      out.nodes.push({
        depth,
        tag: ch.tagName.toLowerCase(),
        id: ch.id || '',
        cls: (ch.className && String(ch.className).slice(0, 60)) || '',
        display: cs.display, vis: cs.visibility, op: cs.opacity, pos: cs.position,
        rect: [Math.round(r.x - vr.x), Math.round(r.y - vr.y), Math.round(r.width), Math.round(r.height)],
        relRight: rel,
        sw: ch.scrollWidth, cw: ch.clientWidth,
        txt: (ch.textContent || '').trim().slice(0, 30),
        hidden: isHidden,
      });
      if (depth < 4) walk(ch, depth + 1);
    }
  };
  walk(vc, 0);
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'out-qa/voice-card-before.png', clip: undefined });
const vcBox = await page.evaluate(() => {
  const r = document.getElementById('gev-voice-control').getBoundingClientRect();
  return { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 24), width: r.width + 48, height: r.height + 48 };
});
await page.screenshot({ path: 'out-qa/voice-card-before-crop.png', clip: vcBox });
await browser.close();
