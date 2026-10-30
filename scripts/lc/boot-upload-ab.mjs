#!/usr/bin/env node
/* 冷启动 A/B：瓦片预取（tilewarm）开/关 × WebGL shader/纹理上传去重审计
   ----------------------------------------------------------------------------
   目的（卡片 t_ff183910）：
     ① 量化 `tilewarm` 预取对 `tileset:added → view:content` / fetch / 总 loading 的影响；
     ② 数清启动期 compileShader / linkProgram / texImage2D / texSubImage2D 的
        总数、唯一数、重复数与主线程耗时 —— 「无重复上传」要有可复算的证据。
        纹理按三类分开：alloc（pixels=null，只分配存储）、buf（ArrayBufferView，
        按数据哈希判重）、src（TexImageSource，按对象身份判重 —— 同一 ImageBitmap
        被二次上传才是真重复）。

   方法：每次全新 Chrome profile（空 HTTP 缓存）+ Network.clearBrowserCache，
   在页面脚本之前注入 WebGL 钩子（evaluateOnNewDocument），25ms 轮询遮罩消失做
   独立墙钟，取 window.__bootTimeline.snapshot()，收遮罩后再等 N ms 记瓦片爆发。

   用法:
     node scripts/lc/boot-upload-ab.mjs <tag> <runs> <url> [sleepAfterMs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'ab';
const RUNS = Number(process.argv[3] || 3);
const BASE = process.argv[4] || 'http://127.0.0.1:4173/?welcome=0';
const AFTER = Number(process.argv[5] || 3500);
/* A/B 轴：argv[6] = "label=<query suffix>,label2=<...>"（默认对比 tilewarm 开/关） */
const SPEC = (process.argv[6] || 'off=&tilewarm=0,on=')
  .split(',')
  .map((s) => {
    const i = s.indexOf('=');
    return { label: s.slice(0, i), suffix: s.slice(i + 1) };
  });
const OUT = '.gev-logs/lc/boot';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(1);
};

/* 页内 WebGL 上传审计（在任何页面脚本之前执行） */
const AUDIT_HOOK = `(() => {
  const T0 = performance.now();
  const H = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
  const byteH = (u8) => { let h = 0x811c9dc5; const n = Math.min(u8.length, 262144); for (let i = 0; i < n; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
  const A = { t0: T0, shaders: [], links: [], tex: [] };
  window.__uploadAudit = A;
  const srcOf = new WeakMap();
  const srcId = new WeakMap();
  let nextSrcId = 1;
  const idOf = (o) => { if (!o || typeof o !== 'object') return 0; let v = srcId.get(o); if (v === undefined) { v = nextSrcId++; srcId.set(o, v); } return v; };
  const push = (arr, row) => { if (arr.length < 60000) arr.push(row); };
  for (const Ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctor || !Ctor.prototype) continue;
    const P = Ctor.prototype;
    const ss = P.shaderSource, cs = P.compileShader, lp = P.linkProgram;
    const ti = P.texImage2D, ts = P.texSubImage2D;
    P.shaderSource = function (sh, src) { try { srcOf.set(sh, String(src)); } catch (_) {} return ss.call(this, sh, src); };
    P.compileShader = function (sh) {
      const t = performance.now();
      let type = 0, src = '';
      try { src = srcOf.get(sh) || ''; type = this.getShaderParameter(sh, this.SHADER_TYPE) || 0; } catch (_) {}
      const r = cs.call(this, sh);
      push(A.shaders, { h: H(src), len: src.length, type, ms: +(performance.now() - t).toFixed(2), at: +(t - T0).toFixed(1) });
      return r;
    };
    P.linkProgram = function (prog) {
      const t = performance.now();
      let key = '';
      try { const shs = this.getAttachedShaders(prog) || []; key = shs.map((s) => H(srcOf.get(s) || '')).join('+'); } catch (_) {}
      const r = lp.call(this, prog);
      push(A.links, { key, ms: +(performance.now() - t).toFixed(2), at: +(t - T0).toFixed(1) });
      return r;
    };
    const note = (kind, args, ms, t, ctx) => {
      // texImage2D 9 参: (target, level, ifmt, w, h, border, fmt, type, pixels)
      // texImage2D 6 参: (target, level, ifmt, fmt, type, source)
      // texSubImage2D 9 参: (target, level, x, y, w, h, fmt, type, pixels)
      // texSubImage2D 7 参: (target, level, x, y, fmt, type, source)
      let w = 0, h = 0, fmt = null, type = null, dataH = 0, bytes = 0, cls = 'alloc';
      try {
        if (args.length >= 9) {
          fmt = args[2]; w = args[3]; h = args[4]; type = args[7];
          const px = args[8];
          if (px && px.BYTES_PER_ELEMENT) { bytes = px.byteLength; dataH = byteH(new Uint8Array(px.buffer, px.byteOffset, px.byteLength)); cls = 'buf'; }
        } else if (kind === 'texImage2D' && args.length === 6) {
          fmt = args[2]; type = args[4];
          const s = args[5];
          if (s && typeof s === 'object') { w = s.displayWidth || s.width || 0; h = s.displayHeight || s.height || 0; dataH = idOf(s); bytes = (w * h * 4) | 0; cls = 'src'; }
        } else if (kind === 'texSubImage2D' && args.length === 7) {
          fmt = args[4]; type = args[5];
          const s = args[6];
          if (s && typeof s === 'object') { w = s.displayWidth || s.width || 0; h = s.displayHeight || s.height || 0; dataH = idOf(s); bytes = (w * h * 4) | 0; cls = 'src'; }
        }
      } catch (_) {}
      let texId = 0;
      try { texId = idOf(ctx.getParameter(ctx.TEXTURE_BINDING_2D)); } catch (_) {}
      push(A.tex, { k: kind, c: cls, w, h, fmt, type, bytes, dataH, texId, ms: +ms.toFixed(2), at: +(t - T0).toFixed(1) });
    };
    P.texImage2D = function (...args) { const t = performance.now(); const r = ti.apply(this, args); note('texImage2D', args, performance.now() - t, t, this); return r; };
    P.texSubImage2D = function (...args) { const t = performance.now(); const r = ts.apply(this, args); note('texSubImage2D', args, performance.now() - t, t, this); return r; };
  }
})();`;

