#!/usr/bin/env node
/* photoreal 后台加载 / 自然升级 诊断（只读观测，不改产品代码）
   ---------------------------------------------------------------------------
   取证目标（对应卡 t_910b0a14）：
     1. interactive 与 photoreal 解耦：interactive 时刻前后，3D Tiles 请求/解析
        不落在首屏关键路径（记录 __bootTimeline marks + tileset 请求起点）；
     2. 自然升级：交互 → photoreal-ready 期间，每帧中心 64×64 亮度均值/标准差
        轨迹（黑屏 mean≈0、白屏 mean≈255、跳变 = 相邻样本 |Δmean| 大）；
     3. 无 >100ms 长任务：PerformanceObserver longtask + long-animation-frame
        （LoAF 带 scripts/renderStart/styleAndLayout 归因）；
     4. 失败兜底：可选 --block=ion 屏蔽 3D Tiles 主机，验证底图保留、无弹窗。

   用法：
     node scripts/lc/_diag/photoreal-bg-audit.mjs <url> <tag> [--block=ion]
   输出：.gev-logs/lc/photoreal-bg/<tag>.json + <tag>-*.png
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ARG = process.argv[2] || 'http://127.0.0.1:4173/?welcome=0';
const TAG = process.argv[3] || 'audit';
const BLOCK = (process.argv.find((a) => a.startsWith('--block=')) || '').split('=')[1] || '';
const OUT = '.gev-logs/lc/photoreal-bg';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), `gev-pbg-${TAG}-`));
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
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /photoreal|3D Tiles/i.test(t)) {
    errors.push(`${m.type()}: ${t.slice(0, 220)}`);
  }
});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
const blocked = [];
if (BLOCK) {
  const urls = ['*://api.cesium.com/*', '*://assets.cesium.com/*', '*://*.cesium.com/*'];
  await cdp.send('Network.setBlockedURLs', { urls }).catch(() => {});
  blocked.push(...urls);
}
/* 记录 3D Tiles 相关网络请求起点（判断是否在首屏窗口内发起） */
const net = [];
page.on('request', (r) => {
  const u = r.url();
  if (/cesium\.com|googleapis|tiles|\/v1\/assets\//i.test(u)) {
    net.push({ at: Date.now(), url: u.slice(0, 140) });
  }
});

const wall0 = Date.now();
await page.goto(`${URL_ARG}${URL_ARG.includes('?') ? '&' : '?'}run=${TAG}&t=${Date.now()}`, {
  waitUntil: 'domcontentloaded',
});

/* 1) 等 interactive（遮罩 opacity<0.05 或 __gevBoot.interactive） */
let wallInteractive = null;
let navInteractive = null;
let framesTotal = 0;
for (let k = 0; k < 3000; k++) {
  const st = await page
    .evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      const tl = window.__bootTimeline;
      let navT = null;
      try {
        const s = tl && typeof tl.snapshot === 'function' ? tl.snapshot() : null;
        const mk = s && (s.marks || []).find((m) => m.name === 'gate:mask:gone');
        navT = mk ? mk.t : null;
      } catch (_) {}
      return { interactive: !!(g && g.interactive), op, navT };
    })
    .catch(() => null);
  if (st && (st.interactive || (Number.isFinite(st.op) && st.op < 0.05))) {
    wallInteractive = Date.now() - wall0;
    navInteractive = st.navT;
    break;
  }
  await sleep(25);
}

