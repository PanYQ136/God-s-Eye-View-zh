#!/usr/bin/env node
/* Phase7D2 · GPU 适配器诊断：为什么 Chrome 有时落到 Intel UHD
   用法: node scripts/lc/_diag/p7d2-gpu-probe.mjs [runs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNS = Number(process.argv[2] || 2);
const OUT = '.gev-logs/lc/phase7d2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];

for (let run = 1; run <= RUNS; run += 1) {
  const profile = mkdtempSync(join(tmpdir(), 'gev-gpuprobe-'));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile,
    args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
      '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion'],
    protocolTimeout: 120000,
    defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto('chrome://gpu', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(1500);
  const info = await page.evaluate(() => {
    const grab = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    const txt = document.body.innerText || '';
    const pick = (re) => (txt.match(re) || []).slice(0, 6);
    const lines = txt.split('\n').map((s) => s.trim()).filter(Boolean);
    return {
      gl: lines.filter((l) => /GL_RENDERER|GL_VENDOR|GL_VERSION|ANGLE|Driver vendor|Driver Version|Driver Date/i.test(l)).slice(0, 14),
      problems: lines.filter((l) => /error|disabled|crash|blocklist|software|fallback|unavailable/i.test(l)).slice(0, 20),
      featureStatus: [...document.querySelectorAll('#feature-status-list li')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).slice(0, 16),
    };
  }).catch((e) => ({ err: String(e.message) }));
  const app = await browser.newPage();
  await app.goto('http://127.0.0.1:4174/?welcome=0&gpuprobe=' + run, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(2500);
  const webgl = await app.evaluate(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: gl.getParameter(d.UNMASKED_RENDERER_WEBGL), vendor: gl.getParameter(d.UNMASKED_VENDOR_WEBGL) };
    } catch (e) { return { err: String(e.message) }; }
  }).catch((e) => ({ err: String(e.message) }));
  rows.push({ run, info, webgl });
  console.log(`run${run} webgl=${webgl.renderer || webgl.err}`);
  console.log('  features: ' + JSON.stringify(info.featureStatus));
  console.log('  gl: ' + JSON.stringify(info.gl));
  await browser.close();
  await sleep(800);
}
writeFileSync(`${OUT}/gpu-probe.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
console.log('wrote ' + OUT + '/gpu-probe.json');
