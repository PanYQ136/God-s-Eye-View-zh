#!/usr/bin/env node
/* 逐步复刻 adapter.contentHeight，打印每一步的 scrollHeight */
import puppeteer from 'puppeteer';
const URL = 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(8000);
const out = await page.evaluate(() => {
  const el = document.getElementById('location-bar');
  const log = [];
  const snap = (tag) => log.push({ tag, sh: el.scrollHeight, ch: el.clientHeight, h: Math.round(el.getBoundingClientRect().height), inline: el.style.height, cls: el.className, phase: el.dataset.lcPhase });
  snap('初始(open)');
  const st = el.style;
  const save = { width: st.width, height: st.height, position: st.position, visibility: st.visibility, left: st.left, top: st.top, overflowY: st.overflowY };
  st.width = '476px'; snap('width=476');
  st.height = 'auto'; snap('height=auto');
  st.position = 'fixed'; snap('position=fixed');
  st.left = '-99999px'; snap('left=-99999');
  st.top = '0px'; snap('top=0');
  st.visibility = 'hidden'; snap('visibility=hidden');
  st.overflowY = 'visible'; snap('overflowY=visible');
  /* 再等一帧看是否被 renderer 回写 */
  const hImmediate = el.scrollHeight;
  Object.assign(st, save);
  return { log, hImmediate, save };
});
console.log(JSON.stringify(out.log, null, 1));
console.log('立即读 scrollHeight =', out.hImmediate);
await browser.close();
