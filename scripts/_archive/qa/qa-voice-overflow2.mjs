#!/usr/bin/env node
/**
 * qa-voice-overflow2.mjs —— 语音卡 #gev-voice-control 横向溢出：前后对比 + 多状态 + 多视口
 * 用法: node scripts/qa-voice-overflow2.mjs <url> <label>
 * 输出: evidence/lg-glass-shots/p0/voice-overflow2-<label>.json  + voice2-*.png
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const label = process.argv[3] || 'run';
const outDir = 'evidence/lg-glass-shots/p0';
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1536,900',
  ],
});
const page = await browser.newPage();
const VIEWS = [
  [1536, 730],
  [1440, 900],
  [1280, 800],
  [900, 700],
  [375, 812],
];

/** 量测一个状态：返回卡片尺寸 + 可见子元素盒子（用于位置/裁切对比） */
const measure = () =>
  page.evaluate(() => {
    const card = document.getElementById('gev-voice-control');
    const cs = getComputedStyle(card);
    const cr = card.getBoundingClientRect();
    const visible = [];
    for (const el of card.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      visible.push({
        key: `${el.tagName.toLowerCase()}#${el.id || ''}.${(el.className.baseVal ?? el.className) || ''}`,
        x: Math.round((r.left - cr.left) * 10) / 10,
        y: Math.round((r.top - cr.top) * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        text: (el.textContent || '').trim().slice(0, 16),
      });
    }
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      clientWidth: card.clientWidth,
      clientHeight: card.clientHeight,
      scrollWidth: card.scrollWidth,
      scrollHeight: card.scrollHeight,
      offsetWidth: card.offsetWidth,
      rectW: Math.round(cr.width * 10) / 10,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      rectLeft: Math.round(cr.left * 10) / 10,
      rectTop: Math.round(cr.top * 10) / 10,
      visible,
    };
  });

await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => document.getElementById('gev-voice-control'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const w = document.querySelector('.welcome-modal, #welcome-modal');
  if (w) {
    const c = w.querySelector('input');
    if (c) c.click();
    const b = w.querySelector('button');
    if (b) b.click();
  }
});
await new Promise((r) => setTimeout(r, 1500));

const report = { url, label, at: new Date().toISOString(), views: [] };

for (const [w, h] of VIEWS) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 1200));
  const row = { viewport: `${w}x${h}` };

  // A. 常态（修复后）
  await page.evaluate(() => {
    const card = document.getElementById('gev-voice-control');
    card.removeAttribute('data-status');
    card.dataset.status = 'idle';
    card.classList.remove('error-dismissed');
    document.activeElement?.blur();
    const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
    if (t) t.style.removeProperty('display');
  });
  await new Promise((r) => setTimeout(r, 400));
  row.after = await measure();

  // B. 模拟修复前（工具条 tooltip 用 visibility:hidden 参与布局）
  await page.evaluate(() => {
    const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
    if (t) t.style.setProperty('display', 'flex', 'important');
  });
  await new Promise((r) => setTimeout(r, 400));
  row.before = await measure();
  await page.evaluate(() => {
    const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
    if (t) t.style.removeProperty('display');
  });
  await new Promise((r) => setTimeout(r, 300));

  // C. hover（tooltip 显示态，属于正常可见浮层）
  const box = await page.evaluate(() => {
    const r = document
      .getElementById('gev-voice-control')
      .getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await new Promise((r) => setTimeout(r, 500));
  row.hover = await measure();
  await page.mouse.move(5, 5);
  await new Promise((r) => setTimeout(r, 400));

  // D. error 态（错误托盘可见）
  await page.evaluate(() => {
    const card = document.getElementById('gev-voice-control');
    card.dataset.status = 'error';
    card.classList.remove('error-dismissed');
  });
  await new Promise((r) => setTimeout(r, 400));
  row.error = await measure();
  await page.evaluate(() => {
    const card = document.getElementById('gev-voice-control');
    card.dataset.status = 'idle';
  });
  await new Promise((r) => setTimeout(r, 300));

  // E. 可见元素位置在 before/after 之间是否完全一致（不进位、不被裁）
  const key = (v) => v.visible.map((e) => `${e.key}@${e.x},${e.y},${e.w},${e.h}`).sort();
  const a = key(row.after);
  const b = key(row.before);
  row.layoutIdentical = a.length === b.length && a.every((v, i) => v === b[i]);
  row.afterVisibleCount = a.length;
  row.beforeVisibleCount = b.length;

  report.views.push(row);
}

// 截图：常态卡片特写 + 悬停 tooltip 特写（1536x730）
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const card = document.getElementById('gev-voice-control');
  card.dataset.status = 'idle';
  document.activeElement?.blur();
});
await new Promise((r) => setTimeout(r, 600));
const clipOf = async (pad = 16) => {
  const r = await page.evaluate(() => {
    const b = document.getElementById('gev-voice-control').getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  return {
    x: Math.max(0, r.x - pad),
    y: Math.max(0, r.y - pad),
    width: Math.min(1536, r.width + pad * 2),
    height: Math.min(730, r.height + pad * 2),
  };
};
report.shotNormal = `${outDir}/voice2-${label}-normal.png`;
await page.screenshot({ path: report.shotNormal, clip: await clipOf() });

const c = await page.evaluate(() => {
  const b = document.getElementById('gev-voice-control').getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await page.mouse.move(c.x, c.y);
await new Promise((r) => setTimeout(r, 700));
report.shotHover = `${outDir}/voice2-${label}-hover.png`;
await page.screenshot({ path: report.shotHover, clip: await clipOf(30) });

fs.writeFileSync(`${outDir}/voice-overflow2-${label}.json`, JSON.stringify(report, null, 1));

const line = (v) =>
  `${v.viewport.padEnd(9)} after ${v.after.scrollWidth}/${v.after.clientWidth}  before ${v.before.scrollWidth}/${v.before.clientWidth}  hover ${v.hover.scrollWidth}/${v.hover.clientWidth}  error ${v.error.scrollWidth}/${v.error.clientWidth}  layoutIdentical=${v.layoutIdentical}  ovf=${v.after.overflowX}`;
console.log('viewport  ' + 'scrollWidth/clientWidth');
report.views.forEach((v) => console.log(line(v)));
console.log('shots:', report.shotNormal, report.shotHover);
await browser.close();
