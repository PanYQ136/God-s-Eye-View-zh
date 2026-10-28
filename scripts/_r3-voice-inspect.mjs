#!/usr/bin/env node
/** _r3-voice-inspect.mjs — 看 gev-voice-control 的 DOM 结构 / 点击行为，判断 caseD 的 ok:false 是否探针口径问题 */
import puppeteer from 'puppeteer';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);
const info = await page.evaluate(() => {
  const v = document.getElementById('gev-voice-control');
  const r = v.getBoundingClientRect();
  const kids = [...v.querySelectorAll('*')].slice(0, 40).map((e) => {
    const b = e.getBoundingClientRect();
    return { tag: e.tagName, cls: String(e.className || '').slice(0, 40), rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] };
  });
  return { cls: String(v.className), rect: [r.x, r.y, r.width, r.height], collapsed: v.classList.contains('collapsed'), kids };
});
console.log(JSON.stringify(info, null, 1).slice(0, 4000));
// 真实点击语音卡标题区，看几何是否变化
const before = await page.evaluate(() => { const r = document.getElementById('gev-voice-control').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
const pt = await page.evaluate(() => { const r = document.getElementById('gev-voice-control').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + 10)]; });
await page.mouse.move(pt[0], pt[1]); await sleep(60); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
const after = await page.evaluate(() => { const r = document.getElementById('gev-voice-control').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
console.log('voice click', pt, 'before', before, 'after', after);
await browser.close();
