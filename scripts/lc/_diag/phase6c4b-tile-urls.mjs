#!/usr/bin/env node
/* 冷启动探针②：真 Chrome / RTX 3060，冷启动一次，抓
   ① 每条 3dtiles 请求的**完整 URL**（含 query 顺序）+ transferSize/deliveryType
      → 决定「预取 URL 怎么写才能命中同一个 HTTP 缓存条目」；
   ② 启动期 WebGL 侧去重现状：compileShader / linkProgram / texImage2D
      → 回答卡片里的「有没有重复 shader/link/纹理上传」。
   只观测：补丁装在新文档里，不改产品代码。

   用法: node scripts/lc/_diag/phase6c4b-tile-urls.mjs [tag] [url]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'probe';
const BASE = process.argv[3] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/prefetch';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), `gev-urls-${TAG}-`));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: [
    '--no-sandbox',
    '--window-size=1372,934',
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
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
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200));
});

/* WebGL 侧记账：在文档创建前装钩子 */
await page.evaluateOnNewDocument(() => {
  const S = (window.__gfxStats = {
    shaderSources: {},   // hash → {n, len}
    compileShader: 0,
    linkProgram: 0,
    linkBySig: {},       // program 签名 → n
    texImage2D: 0,
    texKeys: {},         // 纹理键 → n
    texBytes: 0,
    programShaders: new WeakMap(),
    shaderHash: new WeakMap(),
    imgIds: new WeakMap(),
    imgSeq: 0,
    startedAt: performance.now(),
  });
  const hashString = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i += 7) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36) + ':' + s.length;
  };
  const hashBytes = (arr) => {
    const u = arr instanceof Uint8Array ? arr : new Uint8Array(arr.buffer || arr);
    let h = 2166136261 >>> 0;
    const step = Math.max(1, Math.floor(u.length / 512));
    for (let i = 0; i < u.length; i += step) {
      h ^= u[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36) + ':' + u.length;
  };
  const wrap = (proto) => {
    if (!proto || proto.__gevWrapped) return;
    Object.defineProperty(proto, '__gevWrapped', { value: true });
    const shaderSource = proto.shaderSource;
    proto.shaderSource = function (shader, source) {
      try {
        S.shaderHash.set(shader, hashString(String(source)));
      } catch (e) {}
      return shaderSource.call(this, shader, source);
    };
    const compileShader = proto.compileShader;
    proto.compileShader = function (shader) {
      try {
        S.compileShader++;
        const h = S.shaderHash.get(shader) || 'unknown';
        S.shaderSources[h] = (S.shaderSources[h] || 0) + 1;
      } catch (e) {}
      return compileShader.call(this, shader);
    };
    const attachShader = proto.attachShader;
    proto.attachShader = function (program, shader) {
      try {
        const list = S.programShaders.get(program) || [];
        list.push(S.shaderHash.get(shader) || 'unknown');
        S.programShaders.set(program, list);
      } catch (e) {}
      return attachShader.call(this, program, shader);
    };
    const linkProgram = proto.linkProgram;
    proto.linkProgram = function (program) {
      try {
        S.linkProgram++;
        const sig = (S.programShaders.get(program) || []).sort().join('|');
        S.linkBySig[sig] = (S.linkBySig[sig] || 0) + 1;
      } catch (e) {}
      return linkProgram.call(this, program);
    };
    const texImage2D = proto.texImage2D;
    const srcKey = (src) => {
      if (src == null) return 'null';
      if (typeof src === 'number') return 'num';
      if (src instanceof ImageBitmap) {
        let id = S.imgIds.get(src);
        if (!id) {
          id = ++S.imgSeq;
          S.imgIds.set(src, id);
        }
        return 'bm#' + id;
      }
      if (src instanceof HTMLImageElement) return 'img:' + String(src.currentSrc || src.src).slice(-48);
      if (src instanceof HTMLCanvasElement) return 'canvas#' + src.width + 'x' + src.height;
      if (src instanceof ImageData) return 'imagedata:' + hashBytes(src.data);
      if (src && src.byteLength != null) return 'buf:' + hashBytes(src);
      return Object.prototype.toString.call(src);
    };
    proto.texImage2D = function (...args) {
      try {
        S.texImage2D++;
        // texImage2D(target, level, internalFormat, width, height, [border,] format, type, pixels)
        const src = args[args.length - 1];
        let w = args[3];
        let h = args[4];
        if (args.length < 9) {
          w = src && (src.width || src.videoWidth);
          h = src && (src.height || src.videoHeight);
        }
        const key = `${w}x${h}|${srcKey(src)}`;
        S.texKeys[key] = (S.texKeys[key] || 0) + 1;
        const bytes = src && src.byteLength ? src.byteLength : 0;
        S.texBytes += bytes;
      } catch (e) {}
      return texImage2D.apply(this, args);
    };
    const texSubImage2D = proto.texSubImage2D;
    proto.texSubImage2D = function (...args) {
      try {
        S.texImage2D++;
        // texSubImage2D(target, level, x, y, [width, height,] format, type, pixels)
        const src = args[args.length - 1];
        const w = args.length >= 9 ? args[4] : (src && (src.width || src.videoWidth));
        const h = args.length >= 9 ? args[5] : (src && (src.height || src.videoHeight));
        const key = `sub|${w}x${h}|${srcKey(src)}`;
        S.texKeys[key] = (S.texKeys[key] || 0) + 1;
      } catch (e) {}
      return texSubImage2D.apply(this, args);
    };
  };
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const C = window[name];
    if (C) wrap(C.prototype);
  }
});

