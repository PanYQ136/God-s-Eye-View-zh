#!/usr/bin/env node
/* 诊断：gev-edge-lens 是否 boot 成功 + 控制台全过程 */
import puppeteer from 'puppeteer';
const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 160)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 160)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
let prev = 0;
for (const t of [3000, 6000, 10000, 15000, 22000, 30000, 40000]) {
  await sleep(t - prev); prev = t;
  const s = await page.evaluate(() => {
    let e = null; try { e = window.__gevEdge.stats(); } catch (er) { e = { noEdge: String(er) }; }
    return {
      lens: window.__gevEdgeLens || null, edge: e && { frames: e.frames, count: e.count, canvas: e.canvas, err: e.err, tex: e.tex, fps: e.fps },
      viewer: !!window.__gevViewer, panel: !!document.getElementById('data-panel'),
      lcReady: !!(window.__lc && window.__lc.api && window.__lc.api.ready),
    };
  }).catch((e) => ({ evalErr: String(e).slice(0, 120) }));
  console.log(t + 'ms ' + JSON.stringify(s));
}
console.log('LOGS ' + JSON.stringify(logs.filter((l) => /gev-edge|error|Error/.test(l)).slice(0, 12)));
await browser.close();
