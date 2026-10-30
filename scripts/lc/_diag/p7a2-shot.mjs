#!/usr/bin/env node
/* Phase7A2：输入放行瞬间取证（遮罩只盖地图、卡片可见未被挡）
   node scripts/lc/_diag/p7a2-shot.mjs [outPrefix] */
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = '.gev-logs/lc/phase7a2';
const PREFIX = process.argv[2] || 'release';
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: mkdtempSync(join(tmpdir(), 'gev-p7a2shot-')),
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 120000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  window.__hits = [];
  const step = () => {
    const g = window.__gevBoot;
    if (g && g.inputReleased && !window.__hitDone) {
      window.__hitDone = true;
      for (const id of ['data-panel', 'scene-panel', 'location-bar', 'control-panel']) {
        const el = document.getElementById(id);
        if (!el) { window.__hits.push({ id, missing: true }); continue; }
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + Math.min(24, r.width / 2)), Math.round(r.top + Math.min(12, r.height / 2)));
        window.__hits.push({ id, occludedBy: hit ? (hit.id || hit.className || hit.tagName).toString().slice(0, 60) : null, sameCard: !!(hit && (hit === el || el.contains(hit))) });
      }
      window.__hitAt = +performance.now().toFixed(0);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
await page.goto(`http://127.0.0.1:4174/?welcome=0&shot=${Date.now()}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__hitDone === true', { timeout: 30000 }).catch(() => {});
const png = await page.screenshot({ encoding: 'base64' });
writeFileSync(join(OUT, `${PREFIX}-card-hit.png`), Buffer.from(png, 'base64'));
console.log(JSON.stringify(await page.evaluate(() => ({ at: window.__hitAt, hits: window.__hits, boot: window.__gevBoot?.snapshot?.().inputReleasedAt }))));
await browser.close();