const wall0 = Date.now();
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
let wallReveal = null;
for (let k = 0; k < 1200; k++) {
  const st = await page
    .evaluate(() => {
      const gate = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      return { interactive: !!(gate && gate.interactive), op };
    })
    .catch(() => null);
  if (st && (st.interactive || (Number.isFinite(st.op) && st.op < 0.02))) {
    wallReveal = Date.now() - wall0;
    break;
  }
  await sleep(25);
}

const snap = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource').map((e) => ({
    url: e.name,
    path: (() => {
      try {
        const u = new URL(e.name);
        return u.pathname.slice(0, 80);
      } catch (_) {
        return e.name.slice(0, 80);
      }
    })(),
    search: (() => {
      try {
        return new URL(e.name).search;
      } catch (_) {
        return '';
      }
    })(),
    host: (() => {
      try {
        return new URL(e.name).host;
      } catch (_) {
        return '';
      }
    })(),
    start: +e.startTime.toFixed(1),
    end: +e.responseEnd.toFixed(1),
    dur: +e.duration.toFixed(1),
    transferSize: e.transferSize,
    encodedBodySize: e.encodedBodySize,
    deliveryType: e.deliveryType || null,
  }));
  const s = window.__gfxStats || null;
  const dupShaders = s
    ? Object.entries(s.shaderSources).filter(([, n]) => n > 1).map(([h, n]) => ({ h, n }))
    : [];
  const dupLinks = s
    ? Object.entries(s.linkBySig).filter(([, n]) => n > 1).map(([sig, n]) => ({ sig: sig.slice(0, 60), n }))
    : [];
  const dupTex = s
    ? Object.entries(s.texKeys).filter(([, n]) => n > 1).map(([k, n]) => ({ k: k.slice(0, 90), n }))
    : [];
  return {
    resources: res,
    gfx: s
      ? {
          compileShader: s.compileShader,
          uniqueShaderSources: Object.keys(s.shaderSources).length,
          dupShaders,
          linkProgram: s.linkProgram,
          uniqueLinkSigs: Object.keys(s.linkBySig).length,
          dupLinks,
          texImage2D: s.texImage2D,
          uniqueTexKeys: Object.keys(s.texKeys).length,
          dupTex: dupTex.slice(0, 40),
          texBytes: s.texBytes,
        }
      : null,
    timeline: window.__bootTimeline ? window.__bootTimeline.snapshot() : null,
    warm: window.__gevTileWarm ? window.__gevTileWarm.stats() : null,
    gate: window.__gevBoot ? window.__gevBoot.snapshot() : null,
    gpu: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null,
    tilesetInfo: (() => {
      const v = window.__gevViewer;
      const ts = v && v.scene && v.scene.primitives && v.scene.primitives.get(0);
      if (!ts) return null;
      try {
        const out = { url: null };
        try {
          out.resourceUrl = ts.resource && ts.resource.url ? ts.resource.url.slice(0, 120) : null;
        } catch (e) {}
        return out;
      } catch (e) {
        return null;
      }
    })(),
  };
});

