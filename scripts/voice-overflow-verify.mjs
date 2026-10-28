#!/usr/bin/env node
/**
 * voice-overflow-verify.mjs —— #gev-voice-control 横向溢出修复验收
 * 1) 常态/折叠：scrollWidth ≤ clientWidth + 1
 * 2) 可见子元素 rect 与修复前逐一比对（不裁、不位移）
 * 3) hover 时 tooltip 仍能显示
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const tag = process.argv[3] || 'after';
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

const collect = () => page.evaluate(() => {
  const vc = document.getElementById('gev-voice-control');
  if (!vc) return { missing: true };
  const vr = vc.getBoundingClientRect();
  const out = {
    shell: {
      sw: vc.scrollWidth, cw: vc.clientWidth, ow: vc.offsetWidth,
      rect: [Math.round(vr.x), Math.round(vr.y), Math.round(vr.width), Math.round(vr.height)],
      overflowX: getComputedStyle(vc).overflowX, display: getComputedStyle(vc).display,
    },
    nodes: [],
  };
  const walk = (el, depth, path) => {
    [...el.children].forEach((ch, i) => {
      const cs = getComputedStyle(ch);
      const r = ch.getBoundingClientRect();
      const key = path + '/' + ch.tagName.toLowerCase() + (ch.id ? '#' + ch.id : (ch.className && typeof ch.className === 'string' ? '.' + ch.className.trim().split(/\s+/)[0] : '')) + '[' + i + ']';
      out.nodes.push({
        key, depth,
        display: cs.display, vis: cs.visibility, op: cs.opacity, pos: cs.position,
        rect: [Math.round(r.x - vr.x), Math.round(r.y - vr.y), Math.round(r.width), Math.round(r.height)],
        relRight: Math.round(r.right - vr.left),
        sw: ch.scrollWidth, cw: ch.clientWidth,
        txt: (ch.textContent || '').trim().slice(0, 26),
        hidden: cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0',
      });
      if (depth < 4) walk(ch, depth + 1, key);
    });
  };
  walk(vc, 0, 'vc');
  return out;
});

// ---- 1) 常态 / 折叠 ----
const collapsed = await collect();
fs.writeFileSync(`out-qa/voice-${tag}.json`, JSON.stringify(collapsed, null, 1));
const clipOf = async () => page.evaluate(() => {
  const r = document.getElementById('gev-voice-control').getBoundingClientRect();
  return { x: Math.max(0, r.x - 22), y: Math.max(0, r.y - 22), width: r.width + 44, height: r.height + 44 };
});
await page.screenshot({ path: `out-qa/voice-card-${tag}.png`, clip: await clipOf() });

// ---- 2) hover：tooltip 仍要能显示 ----
const box = await page.evaluate(() => {
  const r = document.getElementById('gev-voice-control').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await new Promise((r) => setTimeout(r, 500));
const hover = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return {
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    text: (t.textContent || '').replace(/\s+/g, ' ').trim(),
  };
});
const hb = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const r = t.getBoundingClientRect();
  return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: r.height + 32 };
});
await page.screenshot({ path: `out-qa/voice-card-${tag}-hover.png`, clip: hb });
// 移开鼠标，确认能收回（exit transition → display:none）
await page.mouse.move(400, 200);
await new Promise((r) => setTimeout(r, 600));
const afterLeave = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const vc = document.getElementById('gev-voice-control');
  return { display: getComputedStyle(t).display, sw: vc.scrollWidth, cw: vc.clientWidth };
});

// ---- 3) 与修复前逐元素比对可见内容 ----
let diff = null;
const beforePath = 'out-qa/voice-probe-before.json';
if (fs.existsSync(beforePath)) {
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const bmap = new Map(before.nodes.map((n) => [n.key, n]));
  const changes = [];
  for (const n of collapsed.nodes) {
    const b = bmap.get(n.key);
    if (!b) { changes.push({ key: n.key, note: 'new' }); continue; }
    if (n.rect.join(',') !== b.rect.join(',') || n.vis !== b.vis || n.display !== b.display) {
      changes.push({ key: n.key, before: { rect: b.rect, vis: b.vis, display: b.display, op: b.op }, after: { rect: n.rect, vis: n.vis, display: n.display, op: n.op } });
    }
  }
  diff = { changed: changes, beforeCount: before.nodes.length, afterCount: collapsed.nodes.length };
}
fs.writeFileSync(`out-qa/voice-${tag}-diff.json`, JSON.stringify({ collapsed: collapsed.shell, hover, afterLeave, diff }, null, 1));
console.log(JSON.stringify({ collapsed: collapsed.shell, hover, afterLeave, diff }, null, 1));
await browser.close();
