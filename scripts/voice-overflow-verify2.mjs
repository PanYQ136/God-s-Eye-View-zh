#!/usr/bin/env node
/**
 * voice-overflow-verify2.mjs —— #gev-voice-control 横向溢出修复验收（同页面 A/B）
 * A = 修复后 CSS（常态 display:none）
 * B = 运行时注回旧行为（tray display:flex），用来证明可见内容 layout 完全没动
 * 另外：hover 时 tooltip 仍能出现 + 离开后能收回。
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
      overflowX: getComputedStyle(vc).overflowX, display: getComputedStyle(vc).display,
    },
    nodes: [],
  };
  const walk = (el) => {
    for (const ch of el.children) {
      const cs = getComputedStyle(ch);
      const r = ch.getBoundingClientRect();
      out.nodes.push({
        key: (ch.id || (typeof ch.className === 'string' ? ch.className.trim().split(/\s+/)[0] : ch.tagName) || ch.tagName) + '|' + (ch.textContent || '').trim().slice(0, 18),
        tag: ch.tagName.toLowerCase(),
        display: cs.display, vis: cs.visibility, op: Number(cs.opacity).toFixed(2), pos: cs.position,
        rect: [Math.round(r.x - vr.x), Math.round(r.y - vr.y), Math.round(r.width), Math.round(r.height)],
        relRight: Math.round(r.right - vr.left), relLeft: Math.round(r.left - vr.left),
        txt: (ch.textContent || '').trim().slice(0, 26),
      });
      walk(ch);
    }
  };
  walk(vc);
  return out;
});

const shotCard = async (file) => {
  const clip = await page.evaluate(() => {
    const r = document.getElementById('gev-voice-control').getBoundingClientRect();
    return { x: Math.max(0, r.x - 22), y: Math.max(0, r.y - 22), width: r.width + 44, height: r.height + 44 };
  });
  await page.screenshot({ path: file, clip });
};

// ---- A：修复后 ----
const A = await collect();
await shotCard(`out-qa/voice-card-${tag}.png`);

// ---- B：注回旧行为（同一页面，避免重新加载的坐标抖动）----
const styleHandle = await page.addStyleTag({ content: '#gev-voice-control .gev-voice-help-tray{display:flex !important;}' });
await new Promise((r) => setTimeout(r, 400));
const B = await collect();
await styleHandle.evaluate((n) => n.remove());
await new Promise((r) => setTimeout(r, 400));
const A2 = await collect();

const isVisible = (n) => n.vis === 'visible' && n.display !== 'none' && Number(n.op) > 0;
const bmap = new Map(B.nodes.map((n) => [n.key, n]));
const moved = [];
for (const n of A.nodes) {
  const o = bmap.get(n.key);
  if (!o) { moved.push({ key: n.key, note: 'only-in-A' }); continue; }
  if (isVisible(n) && isVisible(o) && n.rect.join(',') !== o.rect.join(',')) {
    moved.push({ key: n.key, A: n.rect, B: o.rect });
  }
}
const overflowNodesA = A.nodes.filter((n) => n.display !== 'none' && n.relRight > A.shell.cw).map((n) => ({ key: n.key, relRight: n.relRight }));
const overflowNodesB = B.nodes.filter((n) => n.display !== 'none' && n.relRight > B.shell.cw).map((n) => ({ key: n.key, relRight: n.relRight }));

// ---- hover：tooltip 仍可见 ----
const box = await page.evaluate(() => {
  const r = document.getElementById('gev-voice-control').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await new Promise((r) => setTimeout(r, 520));
const hover = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
});
const hb = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const r = t.getBoundingClientRect();
  return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: r.height + 32 };
});
await page.screenshot({ path: `out-qa/voice-card-${tag}-hover.png`, clip: hb });
await page.mouse.move(400, 260);
await new Promise((r) => setTimeout(r, 700));
const afterLeave = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const vc = document.getElementById('gev-voice-control');
  return { trayDisplay: getComputedStyle(t).display, sw: vc.scrollWidth, cw: vc.clientWidth };
});
await shotCard(`out-qa/voice-card-${tag}-afterleave.png`);

const report = {
  cardBox: A.shell.rect,
  A_fixed: A.shell,
  B_legacy: B.shell,
  A2_regression_check: A2.shell,
  overflowNodesA_visible: overflowNodesA,
  overflowNodesB_visible: overflowNodesB,
  visibleElementsMoved: moved,
  hover, afterLeave,
};
fs.writeFileSync(`out-qa/voice-verify-${tag}.json`, JSON.stringify({ ...report, A: A.nodes, B: B.nodes }, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
