#!/usr/bin/env node
/* Phase7D2 · shader program 归因 v2：抓 createProgram 的 JS 调用栈 + 上下文尺寸，
   定位「reveal 后新编译的 program 是谁创建的」。
   用法: node scripts/lc/_diag/p7d2-shader-stack.mjs [tag] [runs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d2stk';
const RUNS = Number(process.argv[3] || 1);
const OUT = '.gev-logs/lc/phase7d2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4174/?welcome=0';

const INSTRUMENT = () => {
  const G = (window.__gstk = { t0: performance.now(), progs: [], byProg: new WeakMap(), shaders: new WeakMap(), events: [], frames: [] });
  const PN = { 0x8b82: 'LINK_STATUS', 0x8b86: 'ACTIVE_UNIFORMS', 0x8b89: 'ACTIVE_ATTRIBUTES', 0x8b84: 'INFO_LOG_LENGTH' };
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!P || P.prototype.__p7d2stk) continue;
    const proto = P.prototype;
    proto.__p7d2stk = 1;
    const oCP = proto.createProgram, oLink = proto.linkProgram, oGPP = proto.getProgramParameter;
    proto.createProgram = function () {
      const p = oCP.apply(this, arguments);
      try {
        const st = (new Error().stack || '').split('\n').slice(2, 9).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '').slice(0, 140));
        const rec = { id: G.progs.length, at: +(performance.now() - G.t0).toFixed(0), buf: [this.drawingBufferWidth, this.drawingBufferHeight], stack: st, links: 0, blocks: [], vs: null, fs: null };
        G.byProg.set(p, rec); G.progs.push(rec);
      } catch (_) {}
      return p;
    };
    const oSS = proto.shaderSource, oCS = proto.createShader, oAS = proto.attachShader;
    proto.createShader = function (type) {
      const sh = oCS.apply(this, arguments);
      try { G.shaders.set(sh, { type: type === 0x8b31 ? 'vs' : (type === 0x8b30 ? 'fs' : 'x'), len: 0, head: '' }); } catch (_) {}
      return sh;
    };
    proto.shaderSource = function (sh, src) {
      try {
        const r = G.shaders.get(sh);
        if (r) { const s = String(src); r.len = s.length; const ls = s.split('\n').filter((l) => l.trim()); r.head = ls.slice(0, 3).join(' | ').slice(0, 140); r.defines = ls.filter((l) => l.startsWith('#define')).slice(0, 8).join(',').slice(0, 200); r.src = s.slice(0, 4000); }
      } catch (_) {}
      return oSS.apply(this, arguments);
    };
    proto.attachShader = function (prog, sh) {
      try {
        const rec = G.byProg.get(prog); const s = G.shaders.get(sh);
        if (rec && s) { const o = { len: s.len, head: s.head, defines: s.defines, src: s.src }; if (s.type === 'vs') rec.vs = o; else if (s.type === 'fs') rec.fs = o; }
      } catch (_) {}
      return oAS.apply(this, arguments);
    };
    proto.linkProgram = function (p) {
      const r = oLink.apply(this, arguments);
      try { const rec = G.byProg.get(p); if (rec) rec.links += 1; } catch (_) {}
      return r;
    };
    proto.getProgramParameter = function (p, pname) {
      const t = performance.now();
      try { return oGPP.apply(this, arguments); } finally {
        const d = performance.now() - t;
        if (d >= 15) { try { const rec = G.byProg.get(p); if (rec) rec.blocks.push({ pname: PN[pname] || ('0x' + Number(pname).toString(16)), ms: +d.toFixed(1), at: +(performance.now() - G.t0).toFixed(0) }); } catch (_) {} }
      }
    };
  }
};

const rows = [];
for (let run = 1; run <= RUNS; run++) {
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
  await page.goto(`${BASE}&stk=${run}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  for (let k = 0; k < 3000; k++) {
    const v = await page.evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      return !!(g && g.interactive) || (Number.isFinite(op) && op < 0.05);
    }).catch(() => false);
    if (v) break;
    await sleep(20);
  }
  await page.evaluate(() => {
    const G = window.__gstk;
    G.frames.length = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return orig((ts) => {
        const rec = { t: performance.now(), cb: 0 };
        G.frames.push(rec);
        const s = performance.now();
        try { cb(ts); } finally { rec.cb = +(performance.now() - s).toFixed(2); }
      });
    };
    G.tRev = performance.now();
  });
  await sleep(9000);
  const dump = await page.evaluate(() => {
    const G = window.__gstk;
    const tR = performance.now();
    const snap = (window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot()) || null;
    return { tR, progs: G.progs, frames: G.frames, marks: snap ? snap.marks : null };
  });
  const tMaskGone = (dump.marks || []).find((m) => m.name === 'mask:gone')?.t ?? null;
  console.log(`run${run} progs=${dump.progs.length} maskGone=${tMaskGone}`);
  const fr = dump.frames;
  if (fr.length > 2) {
    const over = [];
    for (let i = 1; i < fr.length; i++) {
      const dt = fr[i].t - fr[i - 1].t;
      if (dt > 80) over.push({ t: +(fr[i].t - fr[0].t).toFixed(0), dt: +dt.toFixed(0), cb: fr[i].cb });
    }
    const span = (fr[fr.length - 1].t - fr[0].t) / 1000;
    console.log(`   fps=${(fr.length / span).toFixed(1)} span=${span.toFixed(1)}s over80=${over.length} worst=${Math.max(0, ...over.map((o) => o.dt))}`);
    console.log('   over=' + JSON.stringify(over.slice(0, 20)));
  }
  for (const p of dump.progs) {
    const rel = tMaskGone != null ? +(p.at - tMaskGone).toFixed(0) : null;
    console.log(`--- prog ${p.id} at=${p.at} relMaskGone=${rel} buf=${p.buf} links=${p.links} blocks=${JSON.stringify(p.blocks)}`);
    for (const s of p.stack.slice(0, 5)) console.log('      ' + s);
  }
  rows.push({ run, dump });
  await browser.close();
}
writeFileSync(`${OUT}/${TAG}-shader-stack.json`, JSON.stringify({ at: new Date().toISOString(), rows }));
console.log('WROTE ' + `${OUT}/${TAG}-shader-stack.json`);