const agg = (rows, keyOf) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const cur = m.get(k) || { k, n: 0, ms: 0, bytes: 0 };
    cur.n += 1;
    cur.ms += r.ms || 0;
    cur.bytes = Math.max(cur.bytes, r.bytes || 0);
    m.set(k, cur);
  }
  const dups = [...m.values()].filter((x) => x.n > 1).sort((a, b) => b.n - a.n);
  return {
    total: rows.length,
    unique: m.size,
    dupCalls: dups.reduce((s, x) => s + (x.n - 1), 0),
    totalMs: +rows.reduce((s, r) => s + (r.ms || 0), 0).toFixed(1),
    totalMb: +(rows.reduce((s, r) => s + (r.bytes || 0), 0) / 1048576).toFixed(1),
    dupMs: +dups.reduce((s, x) => s + (x.ms / x.n) * (x.n - 1), 0).toFixed(1),
    topDups: dups.slice(0, 8).map((x) => ({ k: x.k, n: x.n, ms: +x.ms.toFixed(1), bytes: x.bytes })),
  };
};

const runs = [];

for (let i = 1; i <= RUNS; i++) {
  for (const { label: mode, suffix: modeSuffix } of SPEC) {
    const profile = mkdtempSync(join(tmpdir(), `gev-ab-${mode}-`));
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
    await page.evaluateOnNewDocument(AUDIT_HOOK);
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable').catch(() => {});
    await cdp.send('Network.clearBrowserCache').catch(() => {});
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});

    const suffix = modeSuffix;
    const wall0 = Date.now();
    await page.goto(`${BASE}${suffix}&ab=${mode}${i}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

    let wallReveal = null;
    for (let k = 0; k < 1600; k++) {
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
    await sleep(AFTER);

    const snap = await page
      .evaluate(() => {
        const tl = window.__bootTimeline;
        const gate = window.__gevBoot;
        const A = window.__uploadAudit;
        return {
          timeline: tl && typeof tl.snapshot === 'function' ? tl.snapshot() : null,
          gate: gate && typeof gate.snapshot === 'function' ? gate.snapshot() : null,
          gpu: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null,
          warm: window.__gevTileWarm ? window.__gevTileWarm.stats() : null,
          shaderCache: window.__gevShaderCache ? { installed: window.__gevShaderCache.installed, shaderSources: window.__gevShaderCache.shaderSources, compiles: window.__gevShaderCache.compiles, compileMs: +window.__gevShaderCache.compileMs.toFixed(1), reuses: window.__gevShaderCache.reuses, savedMs: +window.__gevShaderCache.savedMs.toFixed(1), hitKeys: window.__gevShaderCache.hitKeys } : null,
          audit: A ? { shaders: A.shaders, links: A.links, tex: A.tex } : null,
          resources: performance.getEntriesByType('resource').map((e) => ({
            name: e.name.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 110),
            start: +e.startTime.toFixed(1),
            end: +e.responseEnd.toFixed(1),
            bytes: e.transferSize || 0,
            cached: e.transferSize === 0 && (e.decodedBodySize || 0) > 0,
          })),
        };
      })
      .catch((e) => ({ error: String(e.message || e) }));

    const tl = snap.timeline;
    const cp = Object.fromEntries((tl?.checkpoints || []).map((c) => [c.name, c.t]));
    const tiles = (snap.resources || []).filter((r) => /3dtiles|root\.json|\.glb/i.test(r.name));
    const tex = snap.audit?.tex || [];
    const audit = snap.audit
      ? {
          shaders: agg(snap.audit.shaders, (r) => `${r.type}:${r.h}:${r.len}`),
          links: agg(snap.audit.links, (r) => r.key),
          alloc: agg(tex.filter((r) => r.c === 'alloc'), (r) => `${r.k}:${r.w}x${r.h}:${r.fmt}:${r.type}`),
          uploadBuf: agg(tex.filter((r) => r.c === 'buf'), (r) => `${r.k}:${r.w}x${r.h}:${r.fmt}:${r.type}:${r.dataH}`),
          uploadSrc: agg(tex.filter((r) => r.c === 'src'), (r) => `${r.k}:src#${r.dataH}`),
          redundantSameTarget: agg(tex.filter((r) => r.c !== 'alloc'), (r) => `${r.k}:tex#${r.texId}:${r.dataH}`),
          texSub: agg(tex.filter((r) => r.k === 'texSubImage2D'), (r) => `${r.c}:${r.w}x${r.h}:${r.dataH}`),
          texAllMs: +tex.reduce((s, r) => s + (r.ms || 0), 0).toFixed(1),
        }
      : null;
    const row = {
      run: i,
      mode,
      wallRevealMs: wallReveal,
      gpu: snap.gpu,
      errors,
      total: tl?.total ?? null,
      warm: snap.warm,
      shaderCache: snap.shaderCache,
      checkpoints: cp,
      stages: tl?.stages || null,
      tiles: {
        count: tiles.length,
        cached: tiles.filter((t) => t.cached).length,
        firstAt: tiles.length ? Math.min(...tiles.map((t) => t.start)) : null,
        lastEnd: tiles.length ? Math.max(...tiles.map((t) => t.end)) : null,
      },
      audit,
      gateReason: snap.gate?.reason || null,
    };
    runs.push(row);
    const f = (x) => (x ? `${x.total}/${x.unique} dup${x.dupCalls} ${x.totalMs}ms` : '-');
    console.log(
      `run${i}/${mode}: wall=${wallReveal}ms total=${row.total} tiles=${row.tiles.count}(cached ${row.tiles.cached}) ` +
        `shader[${f(audit?.shaders)}] link[${f(audit?.links)}] alloc[${f(audit?.alloc)}] buf[${f(audit?.uploadBuf)}] src[${f(audit?.uploadSrc)}] ` +
        `gpu=${/RTX 3060/.test(snap.gpu?.renderer || '') ? 'RTX3060' : snap.gpu?.renderer}`,
    );
    await browser.close();
  }
}

