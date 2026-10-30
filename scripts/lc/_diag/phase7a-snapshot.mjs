#!/usr/bin/env node
/* Phase7A 架构审查用一次性探针（只读）：冷启动到 interactive 后 dump
   __bootTimeline.snapshot() 的阶段/长任务/资源分组 + lc readyAt + 首屏 DOM 就绪时刻。
   用法：node _p7a_deps_probe.mjs http://127.0.0.1:4174/?welcome=0 */
import puppeteer from 'puppeteer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = process.argv[3] || '';
const profile = mkdtempSync(join(tmpdir(), 'gev-p7a-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: [
    '--no-sandbox',
    '--window-size=1372,934',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
await page.goto(`${BASE}&trace=1&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

// 等 interactive（最多 40s）
const t0 = Date.now();
let interactive = false;
for (let i = 0; i < 400; i++) {
  interactive = await page
    .evaluate(() => !!(window.__gevBoot && window.__gevBoot.interactive))
    .catch(() => false);
  if (interactive) break;
  await new Promise((r) => setTimeout(r, 100));
}
const waitMs = Date.now() - t0;

const data = await page.evaluate(() => {
  const tl = window.__bootTimeline && window.__bootTimeline.snapshot
    ? window.__bootTimeline.snapshot()
    : null;
  const g = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null;
  const lc = window.__lc && window.__lc.api ? window.__lc.api : null;
  const v = window.__gevViewer;
  const cards = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'voice-panel', 'gev-gfx-fab'];
  const present = {};
  for (const id of cards) present[id] = !!document.getElementById(id);
  const gpu = (() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
    } catch (_) {
      return null;
    }
  })();
  return {
    gpu,
    marks: tl ? tl.marks : null,
    stages: tl ? tl.stages : null,
    topStages: tl ? tl.topStages : null,
    checkpoints: tl ? tl.checkpoints : null,
    worstFrame: tl ? tl.worstFrame : null,
    worstFrameAt: tl ? tl.worstFrameAt : null,
    longTasks: tl ? tl.longTasks : null,
    longFrames: tl ? tl.longFrames.slice(-30) : null,
    resources: tl
      ? {
          count: tl.resources.count,
          mb: tl.resources.mb,
          groups: tl.resources.groups,
          slowest: tl.resources.slowest.slice(0, 12),
          latest: tl.resources.latest.slice(0, 12),
        }
      : null,
    gate: g,
    lc: lc ? { ready: lc.ready, readyAt: lc.readyAt, mounted: lc.mounted } : null,
    cardsPresent: present,
    globeShow: v && v.scene && v.scene.globe ? v.scene.globe.show : null,
    activeStack: v && v.__nothing ? null : null,
    photoreal: window.__gevPhotoreal || null,
  };
});

const out = { base: BASE, waitMs, interactive, ...data };
const text = JSON.stringify(out, null, 2);
if (OUT) writeFileSync(OUT, text);
console.log(text);
await browser.close();
