#!/usr/bin/env node
/* 诊断：页面灰白/黑块 —— 抓 console/pageerror/DOM 状态 + 截图
   用法: node scripts/lc/_diag/blank-probe.mjs http://127.0.0.1:4174/?welcome=0 out.png */
import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = process.argv[3] || '.gev-logs/lc/_diag/blank-probe.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1348,900', '--window-position=60,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e.message).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 300)); });
page.on('requestfailed', (r) => logs.push('REQFAIL ' + r.url().slice(0, 160) + ' :: ' + (r.failure() && r.failure().errorText)));
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load', timeout: 60000 }).catch((e) => logs.push('GOTO ' + e.message));
await sleep(12000);
const state = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const gate = q('#gev-boot-gate');
  const cs = gate ? getComputedStyle(gate) : null;
  const cards = [...document.querySelectorAll('.gev-lc, [id$="-panel"], #pp-toggles, #location-bar')].slice(0, 12)
    .map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; });
  return {
    title: document.title,
    bodyText: (document.body.innerText || '').slice(0, 200),
    canvases: [...document.querySelectorAll('canvas')].map((c) => ({ id: c.id, w: c.width, h: c.height, cls: c.className })),
    gate: gate ? { cls: gate.className, opacity: cs.opacity, display: cs.display, z: cs.zIndex, pointer: cs.pointerEvents, text: (gate.innerText || '').slice(0, 120) } : null,
    hasLc: !!window.__lc, lcReady: !!(window.__lc && window.__lc.api && window.__lc.api.ready),
    hasEdge: !!window.__gevEdge, edgeCount: window.__gevEdge ? window.__gevEdge.stats().count : null,
    boot: window.__gevBoot ? Object.keys(window.__gevBoot) : null,
    ctlr: !!window.__gevMap, cards,
  };
});
const png = await page.screenshot({ encoding: 'base64' });
const fs = await import('node:fs');
fs.mkdirSync(OUT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(png, 'base64'));
console.log('URL', URL, 'load', Date.now() - t0, 'ms');
console.log(JSON.stringify(state, null, 1));
console.log('--- logs (' + logs.length + ') ---');
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
