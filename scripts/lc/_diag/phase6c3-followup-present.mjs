#!/usr/bin/env node
/* Phase6C3-followup · 仪器 A：稳态 >100ms 单帧（present 延迟）归因
   ── 只测量，不改产品代码、不改阈值、不截图循环（每冷启动仅 2 张 PNG 供芯片取证）。
   每个冷启动（新 profile = HTTP 缓存冷）依次采：
     W0  steady 门控（3×1s worst ≤50ms 才继续）
     W1  idle 8s  —— 裸 rAF 间隔（无 observer 回调之外的额外工作）
     W2  idle 8s  —— + LoAF 全字段（dur / blocking / renderStart / styleAndLayoutStart / scripts[]）
     W3  idle 8s  —— + 包一层 scene.render 计时（CESIUM 渲染耗时 per frame，仅本窗）
     W4  hover 8s —— 真指针停在 data-panel 卡头（同 gate 口径）+ LoAF
     W5  Cesium 渲染循环关闭 8s —— 对照：玻璃/合成层仍在，Cesium 不画
     W6  about:blank 空页 10s —— 对照：机器/驱动/合成计时器本身有没有 >100ms 单帧
   判据（写进结论，不改 gate）：
     · 若 W6/W5 也出现同量级单帧 → 与产品代码无关
     · 若 LoAF blocking=0 且 scripts 合计 <20ms 且 renderStart 迟到 → 主线程之外
     · styleAndLayoutStart 距离 renderStart 的空档 = 渲染/合成等待；renderStart→end = present
   产物：.gev-logs/lc/phase6c3/followup-present-<tag>.json (+ 每轮 2 张 PNG)
   用法：node scripts/lc/_diag/phase6c3-followup-present.mjs [runs] [tag]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const RUNS = Number(process.argv[2] || 12);
const TAG = process.argv[3] || 'p1';
const OUT = '.gev-logs/lc/phase6c3';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, VH = 774;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARGS = ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
  '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion'];

/* 页内采样内核：装一次，之后每个窗 reset 后取 */
const INSTALL = () => {
  window.__fl = { gaps: [], loaf: [], gapsAll: [], on: false };
  window.__flStart = (withRender) => {
    window.__fl.gaps = []; window.__fl.gapsAll = []; window.__fl.on = true;
    window.__fl.renderMs = [];
    if (withRender) {
      try {
        const sc = window.__gevViewer.scene;
        if (!sc.__origRender) { sc.__origRender = sc.render.bind(sc); }
        sc.render = (t) => { const a = performance.now(); sc.__origRender(t); window.__fl.renderMs.push(+(performance.now() - a).toFixed(2)); };
      } catch (e) { window.__fl.renderErr = String(e && e.message || e); }
    } else {
      try { const sc = window.__gevViewer.scene; if (sc.__origRender) sc.render = sc.__origRender; } catch (e) {}
    }
  };
  window.__flRun = (ms) => new Promise((res) => {
    const t0 = performance.now(); let last = t0; let done = false;
    const finish = () => { if (done) return; done = true; res(); };
    const tick = (ts) => {
      const dt = ts - last; const at = +last.toFixed(1); last = ts;
      if (dt > 0) { window.__fl.gaps.push(+dt.toFixed(2)); window.__fl.gapsAll.push([at, +dt.toFixed(2)]); }
      if (ts - t0 < ms) requestAnimationFrame(tick); else finish();
    };
    requestAnimationFrame(tick);
    /* 兜底：窗口被遮挡/后台时 rAF 会被节流甚至停摆，绝不能让采样器永久挂住 */
    setTimeout(finish, ms + 5000);
  }).then(() => {
    window.__fl.on = false;
    const g = window.__fl.gaps.slice().sort((a, b) => a - b);
    const q = (p) => g.length ? +g[Math.min(g.length - 1, Math.floor(g.length * p))].toFixed(2) : null;
    const big = window.__fl.gapsAll.filter((x) => x[1] >= 100);
    const over60 = window.__fl.gapsAll.filter((x) => x[1] >= 60).length;
    const rm = window.__fl.renderMs || [];
    const rms = rm.slice().sort((a, b) => a - b);
    return {
      vis: document.visibilityState, hasFocus: document.hasFocus(),
      n: g.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), p999: q(0.999), worst: g.length ? g[g.length - 1] : null,
      over60, over100: big.length,
      big: big.slice(0, 20),
      fps: q(0.5) ? +(1000 / q(0.5)).toFixed(1) : null,
      render: rm.length ? { n: rm.length, p50: rms[Math.floor(rms.length * 0.5)], p99: rms[Math.floor(rms.length * 0.99)] || rms[rms.length - 1], worst: rms[rms.length - 1] } : null,
    };
  });
  /* LoAF 全字段（buffered:false；只收 dur>=50 的条目，callback 极轻） */
  try {
    window.__loaf = [];
    window.__loafOb = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 50) continue;
        window.__loaf.push({
          start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1),
          blocking: +(e.blockingDuration || 0).toFixed(1),
          renderStart: +(e.renderStart || 0).toFixed(1),
          styleLayoutStart: +(e.styleAndLayoutStart || 0).toFixed(1),
          firstUI: +(e.firstUIEventTimestamp || 0).toFixed(1),
          scripts: (e.scripts || []).slice(0, 8).map((s) => ({
            url: String(s.sourceURL || '').split('/').slice(-1)[0], fn: s.sourceFunctionName || '', invoker: s.invoker || '',
            dur: +(s.duration || 0).toFixed(1), forcedSL: +(s.forcedStyleAndLayoutDuration || 0).toFixed(1),
          })),
        });
      }
    });
    window.__loafOb.observe({ type: 'long-animation-frame', buffered: false });
  } catch (e) { window.__loafErr = String(e && e.message || e); }
};

