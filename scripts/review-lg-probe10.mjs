#!/usr/bin/env node
/** review-lg-probe10.mjs —— 亮底（纯白地图）下语音卡与顶部芯片的样式/对比度根因 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { errors: [] };
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  const cands = [...document.querySelectorAll('canvas')].filter((c) => c.id !== 'gev-gl-glass');
  const mapCv = cands.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const gl = mapCv.getContext('webgl2') || mapCv.getContext('webgl');
  try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {}
  if (gl) { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
});
await new Promise((r) => setTimeout(r, 2000));

out.dom = await page.evaluate(() => {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el), b = el.getBoundingClientRect();
    return {
      tag: el.tagName, cls: String(el.className).slice(0, 90), id: el.id,
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
      bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 80), backdrop: cs.backdropFilter,
      color: cs.color, opacity: cs.opacity, zIndex: cs.zIndex,
      lumAttr: el.getAttribute('data-gev-lum'),
    };
  };
  const voice = document.getElementById('gev-voice-control');
  const shell = voice && (voice.closest('.gev-lc') || voice);
  const labels = voice ? [...voice.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && e.offsetParent).slice(0, 8).map((e) => ({ text: e.textContent.trim().slice(0, 14), ...pick(e) })) : [];
  const top = document.querySelector('#top-center-actions');
  const chipTexts = top ? [...top.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && e.offsetParent).slice(0, 10).map((e) => ({ text: e.textContent.trim().slice(0, 14), ...pick(e) })) : [];
  return {
    voiceShell: pick(shell), voiceInner: pick(voice.querySelector('[class$="-inner"]')), voiceLabels: labels,
    isGevLc: !!(shell && shell.classList.contains('gev-lc')),
    shellClasses: shell ? shell.className : null,
    lcVars: shell ? ['--gev-std-bg-bright', '--gev-std-bg', '--gev-card-bg'].map((v) => [v, getComputedStyle(shell).getPropertyValue(v)]) : null,
    top: pick(top), chips: chipTexts,
    htmlLum: document.documentElement.dataset.gevGlassLum,
  };
});
await page.screenshot({ path: path.join(OUT, 'p10-white-full.png') });
const r = await page.evaluate(() => { const v = document.getElementById('gev-voice-control'); const b = v.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });
if (r && r.w > 4) {
  const buf = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  fs.writeFileSync(path.join(OUT, 'p10-voice.png'), await sharp(buf).resize({ width: r.w * 2 }).png().toBuffer());
  out.voiceRect = r;
}
out.errors = out.errors.slice(0, 6);
fs.writeFileSync(path.join(OUT, 'review-probe10.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
