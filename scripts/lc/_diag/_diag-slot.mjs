#!/usr/bin/env node
/* 诊断：槽位缓存是否被毒化（T4 后 scene 的 mini 变成 94） */
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
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 160)); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  const r = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (r) break;
  await sleep(500);
}
await sleep(7000);

const dump = async (tag) => {
  const d = await page.evaluate(() => ({
    minis: window.__lc.snapshot.minis,
    phases: window.__lc.api.phases(),
    boxes: window.__lc.result.boxes,
    viol: window.__lc.violations,
    staged: [...document.querySelectorAll('#lc-stage > .gev-lc')].map((e) => e.id),
    phs: [...document.querySelectorAll('.gev-lc-placeholder')].map((e) => [e.dataset.lcFor, Math.round(e.getBoundingClientRect().y)]),
    rail: [...document.querySelectorAll('#left-panel-stack > *')].map((e) => [e.id || e.className, Math.round(e.getBoundingClientRect().y), Math.round(e.getBoundingClientRect().height)]),
  }));
  console.log(tag, JSON.stringify(d, null, 1));
};

await dump('BOOT');
const step = async (id, tag) => {
  await page.evaluate((x) => window.__lc.api.dispatch({ type: 'ACTIVATE', id: x }), id);
  await sleep(900);
  await dump(tag);
};
await step('data-panel', 'DATA-OPEN');
await step('data-panel', 'DATA-CLOSE');
await step('scene-panel', 'SCENE-OPEN');
await step('scene-panel', 'SCENE-CLOSE');
await step('data-panel', 'DATA-OPEN2');
await sleep(400);
const res = await page.evaluate(() => ({
  minis: window.__lc.snapshot.minis,
  boxes: window.__lc.result.boxes,
  viol: window.__lc.violations,
}));
console.log('AFTER', JSON.stringify(res, null, 1));
await browser.close();
