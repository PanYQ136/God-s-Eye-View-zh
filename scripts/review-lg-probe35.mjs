#!/usr/bin/env node
/**
 * review-lg-probe35.mjs —— 第六轮复核 · Contract lens（reviewer 专用、只读）
 *  A) 滚动容器细查：哪一个是 overflow != visible 且真的溢出，是否渲染出可见滚动条（截图裁切 + offsetWidth-clientWidth + ::-webkit-scrollbar 计算值）
 *  B) 黑字细查：只统计「有自有文本 + 已绘制（像素有墨迹）」的元素，color 相对亮度 < 0.06 才计数
 *  C) 一圈边：卡壳 border 四边宽度 / box-shadow inset 层数；卡内是否有额外 border/inset 环
 *  D) WebGL context loss
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r6rev';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 150)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(14000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await sleep(2600);

const out = { probe: 'review-lg-probe35', errors };

out.scrollDetail = await page.evaluate(() => {
  const res = [];
  for (const shell of document.querySelectorAll('.gev-lc')) {
    for (const e of shell.querySelectorAll('*')) {
      const s = getComputedStyle(e);
      const ov = e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2;
      if (!ov || e.matches('input,textarea')) continue;
      if (s.overflowY === 'visible' && s.overflowX === 'visible') continue;
      const r = e.getBoundingClientRect();
      res.push({
        card: (shell.closest('[id]') || shell).id, cls: String(e.className).slice(0, 60), tag: e.tagName,
        overflow: s.overflowX + '/' + s.overflowY, scrollH: e.scrollHeight, clientH: e.clientHeight,
        scrollW: e.scrollWidth, clientW: e.clientWidth, barW: e.offsetWidth - e.clientWidth, barH: e.offsetHeight - e.clientHeight,
        scrollbarWidth: s.scrollbarWidth, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        text: (e.textContent || '').trim().slice(0, 40)
      });
    }
  }
  // ::-webkit-scrollbar 是否被隐藏
  const rules = [];
  for (const sh of document.styleSheets) {
    let rs = [];
    try { rs = sh.cssRules || []; } catch (e) { continue; }
    for (const r of rs) if (r.selectorText && /scrollbar/.test(r.selectorText)) rules.push(r.selectorText + ' { ' + r.style.cssText.slice(0, 90) + ' }');
  }
  return { list: res, scrollbarCss: rules.slice(0, 12) };
});

/* 黑字细查：只算自有文本 + 已绘制 */
const textTargets = await page.evaluate(() => {
  const out = [];
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  for (const el of document.querySelectorAll('.gev-lc *, #top-center-actions *')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || el.offsetParent === null) continue;
    if (eff(el) < 0.15) continue;
    const c = getComputedStyle(el).color.match(/rgba?\((\d+), (\d+), (\d+)/);
    out.push({ text: own.slice(0, 14), color: getComputedStyle(el).color, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
  }
  return out;
});
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const blackText = [];
for (const t of textTargets) {
  const buf = await page.screenshot({ clip: { x: t.rect.x, y: t.rect.y, width: Math.max(2, t.rect.w), height: Math.max(2, t.rect.h) } });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let mx = 0;
  for (let i = 0; i < data.length; i += info.channels) { const L = 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]); if (L > mx) mx = L; }
  const m = t.color.match(/rgba?\((\d+), (\d+), (\d+)/);
  const declL = m ? 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]) : null;
  if (declL !== null && declL < 0.06) blackText.push({ ...t, declL: +declL.toFixed(3), painted: mx > 0.02 });
}
out.textCount = textTargets.length;
out.blackTextDeclared = blackText;

/* 一圈边 */
out.ring = await page.evaluate((CARD_IDS) => {
  const layers = (shadow) => {
    if (!shadow || shadow === 'none') return { n: 0, inset: 0 };
    // 按颜色分组切分 box-shadow 列表
    const parts = shadow.split(/,(?![^(]*\))/);
    return { n: parts.length, inset: parts.filter((p) => /inset/.test(p)).length, raw: shadow.slice(0, 200) };
  };
  return CARD_IDS.map((id) => {
    const root = document.getElementById(id); if (!root) return { id, missing: true };
    const shell = root.closest('.gev-lc') || root;
    const cs = getComputedStyle(shell);
    const sh = layers(cs.boxShadow);
    const innerRings = [...shell.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e);
      const bw = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].map((k) => parseFloat(s[k]) || 0);
      const ins = /inset/.test(s.boxShadow || '');
      const r = e.getBoundingClientRect();
      const big = r.width > shell.getBoundingClientRect().width * 0.8 && r.height > 18;
      return big && (Math.max(...bw) >= 1.5 || (ins && !/0px 0px 0px/.test(s.boxShadow)));
    }).map((e) => String(e.className).slice(0, 40) + '|b=' + getComputedStyle(e).borderTopWidth + '|s=' + getComputedStyle(e).boxShadow.slice(0, 60));
    return {
      id, border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join('/'),
      shadowLayers: sh.n, shadowInset: sh.inset, shadow: sh.raw, innerRings
    };
  });
}, CARD_IDS);

out.gl = await page.evaluate(() => {
  const cv = document.getElementById('gev-gl-glass');
  let lost = null;
  try { const gl = cv.getContext('webgl2'); lost = gl ? gl.isContextLost() : 'no-gl'; } catch (e) { lost = 'err:' + e.message; }
  return { lost, stats: window.__gevGlStats ? { fps: window.__gevGlStats().fps, scale: window.__gevGlStats().scale, timerQuery: window.__gevGlStats().timerQuery } : null };
});

/* 语音卡滚动条截图 */
const vc = await page.evaluate(() => { const e = document.getElementById('gev-voice-control'); const s = e.closest('.gev-lc') || e; const r = s.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
await page.screenshot({ path: path.join(OUT, 'p35-voice.png'), clip: { x: Math.max(0, vc.x - 6), y: Math.max(0, vc.y - 6), width: vc.w + 12, height: vc.h + 12 } });
out.voiceRect = vc;

fs.writeFileSync(path.join(OUT, 'probe35.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
await browser.close();