/* 芯片诊断（第二部分）：可见/隐藏、真实 DOM 结构、被画上去的字符 */
const CHIP = () => {
  const chip = document.getElementById('global-loading-status');
  const label = document.getElementById('global-loading-label');
  if (!chip || !label) return { missing: true };
  const cs = getComputedStyle(label);
  const cellHost = label.querySelector('[class*=cell], [class*=flap]');
  const cells = cellHost ? [...cellHost.children] : [];
  const painted = cells.map((c) => (c.dataset.flapNext || c.textContent || '').slice(0, 12));
  const r = chip.getBoundingClientRect();
  return {
    hidden: chip.hidden, display: getComputedStyle(chip).display,
    offsetW: chip.offsetWidth, offsetH: chip.offsetHeight,
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    state: chip.dataset.state || null,
    textContent: String(label.textContent || '').trim().slice(0, 40),
    labelHTML: label.outerHTML.slice(0, 420),
    cellCount: cells.length, paintedChars: painted.join(''),
    labelColor: cs.color, chipColor: getComputedStyle(chip).color,
    at: +performance.now().toFixed(0),
    stackAtText: document.elementsFromPoint(Math.round(innerWidth / 2), 83).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}#${el.id || '-'}.${(el.className || '').toString().split(' ')[0] || '-'}`),
    bodyClass: document.body.className,
  };
};

const LAYERS = () => {
  try {
    const dm = window.__godsEyeView && window.__godsEyeView.dataManager;
    let list = null;
    if (dm && dm.layers && typeof dm.layers.values === 'function') list = [...dm.layers.values()];
    else if (Array.isArray(dm && dm.layers)) list = dm.layers;
    if (!Array.isArray(list)) return null;
    return list.map((l) => ({
      id: l.id, enabled: !!l.enabled,
      error: l.error ? String(l.error).slice(0, 90) : null,
      keyRequired: l.keyRequired || null, unavailable: l.unavailable || null,
      status: l.stats && (l.stats.status || null), count: l.stats && (l.stats.count ?? null),
    })).filter((l) => l.enabled || l.error || l.keyRequired);
  } catch (e) { return { err: String(e && e.message || e) }; }
};

