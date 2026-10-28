#!/usr/bin/env node
/** _r3-voice-collapse.mjs — 语音卡展开后能不能用真实鼠标收起？逐个候选点试 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);
const rect = () => page.evaluate(() => { const r = document.getElementById('gev-voice-control').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
console.log('mini', JSON.stringify(await rect()));
const vp = await page.evaluate(() => { const r = document.getElementById('gev-voice-control').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 12) }; });
await page.mouse.move(vp.x, vp.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(1400);
console.log('expanded', JSON.stringify(await rect()));
console.log('children', JSON.stringify(await page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  return [...el.querySelectorAll('*')].slice(0, 14).map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className || '').slice(0, 26), r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; });
})));
// 逐个候选点试收起
const pts = await page.evaluate(() => {
  const r = document.getElementById('gev-voice-control').getBoundingClientRect();
  const out = [];
  for (const dy of [6, 12, 20, 30, 44, 60]) out.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + dy) });
  return out;
});
for (const p of pts) {
  const hit = await page.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + String(e.className || '').slice(0, 26) : ''; }, p.x, p.y);
  await page.mouse.move(p.x, p.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(1200);
  const now = await rect();
  console.log('click', JSON.stringify(p), 'hit', hit, '=>', JSON.stringify(now), now[2] <= 150 ? 'COLLAPSED' : 'still-open');
  if (now[2] <= 150) break;
}
await browser.close();
