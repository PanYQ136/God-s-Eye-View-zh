#!/usr/bin/env node
/* 诊断：scene 展开为什么落在 y=94（谁把它推上去的） */
import puppeteer from 'puppeteer';

const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  const r = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (r) break;
  await sleep(500);
}
await sleep(7000);
const out = await page.evaluate(() => {
  const st = window.__lc.snapshot;
  const prot = st.protected.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) }));
  return { viewport: st.viewport, safe: st.protected && null, prot, minis: st.minis };
});
console.log('VIEWPORT', JSON.stringify(out.viewport));
console.log('PROTECTED', JSON.stringify(out.prot, null, 1));
console.log('MINIS', JSON.stringify(out.minis['scene-panel']), JSON.stringify(out.minis['data-panel']));
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ACTIVATE', id: 'scene-panel' }));
await sleep(1200);
const res = await page.evaluate(() => ({
  phase: window.__lc.api.phases()['scene-panel'],
  box: window.__lc.result.boxes['scene-panel'],
  viol: window.__lc.violations,
  pushes: window.__lc.result.pushes,
}));
console.log('RESULT', JSON.stringify(res, null, 1));
await browser.close();
