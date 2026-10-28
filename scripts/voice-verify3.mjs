#!/usr/bin/env node
/**
 * voice-verify3.mjs —— #gev-voice-control 横向溢出修复验收（同页面 A/B + 唯一 key）
 * A = 修复后（常态 tray display:none、预算数值 display:none）
 * B = 运行时注回旧行为（tray display:flex、预算数值 display:block）
 * 逐元素 rect 比对 → 证明可见内容 0 位移 / 0 裁切
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
  const vr = vc.getBoundingClientRect();
  const out = {
    shell: {
      sw: vc.scrollWidth, cw: vc.clientWidth, ow: vc.offsetWidth,
      rect: [Math.round(vr.x), Math.round(vr.y), Math.round(vr.width), Math.round(vr.height)],
      overflowX: getComputedStyle(vc).overflowX,
    },
    nodes: [],
  };
  const walk = (el, path) => {
    [...el.children].forEach((ch, i) => {
      const cs = getComputedStyle(ch);
      const r = ch.getBoundingClientRect();
      const key = path + '/' + i + ':' + ch.tagName.toLowerCase() + (ch.id ? '#' + ch.id : '');
      out.nodes.push({
        key, tag: ch.tagName.toLowerCase(),
        display: cs.display, vis: cs.visibility, op: Number(cs.opacity).toFixed(2),
        rect: [Math.round(r.x - vr.x), Math.round(r.y - vr.y), Math.round(r.width), Math.round(r.height)],
        relLeft: Math.round(r.left - vr.left), relRight: Math.round(r.right - vr.left),
        txt: (ch.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      });
      walk(ch, key);
    });
  };
  walk(vc, 'vc');
  return out;
});

const shotCard = async (file) => {
  const clip = await page.evaluate(() => {
    const r = document.getElementById('gev-voice-control').getBoundingClientRect();
    return { x: Math.max(0, r.x - 22), y: Math.max(0, r.y - 22), width: r.width + 44, height: r.height + 44 };
  });
  await page.screenshot({ path: file, clip });
};

const A = await collect();
await shotCard(`out-qa/voice-card-${tag}.png`);

const h = await page.addStyleTag({ content: '#gev-voice-control .gev-voice-help-tray{display:flex !important} #command-dock #gev-voice-control .gev-voice-cost-value{display:block !important}' });
await new Promise((r) => setTimeout(r, 400));
const B = await collect();
await h.evaluate((n) => n.remove());
await new Promise((r) => setTimeout(r, 400));
const A2 = await collect();

const vis = (n) => n.vis === 'visible' && n.display !== 'none' && Number(n.op) > 0;
const bmap = new Map(B.nodes.map((n) => [n.key, n]));
const moved = [];
const onlyInA = [];
const onlyInB = [];
for (const n of A.nodes) {
  const o = bmap.get(n.key);
  if (!o) { onlyInA.push(n.key + ' ' + n.txt); continue; }
  if (vis(n) && vis(o) && n.rect.join(',') !== o.rect.join(',')) moved.push({ key: n.key, txt: n.txt, A: n.rect, B: o.rect });
}
for (const b of B.nodes) if (!A.nodes.some((n) => n.key === b.key)) onlyInB.push(b.key + ' ' + b.txt);

const accept = { sw: A.shell.sw, cw: A.shell.cw, pass: A.shell.sw <= A.shell.cw + 1 };
const overflowA = A.nodes.filter((n) => vis(n) && n.relRight > A.shell.cw).map((n) => ({ key: n.key, txt: n.txt, relRight: n.relRight }));

// hover
const box = await page.evaluate(() => {
  const r = document.getElementById('gev-voice-control').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await new Promise((r) => setTimeout(r, 600));
const hover = await page.evaluate(() => {
  const vc = document.getElementById('gev-voice-control');
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const v = document.querySelector('#gev-voice-control .gev-voice-cost-value');
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  const rv = v.getBoundingClientRect();
  return {
    trayDisplay: cs.display, trayOpacity: cs.opacity, trayRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    trayText: (t.textContent || '').replace(/\s+/g, ' ').trim(),
    costValueDisplay: getComputedStyle(v).display, costValueRect: [Math.round(rv.x), Math.round(rv.y), Math.round(rv.width), Math.round(rv.height)],
    cardSw: vc.scrollWidth, cardCw: vc.clientWidth,
  };
});
const hb = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const r = t.getBoundingClientRect();
  return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: r.height + 32 };
});
await page.screenshot({ path: `out-qa/voice-card-${tag}-hover.png`, clip: hb });
await page.mouse.move(400, 260);
await new Promise((r) => setTimeout(r, 800));
const afterLeave = await page.evaluate(() => {
  const vc = document.getElementById('gev-voice-control');
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  return { trayDisplay: getComputedStyle(t).display, sw: vc.scrollWidth, cw: vc.clientWidth };
});
await shotCard(`out-qa/voice-card-${tag}-afterleave.png`);

const report = { acceptance: accept, A_fixed: A.shell, B_legacy: B.shell, A2_recheck: A2.shell,
  overflowVisibleAtRest: overflowA, visibleElementsMoved: moved, onlyInA, onlyInB, hover, afterLeave };
fs.writeFileSync(`out-qa/voice-verify3-${tag}.json`, JSON.stringify({ ...report, A: A.nodes, B: B.nodes }, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
