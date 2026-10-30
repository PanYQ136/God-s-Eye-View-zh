#!/usr/bin/env node
/* Phase7D2 · shader program 归因：reveal 后哪个 program 的 getProgramParameter 阻塞了主线程
   记录 createProgram/linkProgram/attachShader/getProgramParameter/getShaderParameter，
   按 program 对象聚合：link 次数、每次查询的 pname 与耗时、shader 源码指纹。
   用法: node scripts/lc/_diag/p7d2-shader-attr.mjs [tag] [runs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d2sh';
const RUNS = Number(process.argv[3] || 1);
const OUT = '.gev-logs/lc/phase7d2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4174/?welcome=0';

const INSTRUMENT = () => {
  const G = (window.__gsh = { t0: performance.now(), progs: [], byProg: new WeakMap(), shaders: new WeakMap(), events: [], err: null });
  const PNAME = { 0x8b82: 'LINK_STATUS', 0x8b80: 'DELETE_STATUS', 0x8b86: 'ACTIVE_UNIFORMS', 0x8b89: 'ACTIVE_ATTRIBUTES', 0x8b84: 'INFO_LOG_LENGTH', 0x8b87: 'ACTIVE_UNIFORM_MAX_LENGTH', 0x8b8a: 'ACTIVE_ATTRIBUTE_MAX_LENGTH', 0x8b83: 'VALIDATE_STATUS' };
  const sig = (src) => {
    if (!src) return null;
    const s = String(src);
    const defines = s.split('\n').filter((l) => l.startsWith('#define')).slice(0, 12).join(',');
    return { len: s.length, head: s.split('\n').filter((l) => l.trim()).slice(0, 2).join(' | ').slice(0, 120), defines: defines.slice(0, 200) };
  };
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!P) continue;
    const proto = P.prototype;
    const oCreate = proto.createProgram;
    const oLink = proto.linkProgram;
    const oAttach = proto.attachShader;
    const oGPP = proto.getProgramParameter;
    const oGSP = proto.getShaderParameter;
    const oShaderSource = proto.shaderSource;
    if (!proto.__p7d2) {
      proto.__p7d2 = 1;
      proto.createProgram = function () {
        const p = oCreate.apply(this, arguments);
        try { G.byProg.set(p, { id: G.progs.length, created: +(performance.now() - G.t0).toFixed(0), canvas: this.canvas ? (this.canvas.id || this.canvas.className || 'canvas') : '?', vs: null, fs: null, links: 0, params: [] }); G.progs.push(G.byProg.get(p)); } catch (_) {}
        return p;
      };
      proto.createShader = (function (o) {
        return function (type) {
          const sh = o.apply(this, arguments);
          try { G.shaders.set(sh, { type: type === 0x8b31 ? 'vs' : (type === 0x8b30 ? 'fs' : 'other'), sig: null }); } catch (_) {}
          return sh;
        };
      })(proto.createShader);
      proto.shaderSource = function (sh, src) {
        try { const r = G.shaders.get(sh); if (r) r.sig = sig(src); } catch (_) {}
        return oShaderSource.apply(this, arguments);
      };
      proto.attachShader = function (prog, sh) {
        try {
          const rec = G.byProg.get(prog); const s = G.shaders.get(sh);
          if (rec && s) { if (s.type === 'vs') rec.vs = s.sig; else if (s.type === 'fs') rec.fs = s.sig; }
        } catch (_) {}
        return oAttach.apply(this, arguments);
      };
      proto.linkProgram = function (prog) {
        const t = performance.now();
        try { const r = oLink.apply(this, arguments); const rec = G.byProg.get(prog); if (rec) rec.links += 1; return r; } finally {
          const d = +(performance.now() - t).toFixed(2);
          G.events.push({ t: +(performance.now() - G.t0).toFixed(0), kind: 'link', ms: d, prog: G.byProg.get(prog)?.id ?? null });
        }
      };
      proto.getProgramParameter = function (prog, pname) {
        const t = performance.now();
        try { return oGPP.apply(this, arguments); } finally {
          const d = performance.now() - t;
          const rec = G.byProg.get(prog);
          const name = PNAME[pname] || ('0x' + Number(pname).toString(16));
          if (rec) rec.params.push({ pname: name, ms: +d.toFixed(2), at: +(performance.now() - G.t0).toFixed(0) });
          if (d >= 20) G.events.push({ t: +(performance.now() - G.t0).toFixed(0), kind: 'gpp', pname: name, ms: +d.toFixed(1), prog: rec?.id ?? null });
        }
      };
      proto.getShaderParameter = function (sh, pname) {
        const t = performance.now();
        try { return oGSP.apply(this, arguments); } finally {
          const d = performance.now() - t;
          if (d >= 20) G.events.push({ t: +(performance.now() - G.t0).toFixed(0), kind: 'gsp', pname: PNAME[pname] || ('0x' + Number(pname).toString(16)), ms: +d.toFixed(1) });
        }
      };
    }
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
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  const wall0 = Date.now();
  await page.goto(`${BASE}&sh=${run}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  let revealWall = null;
  for (let k = 0; k < 3000; k++) {
    const v = await page.evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      return !!(g && g.interactive) || (Number.isFinite(op) && op < 0.05);
    }).catch(() => false);
    if (v) { revealWall = Date.now() - wall0; break; }
    await sleep(20);
  }
  const tReveal = await page.evaluate(() => {
    window.__gsh.tReveal = performance.now();
    window.__gsh.events.length = 0;
    return performance.now();
  });
  const samples = [];
  for (let k = 0; k < 16; k++) {
    await sleep(700);
    const s = await page.evaluate(() => {
      const p = window.__gevPhotoreal || null;
      const v = window.__gevViewer || null;
      return { t: +((performance.now() - window.__gsh.tReveal) / 1000).toFixed(2), photo: !!(p && p.ready), globe: v ? v.scene.globe.show : null };
    }).catch(() => null);
    if (s) samples.push(s);
  }
  const dump = await page.evaluate(() => {
    const G = window.__gsh;
    const progs = G.progs.map((p) => ({ id: p.id, createdRel: +(p.created - G.tReveal).toFixed(0), canvas: p.canvas, links: p.links, vs: p.vs, fs: p.fs, params: p.params.filter((x) => x.at >= G.tReveal) })).filter((p) => p.params.length || p.createdRel > -200);
    const snap = (window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot()) || null;
    return { progs, events: G.events, marks: snap ? snap.marks : null };
  });
  console.log(`run${run} reveal=${revealWall} progs=${dump.progs.length} events>=20ms=${dump.events.length}`);
  for (const e of dump.events.slice(0, 25)) console.log('   ev', JSON.stringify(e));
  rows.push({ run, revealWall, samples, dump });
  await browser.close();
}
writeFileSync(`${OUT}/${TAG}-shader-attr.json`, JSON.stringify({ at: new Date().toISOString(), rows }));
console.log('WROTE ' + `${OUT}/${TAG}-shader-attr.json`);