const pick = (mode) => runs.filter((r) => r.mode === mode);
const stageOf = (rs, name) => {
  const vals = rs
    .map((r) => {
      const cp = r.checkpoints || {};
      const a = cp['tileset:added'];
      const b = cp['gate:view:content'];
      const f1 = cp['tileset:fetch:begin'];
      const f2 = cp['tileset:fetch:end'];
      if (name === 'added→content') return Number.isFinite(a) && Number.isFinite(b) ? +(b - a).toFixed(1) : null;
      if (name === 'fetch') return Number.isFinite(f1) && Number.isFinite(f2) ? +(f2 - f1).toFixed(1) : null;
      if (name === 'maskGone') return cp['gate:mask:gone'] ?? null;
      return null;
    })
    .filter(Number.isFinite);
  return { median: median(vals), values: vals, n: vals.length };
};
const summarize = (mode) => {
  const rs = pick(mode);
  const col = (fn) => rs.map(fn);
  return {
    mode,
    runs: rs.length,
    wall: { median: median(rs.map((r) => r.wallRevealMs)), values: rs.map((r) => r.wallRevealMs) },
    total: { median: median(rs.map((r) => r.total)), values: rs.map((r) => r.total) },
    fetch: stageOf(rs, 'fetch'),
    addedToContent: stageOf(rs, 'added→content'),
    maskGone: stageOf(rs, 'maskGone'),
    tiles: rs.map((r) => ({ count: r.tiles.count, cached: r.tiles.cached })),
    audit: {
      shaders: col((r) => (r.audit ? { t: r.audit.shaders.total, u: r.audit.shaders.unique, d: r.audit.shaders.dupCalls, ms: r.audit.shaders.totalMs } : null)),
      links: col((r) => (r.audit ? { t: r.audit.links.total, u: r.audit.links.unique, d: r.audit.links.dupCalls, ms: r.audit.links.totalMs } : null)),
      alloc: col((r) => (r.audit ? { t: r.audit.alloc.total, d: r.audit.alloc.dupCalls, ms: r.audit.alloc.totalMs } : null)),
      uploadBuf: col((r) => (r.audit ? { t: r.audit.uploadBuf.total, u: r.audit.uploadBuf.unique, d: r.audit.uploadBuf.dupCalls, ms: r.audit.uploadBuf.totalMs } : null)),
      uploadSrc: col((r) => (r.audit ? { t: r.audit.uploadSrc.total, u: r.audit.uploadSrc.unique, d: r.audit.uploadSrc.dupCalls, ms: r.audit.uploadSrc.totalMs } : null)),
      texSub: col((r) => (r.audit ? { t: r.audit.texSub.total, d: r.audit.texSub.dupCalls, ms: r.audit.texSub.totalMs } : null)),
      redundantSameTarget: col((r) => (r.audit ? { t: r.audit.redundantSameTarget.total, u: r.audit.redundantSameTarget.unique, d: r.audit.redundantSameTarget.dupCalls, ms: r.audit.redundantSameTarget.totalMs } : null)),
      texAllMs: col((r) => (r.audit ? r.audit.texAllMs : null)),
    },
    shaderCache: col((r) => r.shaderCache || null),
  };
};

