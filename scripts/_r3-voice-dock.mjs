#!/usr/bin/env node
/**
 * _r3-voice-dock.mjs — dock 溢出语音卡（gev-voice-control）专项
 *  · 语音卡没有 .panel-header，之前的 hitProbe 对它恒 false（探针口径问题）
 *  · 这里用「卡片矩形顶部中心」做命中/点击：真实鼠标点一次展开、再点一次收起
 *  · 同时验证「dock 展开 + 右栏展开」组合下语音卡不与任何卡重叠、右栏 header 仍 own=true
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const W = 1536, H = 730;
const OUT = path.resolve('.gev-logs/r3-t829');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const RIGHT = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
const DOCK = ['location-bar', 'control-panel', 'gev-voice-control'];
const out = {};
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0 };
  for (const t of ['pointerdown', 'click']) document.addEventListener(t, (e) => { const o = window.__rv; if (t === 'pointerdown') { o.down++; if (e.isTrusted) o.downT++; } else { o.click++; if (e.isTrusted) o.clickT++; } }, true);
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7500);
const rects = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) { const r = document.getElementById(id).getBoundingClientRect(); o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; }
  return o;
}, CARDS);
const clickHeaderOf = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const SEL = '.panel-header, .pp-header-row, .panel-title, .pp-header-label, .location-toolbar-label';
    for (const h of el.querySelectorAll(SEL)) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]]) {
        const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
        const e = document.elementFromPoint(x, y);
        const hh = e && e.closest ? e.closest(SEL) : null;
        if (hh && el.contains(hh) && (e.closest('.gev-lc') || {}).id === id) return { x, y };
      }
    }
    return null;
  }, id);
  if (!p) return false;
  await page.mouse.move(p.x, p.y); await sleep(50); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(950);
  return true;
};
const voicePt = () => page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  const r = el.getBoundingClientRect();
  const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + 10);
  const e = document.elementFromPoint(x, y);
  return { x, y, hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 30) : '', owner: e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null };
});
const overlapsOf = (R) => {
  const ids = CARDS.filter((i) => i !== 'gev-gfx-fab');
  const o = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = R[ids[i]], b = R[ids[j]];
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 1 && iy > 1) o.push({ a: ids[i], b: ids[j], ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
  }
  return o;
};
const rightOwn = () => page.evaluate((IDS) => {
  const res = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    const h = el.querySelector('.panel-header, .pp-header-row, .panel-title, .pp-header-label');
    const r = h.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    const e = document.elementFromPoint(x, y);
    res[id] = { owner: e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null, own: ((e.closest('.gev-lc') || {}).id || null) === id };
  }
  return res;
}, RIGHT);

// 基线
out.baseline = await rects();
out.voiceHitAtBaseline = await voicePt();

// 先开 control，再开 cctv（reviewer 的确定性复现）
out.openControl = await clickHeaderOf('control-panel'); await sleep(1200);
out.afterControl = await rects();
out.openCctv = await clickHeaderOf('cctv-panel'); await sleep(1400);
out.afterCctv = await rects();
out.overlapsAfterCctv = overlapsOf(out.afterCctv);
out.rightOwnAfterCctv = await rightOwn();
out.voiceHit = await voicePt();

// 真实点语音卡顶部 → 展开
const vp = await voicePt();
await page.mouse.move(vp.x, vp.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(1400);
out.afterVoiceOpen = await rects();
out.overlapsAfterVoiceOpen = overlapsOf(out.afterVoiceOpen);
out.rightOwnAfterVoiceOpen = await rightOwn();
await page.screenshot({ path: path.join(OUT, 'G1-voice-expanded-dock-right.png') });

// 再点一次（此时卡已展开，取它的顶部条靠上位置）→ 收起
const vp2 = await page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  const r = el.getBoundingClientRect();
  const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + 8);
  const e = document.elementFromPoint(x, y);
  return { x, y, owner: e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null, hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 28) : '' };
});
await page.mouse.move(vp2.x, vp2.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(1400);
out.collapseClick = vp2;
out.afterVoiceCollapse = await rects();
out.overlapsAfterVoiceCollapse = overlapsOf(out.afterVoiceCollapse);
out.pointerTrust = await page.evaluate(() => window.__rv);
await page.screenshot({ path: path.join(OUT, 'G2-voice-collapsed.png') });
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(OUT, 'voice-dock.json'), JSON.stringify(out, null, 2));
await browser.close();
