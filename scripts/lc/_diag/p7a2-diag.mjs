#!/usr/bin/env node
/* Phase7A2 诊断：① 冷启动 404 资源真凶 ② LC mounted / 卡片可点 / 遮罩 时间线
   用法: node scripts/lc/_diag/p7a2-diag.mjs [runs] [base] */
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNS = Number(process.argv[2] || 2);
const BASE = process.argv[3] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7a2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
for (let i = 1; i <= RUNS; i++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-p7a2diag-`));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile,
    args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
      '--ignore-gpu-blocklist', '--force_high_performance_gpu',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
    protocolTimeout: 300000,
    defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  const bad = [];
  const failed = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push({ s: r.status(), url: r.url().slice(0, 220) }); });
  page.on('requestfailed', (r) => failed.push({ err: r.failure()?.errorText, url: r.url().slice(0, 220) }));
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  const wall0 = Date.now();
  await page.goto(`${BASE}&run=${i}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

  // 每 20ms 采样直到 12s
  const samples = [];
  let releaseAt = null;
  for (let k = 0; k < 620; k++) {
    const s = await page.evaluate(() => {
      const lc = window.__lc && window.__lc.api;
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const dp = document.getElementById('data-panel');
      const h = dp && dp.querySelector('.panel-header, header, .lc-head');
      const r = h && h.getBoundingClientRect();
      const hit = r && r.width > 10 ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) : null;
      return {
        t: +performance.now().toFixed(0),
        mounted: !!(lc && lc.mounted),
        lcReady: !!(lc && lc.ready),
        inputReleased: !!(g && g.inputReleased),
        interactive: !!(g && g.interactive),
        maskOp: el ? +(parseFloat(getComputedStyle(el).opacity) || 0).toFixed(2) : null,
        maskPE: el ? getComputedStyle(el).pointerEvents : null,
        phase: lc && lc.phases ? lc.phases()['data-panel'] : null,
        hitEl: hit ? (hit.id || hit.className || hit.tagName).toString().slice(0, 60) : null,
      };
    }).catch(() => null);
    if (!s) { await sleep(20); continue; }
    samples.push(s);
    if (s.inputReleased && releaseAt == null) releaseAt = Date.now() - wall0;
    if (s.interactive && s.t > 11000) break;
    await sleep(20);
  }
  const tl = await page.evaluate(() => window.__bootTimeline?.snapshot?.() ?? null).catch(() => null);
  const boot = await page.evaluate(() => window.__gevBoot?.snapshot?.() ?? null).catch(() => null);
  const gpu = await page.evaluate(() => {
    try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
      return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch (_) { return null; }
  });
  const first = (pred) => { const s = samples.find(pred); return s ? s.t : null; };
  rows.push({
    run: i,
    wallRelease: releaseAt,
    firstMounted: first((s) => s.mounted),
    firstHitCard: first((s) => s.hitEl && s.hitEl.includes('panel')),
    firstMaskPEauto: first((s) => s.maskPE === 'auto'),
    firstReleasedState: first((s) => s.inputReleased),
    firstInteractive: first((s) => s.interactive),
    badResp: bad.slice(0, 12),
    failed: failed.slice(0, 8),
    boot: boot ? { inputReleasedAt: boot.inputReleasedAt, interactiveAt: boot.interactiveAt, decideAt: boot.decideAt, ready: boot.ready, starts: boot.startedAt, frames: boot.frames } : null,
    marks: (boot?.marks || []).map((m) => `${m.t}:${m.name}`),
    stages: tl?.stages || null,
    gpu,
  });
  writeFileSync(join(OUT, `diag-${i}.json`), JSON.stringify({ row: rows[i - 1], samples: samples.slice(0, 400) }, null, 1));
  console.log(JSON.stringify(rows[i - 1]));
  await browser.close();
}
writeFileSync(join(OUT, 'diag-summary.json'), JSON.stringify(rows, null, 1));