/* 2) 交互后：装 LoAF/longtask 观察器 + 每帧中心亮度轨迹 + rAF 帧间隔 */
await page.evaluate(() => {
  const acc = {
    t0: performance.now(),
    loaf: [],
    longtask: [],
    frames: [],
    lum: [],
    done: false,
  };
  window.__pbg = acc;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        acc.loaf.push({
          s: +e.startTime.toFixed(1),
          d: +e.duration.toFixed(1),
          block: e.blockingDuration != null ? +e.blockingDuration.toFixed(1) : null,
          render: e.renderStart != null ? +(e.renderStart - e.startTime).toFixed(1) : null,
          style: e.styleAndLayoutStart != null ? +(e.styleAndLayoutStart - e.startTime).toFixed(1) : null,
          scripts: (e.scripts || []).slice(0, 4).map((s) => ({
            name: (s.invoker || s.sourceFunctionName || '?') + ' @' + (s.sourceURL || '').split('/').pop(),
            dur: +s.duration.toFixed(1),
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        acc.longtask.push({ s: +e.startTime.toFixed(1), d: +e.duration.toFixed(1), n: e.name });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) {}
  let i = 0;
  const tick = (ts) => {
    acc.frames.push(+ts.toFixed(1));
    if (ts - acc.t0 < 40000) requestAnimationFrame(tick);
    else acc.done = true;
  };
  requestAnimationFrame(tick);
  /* 中心 64×64 亮度轨迹：每 3 帧读一次默认 framebuffer */
  const v = window.__gevViewer;
  const scene = v && v.scene;
  let gl = null;
  try {
    const ctx = scene && scene.context;
    gl = (ctx && (ctx._gl || (typeof ctx.getGl === 'function' ? ctx.getGl() : null))) || null;
  } catch (_) {}
  acc.lumInstalled = !!gl;
  if (gl && scene && scene.postRender) {
    const W = 64,
      H = 64;
    const buf = new Uint8Array(W * H * 4);
    scene.postRender.addEventListener(() => {
      i += 1;
      if (i % 3 !== 0) return;
      try {
        const dpr = window.devicePixelRatio || 1;
        const cw = gl.drawingBufferWidth,
          ch = gl.drawingBufferHeight;
        const x = Math.max(0, Math.round(cw / 2 - (W * dpr) / 2));
        const y = Math.max(0, Math.round(ch / 2 - (H * dpr) / 2));
        gl.readPixels(x, y, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let sum = 0,
          sum2 = 0,
          n = 0;
        for (let p = 0; p < buf.length; p += 4) {
          const l = 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2];
          sum += l;
          sum2 += l * l;
          n += 1;
        }
        const mean = sum / n;
        acc.lum.push({
          t: +performance.now().toFixed(1),
          mean: +mean.toFixed(1),
          std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1),
          ts: +window.__gevViewer.scene.frameState.frameNumber,
        });
      } catch (e) {
        acc.lumErr = String(e && e.message);
      }
    });
  }
});

/* 3) 交互后立刻截图 + 轮询 photoreal 阶段 */
const shots = {};
const shot = async (name) => {
  const p = join(OUT, `${TAG}-${name}.png`);
  try {
    const b64 = await page.screenshot({ encoding: 'base64' });
    writeFileSync(p, Buffer.from(b64, 'base64'));
    shots[name] = p;
  } catch (_) {}
};
await sleep(300);
await shot('interactive');

const phases = [];
let ready = null;
for (let k = 0; k < 400; k++) {
  const st = await page
    .evaluate(() => {
      const p = window.__gevPhotoreal || null;
      const s = window.__gevViewer ? window.__gevViewer.scene : null;
      return {
        p,
        globeShow: s ? s.globe.show : null,
        tiles: (() => {
          const prims = s && s.primitives;
          if (!prims) return null;
          let n = 0;
          for (let i = 0; i < prims.length; i++) {
            const q = prims.get(i);
            if (q && q.initialTilesLoaded) n += 1;
          }
          return n;
        })(),
        stack: window.__godsEyeView?.mapStackController?.getState?.()?.activeId ?? null,
      };
    })
    .catch(() => null);
  if (st) {
    const key = JSON.stringify([st.p && st.p.phase, st.p && st.p.ready, st.globeShow, st.tiles, st.stack]);
    if (!phases.length || phases[phases.length - 1].key !== key) {
      phases.push({
        key,
        wall: Date.now() - wall0,
        at: st.p && st.p.at,
        phase: st.p && st.p.phase,
        ready: st.p && st.p.ready,
        globeShow: st.globeShow,
        tilesInScene: st.tiles,
        stack: st.stack,
      });
      if (st.p && st.p.phase) await shot(`ph-${String(phases.length).padStart(2, '0')}-${st.p.phase}`);
    }
    if (st.p && st.p.ready) {
      ready = { wall: Date.now() - wall0, ...st };
      break;
    }
  }
  await sleep(200);
}
await sleep(300);
await shot('ready+0.3s');
await sleep(1700);
await shot('ready+2s');

/* 4) 收数 */
const data = await page.evaluate(() => {
  const a = window.__pbg;
  const tl = window.__bootTimeline;
  const g = window.__gevBoot;
  const f = a ? a.frames : [];
  const deltas = [];
  for (let i = 1; i < f.length; i++) deltas.push({ t: +(f[i] - a.t0).toFixed(1), dt: +(f[i] - f[i - 1]).toFixed(1) });
  const win = (from, to) => deltas.filter((d) => d.t >= from && d.t <= to);
  const stat = (arr) => {
    if (!arr.length) return null;
    const span = arr[arr.length - 1].t - arr[0].t + arr[0].dt;
    return {
      frames: arr.length,
      fps: span ? +((arr.length / span) * 1000).toFixed(1) : null,
      worst: +Math.max(...arr.map((d) => d.dt)).toFixed(1),
      over100: arr.filter((d) => d.dt >= 100).map((d) => ({ t: d.t, dt: d.dt })),
      over50: arr.filter((d) => d.dt >= 50 && d.dt < 100).length,
    };
  };
  const lum = a ? a.lum : [];
  return {
    loaf: a ? a.loaf : [],
    longtask: a ? a.longtask : [],
    fps0_10: stat(win(0, 10000)),
    fps10_25: stat(win(10000, 25000)),
    lumInstalled: a && a.lumInstalled,
    lumErr: a && a.lumErr,
    lum: lum.map((x) => ({ t: +(x.t - (a ? a.t0 : 0)).toFixed(0), mean: x.mean, std: x.std })),
    marks: (() => {
      try {
        const s = tl && typeof tl.snapshot === 'function' ? tl.snapshot() : null;
        return Object.fromEntries(((s && s.marks) || []).map((m) => [m.name, m.t]));
      } catch (_) {
        return null;
      }
    })(),
    gate: g && g.snapshot ? { reason: g.snapshot().reason, longFramesOver100: (g.snapshot().longFrames || []).filter((x) => x.dt >= 100).length } : null,
    photoreal: window.__gevPhotoreal || null,
    interactive: !!(g && g.interactive),
    loaderText: (document.querySelector('#loading-screen .loader-status') || {}).textContent || null,
    maskOpacity: (() => {
      const el = document.getElementById('loading-screen');
      return el ? parseFloat(getComputedStyle(el).opacity) : null;
    })(),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"],.modal,.error-popup')).length,
  };
});
await browser.close();

const out = {
  tag: TAG,
  url: URL_ARG,
  blocked,
  wallInteractive,
  navInteractive,
  phases,
  shots,
  netCesium: net.map((n) => ({ d: n.at - wall0, url: n.url })),
  errors: errors.slice(0, 20),
  ...data,
};
writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify(out, null, 1));

/* 摘要 */
const lumVals = data.lum.map((x) => x.mean);
const jumps = [];
for (let i = 1; i < data.lum.length; i++) {
  const d = Math.abs(data.lum[i].mean - data.lum[i - 1].mean);
  if (d > 25) jumps.push({ t: data.lum[i].t, d: +d.toFixed(1), from: data.lum[i - 1].mean, to: data.lum[i].mean });
}
console.log(
  JSON.stringify(
    {
      tag: TAG,
      wallInteractive,
      navInteractive,
      photorealReadyAt: ready && ready.wall,
      photoreal: data.photoreal,
      phases: phases.map((p) => `${p.phase || '-'}@${p.wall}ms globe=${p.globeShow} stack=${p.stack}`),
      fps0_10: data.fps0_10 && { fps: data.fps0_10.fps, worst: data.fps0_10.worst, over100: data.fps0_10.over100.length },
      fps10_25: data.fps10_25 && { fps: data.fps10_25.fps, worst: data.fps10_25.worst, over100: data.fps10_25.over100.length },
      over100List: [...(data.fps0_10?.over100 || []), ...(data.fps10_25?.over100 || [])],
      loaf: data.loaf.filter((l) => l.d >= 100),
      longtaskCount: data.longtask.length,
      lum: { n: data.lum.length, min: lumVals.length ? Math.min(...lumVals) : null, max: lumVals.length ? Math.max(...lumVals) : null, jumps },
      marks: data.marks,
      loaderText: data.loaderText,
      dialogs: data.dialogs,
      errors: data.errors,
    },
    null,
    1,
  ),
);
