#!/usr/bin/env node
/** _rev2-voiceoverlap.mjs — 复现：dock 卡(control-panel) + 右栏卡(pp) 同时展开时，
 *  dock 溢出的语音 mini 卡压住右栏 mini 卡 header（材质改动无关，纯几何） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/rev2-accept');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8500);
const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const e = document.getElementById(id);
    const h = e.querySelector('.panel-header, .pp-header-row, .dock-header, .location-toolbar-label') || e;
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.x + r.width * 0.35), y: Math.round(r.y + r.height / 2) };
  }, id);
  await page.mouse.move(p.x, p.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up();
  await sleep(1400);
  return p;
};
const rects = () => page.evaluate(() => {
  const g = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)]; };
  const out = {};
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-voice-button']) out[id] = g(id);
  const el = document.getElementById('global-context-panel');
  const h = el.querySelector('.panel-header') || el;
  const r = h.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  out.globalHeaderHit = hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 30) : null;
  out.globalHeaderHitOwner = hit && hit.closest('[id]') ? hit.closest('[id]').id : null;
  return out;
});
const a = await clickHeader('control-panel');
const b = await clickHeader('pp-toggles');
const state = await rects();
await page.screenshot({ path: path.join(OUT, 'voice-overlap.png') });
console.log(JSON.stringify({ controlClick: a, ppClick: b, state }, null, 1));
fs.writeFileSync(path.join(OUT, 'voice-overlap.json'), JSON.stringify({ controlClick: a, ppClick: b, state }, null, 1));
await browser.close();