const summary = { tag: TAG, url: BASE, afterMs: AFTER, runs, byMode: {} };
for (const { label } of SPEC) summary.byMode[label] = summarize(label);
const labels = SPEC.map((s) => s.label);
const file = join(OUT, `prefetch-ab-${TAG}.json`);
writeFileSync(file, JSON.stringify(summary, null, 1));
console.log('\n=== SUMMARY (median) ===');
for (const label of labels) {
  const s = summary.byMode[label];
  console.log(
    `${label}: wall ${s.wall.median}ms total ${s.total.median}ms maskGone ${s.maskGone.median}ms fetch ${s.fetch.median}ms added→content ${s.addedToContent.median}ms`,
  );
  console.log(`   tiles ${JSON.stringify(s.tiles)}`);
  console.log(`   shaderCache ${JSON.stringify(s.shaderCache)}`);
  for (const [name, rows] of Object.entries(s.audit)) console.log(`   ${name}: ${JSON.stringify(rows)}`);
}
const d = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? +(a - b).toFixed(0) : null);
if (labels.length >= 2) {
  const a = summary.byMode[labels[0]];
  const b = summary.byMode[labels[1]];
  console.log(
    `\nΔ(${labels[1]}−${labels[0]}): wall ${d(b.wall.median, a.wall.median)}ms total ${d(b.total.median, a.total.median)}ms ` +
      `maskGone ${d(b.maskGone.median, a.maskGone.median)}ms fetch ${d(b.fetch.median, a.fetch.median)}ms ` +
      `added→content ${d(b.addedToContent.median, a.addedToContent.median)}ms`,
  );
}
console.log(`json → ${file}`);