import { appendFileSync } from 'node:fs';
const PROG = `${OUT}/p12-progress.log`;
const log = (m) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${m}
`; appendFileSync(PROG, line); };
const results = [];
for (let run = 1; run <= RUNS; run++) {
  const browser = await puppeteer.launch({ headless: false, executablePath: CHROME, args: ARGS, protocolTimeout: 900000,
    defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 } });
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
    try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  });
  const rec = { run, tag: TAG };
  const t0 = Date.now();
  try {
    await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
    let revealAt = null;
    for (let i = 0; i < 1200; i++) {
      const ok = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot().interactiveAt != null)
        && !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
      if (ok) { revealAt = Date.now(); break; }
      await sleep(40);
    }
    rec.revealMs = revealAt ? revealAt - t0 : null;
    const boot = await page.evaluate(() => (window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null));
    rec.boot = boot && { reason: boot.reason, interactiveAt: boot.interactiveAt, longOver100: (boot.longFrames || []).filter((f) => f.dt > 100).length };
    const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
    rec.gpu = gpu && { renderer: gpu.renderer, software: gpu.software };
    await page.evaluate(INSTALL);

    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await page.bringToFront().catch(() => {});
    log(`run ${run} reveal ${rec.revealMs}ms`);
    const shot = async (name) => {
      const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
      writeFileSync(`${OUT}/${TAG}-r${run}-${name}.png`, Buffer.from(b64, 'base64'));
    };
    /* 芯片取证：reveal+100 / +500 / +1500 / +3000 / +5000（先截图再读 DOM，和 gate 一致） */
    const chipSamples = [];
    const atNow = () => Date.now() - revealAt;
    if (atNow() < 100) await sleep(100 - atNow());
    await shot('reveal+100');
    for (const at of [100, 500, 1500, 3000, 5000]) {
      if (atNow() < at) await sleep(at - atNow());
      const c = await page.evaluate(CHIP);
      chipSamples.push({ at, ...c });
      if (c && c.hidden === false) c.layersWhenVisible = await page.evaluate(LAYERS);
    }
    rec.chip = chipSamples;
    rec.layersAtReveal = await page.evaluate(LAYERS);
    /* 对齐 gate 的稳态口径：gate 的 T10 窗在 ready+3s+4s(warm)+8s(ramp)+settle ≈ reveal+15s 之后 */
    if (atNow() < 15000) await sleep(15000 - atNow());
    rec.steadyFromMs = atNow();

    /* 稳态门控 */
    await page.mouse.move(4, 620, { steps: 3 });
    let settle = null;
    for (let w = 0; w < 45 && settle === null; w++) {
      const f = await page.evaluate(() => window.__flRun(1000));
      if (f.worst <= 50) { const f2 = await page.evaluate(() => window.__flRun(1000)); if (f2.worst <= 50) settle = w * 2 + 2; }
    }
    rec.settleMs = settle;
    const takeLoaf = () => page.evaluate(() => { const l = window.__loaf || []; window.__loaf = []; return l; });
    const win = async (label, withRender) => {
      await page.bringToFront().catch(() => {});
      await page.evaluate((r) => window.__flStart(r), !!withRender);
      await takeLoaf();
      const f = await page.evaluate(() => window.__flRun(8000));
      const loaf = await takeLoaf();
      const lens = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { drawMax: s.drawMax, drawMaxAt: s.drawMaxAt, drawLog: (s.drawLog || []).slice(-6) }; }).catch(() => null);
      log(`  run ${run} ${label} n=${f.n} p50=${f.p50} worst=${f.worst} >100=${f.over100} vis=${f.vis} focus=${f.hasFocus}`);
      return { label, ...f, loaf, lens };
    };
    const flush = () => writeFileSync(`${OUT}/followup-present-${TAG}.json`, JSON.stringify({ tag: TAG, runs: results.length, results }, null, 2));
    rec.W1 = await win('W1 idle 裸 rAF'); flush();
    rec.W2 = await win('W2 idle + LoAF'); flush();
    rec.W3 = await win('W3 idle + scene.render 计时', true); flush();
    const hp = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.x + 40), y: Math.round(b.y + 20) }; });
    await page.mouse.move(hp.x, hp.y, { steps: 6 }); await sleep(250);
    rec.W4 = await win('W4 hover + LoAF'); flush();
    await page.mouse.move(4, 620, { steps: 3 }); await sleep(200);
    /* W5 对照：关掉 Cesium 渲染循环（玻璃/合成层仍在） */
    const off = await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; return true; } catch (e) { return String(e && e.message || e); } });
    await sleep(400);
    rec.W5 = await win('W5 Cesium render loop OFF + LoAF'); flush();
    rec.W5.off = off;
    await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = true; } catch (e) {} });
    await page.evaluate(() => window.__flStart(false)).catch(() => {});

    /* W6 对照：about:blank 空页（机器/驱动/合成计时器本身） */
    await page.goto('about:blank');
    await page.evaluate(INSTALL);
    await page.evaluate(() => window.__flStart(false));
    await takeLoafFromBlank(page);
    const f6 = await page.evaluate(() => window.__flRun(10000));
    rec.W6 = { label: 'W6 about:blank 空页', ...f6, loaf: await takeLoafFromBlank(page) };
  } catch (e) {
    rec.error = String(e && e.stack || e).slice(0, 400);
  }
  rec.errs = errs.slice(0, 6);
  rec.wallMs = Date.now() - t0;
  results.push(rec);
  const brief = (w) => w && `${w.label}: p50 ${w.p50} p99 ${w.p99} p999 ${w.p999} worst ${w.worst} >60 ${w.over60} >100 ${w.over100}${w.render ? ` render(p50/p99=${w.render.p50}/${w.render.p99})` : ''}`;
  console.log(`\n=== run ${run}/${RUNS} === reveal ${rec.revealMs}ms settle ${rec.settleMs}ms gpu ${rec.gpu && (rec.gpu.renderer || '').slice(0, 28)}`);
  for (const k of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']) if (rec[k]) console.log(' ', brief(rec[k]));
  if (rec.chip) console.log('  chip:', JSON.stringify(rec.chip.map((c) => ({ at: c.at, hidden: c.hidden, disp: c.display, w: c.offsetW, state: c.state, text: c.textContent, cells: c.cellCount, painted: c.paintedChars, color: c.labelColor }))));
  if (rec.error) console.log('  ERROR', rec.error);
  writeFileSync(`${OUT}/followup-present-${TAG}.json`, JSON.stringify({ tag: TAG, runs: results.length, results }, null, 2));
  await browser.close();
}
console.log('\nDONE', results.length, 'runs →', `${OUT}/followup-present-${TAG}.json`);

async function takeLoafFromBlank(page) {
  return page.evaluate(() => { const l = window.__loaf || []; window.__loaf = []; return l; }).catch(() => []);
}
