#!/usr/bin/env node
/**
 * qa-voice-overflow.mjs —— 语音卡 #gev-voice-control 横向溢出审计
 * 用法: node scripts/qa-voice-overflow.mjs <url> <label>
 * 输出: evidence/lg-glass-shots/p0/voice-overflow-<label>.json + voice-card-<label>.png
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const label = process.argv[3] || 'before';
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
    '--window-size=1536,730',
    '--proxy-server=http://127.0.0.1:7890',
    '--proxy-bypass-list=127.0.0.1;localhost',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => document.getElementById('gev-voice-control'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1500));
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

const data = await page.evaluate(() => {
  const card = document.getElementById('gev-voice-control');
  if (!card) return { error: 'no card' };
  const cs = getComputedStyle(card);
  const cr = card.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
  const contentRight = cr.left + padL + card.clientWidth; // 内容盒右边界
  const kids = [];
  for (const el of card.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const relLeft = r.left - (cr.left + padL);
    const relRight = r.right - (cr.left + cr.width - padR);
    kids.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + '' || '',
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      position: s.position,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      offsetW: el.offsetWidth,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      relLeft: Math.round(relLeft * 100) / 100,
      overflowRight: Math.round((r.right - contentRight) * 100) / 100,
      text: (el.textContent || '').trim().slice(0, 28),
    });
  }
  // 只保留越界或宽度超过 clientWidth 的
  const offenders = kids
    .filter((k) => k.overflowRight > 0.5 || k.offsetW > card.clientWidth + 1 || k.scrollW > card.clientWidth + 1)
    .sort((a, b) => b.overflowRight - a.overflowRight);
  return {
    card: {
      clientWidth: card.clientWidth,
      clientHeight: card.clientHeight,
      scrollWidth: card.scrollWidth,
      scrollHeight: card.scrollHeight,
      offsetWidth: card.offsetWidth,
      rectW: Math.round(cr.width * 100) / 100,
      rectH: Math.round(cr.height * 100) / 100,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      position: cs.position,
      classes: card.className,
      inlineStyle: card.getAttribute('style') || '',
      padding: cs.padding,
    },
    offenders: offenders.slice(0, 25),
    all: kids,
  };
});

const shotPath = `${outDir}/voice-card-${label}.png`;
const card = await page.$('#gev-voice-control');
if (card) {
  const box = await card.boundingBox();
  if (box) {
    await page.screenshot({
      path: shotPath,
      clip: {
        x: Math.max(0, box.x - 14),
        y: Math.max(0, box.y - 14),
        width: Math.min(1536, box.width + 28),
        height: Math.min(730, box.height + 28),
      },
    });
  }
}

const out = { url, label, at: new Date().toISOString(), ...data, shot: shotPath };
if (data.all) {
  fs.writeFileSync(`${outDir}/voice-overflow-${label}.json`, JSON.stringify(out, null, 1));
}
console.log(JSON.stringify({ card: out.card, offenders: out.offenders, shot: shotPath }, null, 1));
await browser.close();
