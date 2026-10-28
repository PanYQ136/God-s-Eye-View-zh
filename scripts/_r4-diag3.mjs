#!/usr/bin/env node
/** _r4-diag3.mjs — 复跑互斥序列并打印「两组都没有展开卡」的那些帧（时间戳+前后帧），定位空档来源 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const W = 1536, H = 730, URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r4-t829');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel'];
const click = async (id, wait = 800) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id); const er = el.getBoundingClientRect(); const pts = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header, .dock-tray-toggle')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
    pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(14, er.height / 2)) });
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] }; }
    return { ok: false };
  }, id);
  if (!p.ok) return false;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return true;
};
const closeAll = async () => {
  for (const id of IDS) { const o = await page.evaluate((i) => !document.getElementById(i).classList.contains('collapsed'), id); if (o) await click(id, 700); }
  await page.evaluate(() => { try { window.__gevLc.close('gev-voice-control'); } catch (e) {} });
  await sleep(900);
};
await closeAll();
await page.evaluate((IDS) => {
  window.__f = []; window.__c = []; window.__rec = true;
  IDS.forEach((id) => { const el = document.getElementById(id); new MutationObserver(() => window.__c.push({ id, t: performance.now(), col: el.classList.contains('collapsed') })).observe(el, { attributes: true, attributeFilter: ['class'] }); });
  const tick = () => { if (!window.__rec) return; window.__f.push({ t: performance.now(), s: Object.fromEntries(IDS.map((id) => [id, !document.getElementById(id).classList.contains('collapsed')])) }); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}, IDS);
const seq = [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'], ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']];
const marks = [];
for (const [a, b] of seq) {
  marks.push({ tag: 'clickA:' + a, t: await page.evaluate(() => performance.now()) }); await click(a, 800);
  marks.push({ tag: 'clickB:' + b, t: await page.evaluate(() => performance.now()) }); await click(b, 800);
  marks.push({ tag: 'clickA2:' + a, t: await page.evaluate(() => performance.now()) }); await click(a, 800);
}
const { f, c } = await page.evaluate(() => { window.__rec = false; return { f: window.__f, c: window.__c }; });
const first = f.findIndex((x) => Object.values(x.s).some(Boolean));
const zeros = f.map((x, i) => ({ i, x })).filter(({ i, x }) => i >= first && !Object.values(x.s).some(Boolean));
console.log('## frames', f.length, 'firstOpenIdx', first, 'zeroFrames', zeros.length);
zeros.forEach(({ i, x }) => {
  const near = f.slice(Math.max(0, i - 2), i + 3).map((y) => ({ t: +y.t.toFixed(0), s: Object.entries(y.s).filter(([, v]) => v).map(([k]) => k) }));
  console.log('## zero@' + i, 't=' + x.t.toFixed(0), JSON.stringify(near), 'marks:', JSON.stringify(marks.filter((m) => Math.abs(m.t - x.t) < 400).map((m) => m.tag + '@' + m.t.toFixed(0))));
});
fs.writeFileSync(path.join(OUT, 'diag3-frames.json'), JSON.stringify({ marks, frames: f.length, zeros: zeros.length }, null, 1));
await browser.close();