const shot = join(OUT, `probe-${TAG}.png`);
await page.screenshot({ path: shot }).catch(() => {});
await browser.close();

const tile = snap.resources.filter((r) => /3dtiles/.test(r.path));
const withKey = tile.filter((r) => /[?&]key=/.test(r.search));
const sessionFirst = tile.filter((r) => /\?(session=)/.test(r.search));
const keyFirst = tile.filter((r) => /\?(key=)/.test(r.search));
const cached = tile.filter((r) => r.transferSize === 0);

const report = {
  tag: TAG,
  url: BASE,
  wallRevealMs: wallReveal,
  gpu: snap.gpu,
  errors,
  timelineTotal: snap.timeline ? snap.timeline.total : null,
  timelineStages: snap.timeline ? snap.timeline.stages : null,
  tiles: {
    count: tile.length,
    withKeyParam: withKey.length,
    sessionFirst: sessionFirst.length,
    keyFirst: keyFirst.length,
    fromCache: cached.length,
    cacheHitRatePct: tile.length ? +((cached.length / tile.length) * 100).toFixed(1) : null,
    first5: tile.slice(0, 5),
    slowest: tile.slice().sort((a, b) => b.dur - a.dur).slice(0, 5),
    rootJson: tile.filter((r) => /root\.json/.test(r.path)).slice(0, 2),
  },
  warm: snap.warm,
  gfx: snap.gfx,
  gate: snap.gate
    ? {
        reason: snap.gate.reason,
        tilesetAt: snap.gate.tilesetAt,
        cineDoneAt: snap.gate.cineDoneAt,
        viewContentAt: snap.gate.viewContentAt,
        probeAtReveal: snap.gate.probeAtReveal,
        sched: snap.gate.sched,
      }
    : null,
  screenshot: shot,
};
const file = join(OUT, `tile-urls-${TAG}.json`);
writeFileSync(file, JSON.stringify(report, null, 1));

console.log('wall reveal:', wallReveal, 'ms   timeline total:', report.timelineTotal);
console.log('gpu:', snap.gpu && snap.gpu.renderer);
console.log('tiles:', tile.length, 'withKey:', withKey.length, 'sessionFirst:', sessionFirst.length, 'keyFirst:', keyFirst.length, 'fromCache:', cached.length);
console.log('root.json entries:', JSON.stringify(report.tiles.rootJson.map((r) => ({ path: r.path, search: r.search.slice(0, 40), dur: r.dur, transferSize: r.transferSize }))));
console.log('sample tile urls:');
for (const r of tile.slice(0, 3)) console.log('  ', r.host + r.path, '| search:', r.search.slice(0, 120), '| dur', r.dur, 'transferSize', r.transferSize);
console.log('GFX:', JSON.stringify(report.gfx && {
  compileShader: report.gfx.compileShader,
  uniqueShaderSources: report.gfx.uniqueShaderSources,
  dupShaders: report.gfx.dupShaders.length,
  linkProgram: report.gfx.linkProgram,
  uniqueLinkSigs: report.gfx.uniqueLinkSigs,
  dupLinks: report.gfx.dupLinks.length,
  texImage2D: report.gfx.texImage2D,
  uniqueTexKeys: report.gfx.uniqueTexKeys,
  dupTex: report.gfx.dupTex.length,
  texBytes: report.gfx.texBytes,
}));
console.log('gate:', JSON.stringify(report.gate));
console.log('warm:', JSON.stringify(report.warm));
console.log('errors:', errors.slice(0, 5));
console.log('写出:', file);
