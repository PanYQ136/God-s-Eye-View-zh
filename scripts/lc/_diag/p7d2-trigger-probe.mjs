#!/usr/bin/env node
/* Phase7D2 · 触发器实验：steay 之后分别改 resolutionScale / globe MSE / requestRenderMode，
   看哪些操作会「重新创建并链接 shader program」（>30ms 的 LINK_STATUS）。
   用法: node scripts/lc/_diag/p7d2-trigger-probe.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d2trig';
const OUT = '.gev-logs/lc/phase7d2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4174/?welcome=0';

const INSTRUMENT = () => {
  const G = (window.__gp2 = { t0: performance.now(), progs: 0, links: [], ctxs: [] });
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!P || P.prototype.__p7d2trig) continue;
    const proto = P.prototype;
    proto.__p7d2trig = 1;
    const oCP = proto.createProgram, oGPP = proto.getProgramParameter;
    proto.createProgram = function () {
      G.progs += 1;
      return oCP.apply(this, arguments);
    };
    proto.getProgramParameter = function (p, pname) {
      const t = performance.now();
      try { return oGPP.apply(this, arguments); } finally {
        const d = performance.now() - t;
        if (d >= 30 && pname === 0x8b82) G.links.push({ at: +(performance.now() - G.t0).toFixed(0), ms: +d.toFixed(0) });
      }
    };
  }
};

const steps = [
  { name: 'steady-before', do: null, wait: 4000 },
  { name: 'res-0.75', do: `(() => { window.__gevViewer.resolutionScale = 0.75; })()`, wait: 4000 },
  { name: 'res-0.85', do: `(() => { window.__gevViewer.resolutionScale = 0.85; })()`, wait: 4000 },
  { name: 'globeMSE-6', do: `(() => { window.__gevViewer.scene.globe.maximumScreenSpaceError = 6; })()`, wait: 4000 },
  { name: 'globeMSE-2', do: `(() => { window.__gevViewer.scene.globe.maximumScreenSpaceError = 2; })()`, wait: 4000 },
  { name: 'rrm-on', do: `(() => { window.__gevViewer.scene.requestRenderMode = true; })()`, wait: 3000 },
  { name: 'rrm-off', do: `(() => { window.__gevViewer.scene.requestRenderMode = false; })()`, wait: 3000 },
];

const dir = mkdtempSync(join(tmpdir(), `gev-${TAG}-`));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: dir,
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(INSTRUMENT);
await page.goto(`${BASE}&trig=1&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
for (let k = 0; k < 3000; k++) {
  const v = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.interactive)).catch(() => false);
  if (v) break;
  await sleep(30);
}
const out = [];
for (const s of steps) {
  const before = await page.evaluate(() => ({ p: window.__gp2.progs, l: window.__gp2.links.length, t: performance.now() }));
  if (s.do) await page.evaluate(s.do).catch((e) => console.log('do-fail', s.name, String(e).slice(0, 80)));
  await sleep(s.wait);
  const after = await page.evaluate(() => ({ p: window.__gp2.progs, l: window.__gp2.links.length, t: performance.now(), links: window.__gp2.links.slice(-12), rs: window.__gevViewer.resolutionScale, cw: window.__gevViewer.canvas.width }));
  out.push({ step: s.name, newProgs: after.p - before.p, newLinks: after.l - before.l, links: after.links.slice(-6), rs: after.rs, cw: after.cw, dt: Math.round(after.t - before.t) });
  console.log(`${s.name}: +progs=${out[out.length - 1].newProgs} +links>=30ms=${out[out.length - 1].newLinks} lastLinks=${JSON.stringify(after.links.slice(-4))} rs=${after.rs} cw=${after.cw}`);
}
await page.close();
await browser.close();
writeFileSync(`${OUT}/${TAG}-trigger.json`, JSON.stringify({ at: new Date().toISOString(), out }, null, 1));
console.log('WROTE ' + `${OUT}/${TAG}-trigger.json`);
