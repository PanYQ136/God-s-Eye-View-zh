#!/usr/bin/env node
/**
 * _rv2-t829-occl.mjs — reviewer probe E: deterministic repro of the dock-spill
 * voice card covering a right-rail mini header (acceptance #2 "7 headers real
 * click" / #5 "不遮挡"), driven only by real mouse clicks.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1500)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);

const clickCard = async (id) => {
  const pt = await page.evaluate((id) => {
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
  }, id);
  await page.mouse.move(pt[0], pt[1]); await sleep(90);
  await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(900);
  return pt;
};

const geo = () => page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'gev-voice-control', 'location-bar'];
  const st = {};
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) { st[id] = null; continue; }
    const r = el.getBoundingClientRect();
    st[id] = { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], open: !el.classList.contains('collapsed') };
  }
  // hit test each right-rail header at its own centre
  const hits = {};
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
    const el = document.getElementById(id); if (!el) continue;
    const r = el.getBoundingClientRect();
    const p = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))];
    const e = document.elementFromPoint(p[0], p[1]);
    const o = e && e.closest('.gev-lc');
    hits[id] = { pt: p, hit: e && (e.tagName + '.' + String(e.className || '').slice(0, 24)), owner: o && o.id, own: !!(e && el.contains(e)) };
  }
  return { st, hits };
});

// scenario 1: open cctv (right rail) first, then open dock control-panel
await clickCard('cctv-panel');
put('after_cctv', await geo());
await clickCard('control-panel');
put('after_dock_on_cctv', await geo());
await page.screenshot({ path: path.join(OUT, 'E-occl-cctv-dock.png') });

// try clicking the global header now (real mouse at its centre) and report where it lands
const globalClick = await page.evaluate(() => {
  const el = document.getElementById('global-context-panel'); const r = el.getBoundingClientRect();
  const p = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))];
  const e = document.elementFromPoint(p[0], p[1]);
  const o = e && e.closest('.gev-lc');
  return { pt: p, hit: e && (e.tagName + '.' + String(e.className || '').slice(0, 26)), owner: o && o.id, own: !!(e && el.contains(e)) };
});
await page.mouse.move(globalClick.pt[0], globalClick.pt[1]); await sleep(80);
await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(800);
const afterGlobalClick = await page.evaluate(() => {
  const g = document.getElementById('global-context-panel');
  return { globalOpen: !g.classList.contains('collapsed'), openCards: [...document.querySelectorAll('.gev-lc')].filter((c) => !c.classList.contains('collapsed')).map((c) => c.id) };
});
put('global_click_result', { ...globalClick, ...afterGlobalClick });
await page.screenshot({ path: path.join(OUT, 'E-occl-after-global-click.png') });

// scenario 2 (reverse): collapse all, open dock first then a right-rail card
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(9000);
await clickCard('control-panel');
put('dock_first', await geo());
await clickCard('cctv-panel');
put('then_cctv', await geo());
await page.screenshot({ path: path.join(OUT, 'E-occl-dock-then-cctv.png') });

fs.writeFileSync(path.join(OUT, 'E-occl.json'), JSON.stringify(R, null, 1));
await browser.close();
