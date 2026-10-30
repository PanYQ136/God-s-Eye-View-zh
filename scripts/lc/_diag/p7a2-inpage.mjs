#!/usr/bin/env node
/* Phase7A2 诊断（零外部轮询）：页内 rAF 采样，导航后不再从外部 evaluate 打点，
   避免仪器本身拖慢冷启动。记录：LC mounted / input-release / 卡片真实可点(hit-test) /
   每轮 404 请求 URL。
   用法: node scripts/lc/_diag/p7a2-inpage.mjs [runs] [base] */
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNS = Number(process.argv[2] || 2);
const BASE = process.argv[3] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7a2';
mkdirSync(OUT, { recursive: true });

const INJECT = `(() => {
  const S = { samples: [], bad: [], t0: performance.now() };
  window.__p7a2 = S;
  const push = (o) => { if (S.samples.length < 4000) S.samples.push(o); };
  let last = 0;
  const CARD_HEAD = '.panel-header, header, .lc-head';
  const tick = () => {
    const t = +performance.now().toFixed(0);
    if (t - last >= 30) {
      last = t;
      const lc = window.__lc && window.__lc.api;
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const dp = document.getElementById('data-panel');
      const h = dp && dp.querySelector(CARD_HEAD);
      const r = h && h.getBoundingClientRect();
      const hit = (r && r.width > 10)
        ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
        : null;
      const hid = hit ? (hit.id || (typeof hit.className === 'string' ? hit.className : '') || hit.tagName) : null;
      push({
        t,
        m: !!(lc && lc.mounted),
        rel: !!(g && g.inputReleased),
        inter: !!(g && g.interactive),
        op: el ? +(parseFloat(getComputedStyle(el).opacity) || 0).toFixed(2) : null,
        pe: el ? getComputedStyle(el).pointerEvents : null,
        ph: lc && lc.phases ? lc.phases()['data-panel'] : null,
        hit: hid ? String(hid).slice(0, 48) : null,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // 404 捕获：fetch + XHR
  const of = window.fetch;
  window.fetch = function (...a) {
    return of.apply(this, a).then((r) => {
      if (r.status >= 400) S.bad.push({ via: 'fetch', s: r.status, url: String(r.url).slice(0, 200) });
      return r;
    }).catch((e) => { S.bad.push({ via: 'fetch-err', s: String(e && e.message).slice(0, 60), url: String(a[0]).slice(0, 200) }); throw e; });
  };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.addEventListener('loadend', () => {
      if (this.status >= 400) S.bad.push({ via: 'xhr', s: this.status, url: String(u).slice(0, 200) });
    });
    return oo.call(this, m, u, ...rest);
  };
})()`;

const rows = [];
for (let i = 1; i <= RUNS; i++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-p7a2in-`));
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
  const netBad = [];
  page.on('response', (r) => { if (r.status() >= 400) netBad.push({ s: r.status(), url: r.url().slice(0, 200) }); });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  await page.evaluateOnNewDocument(INJECT);
  await page.goto(`${BASE}&run=${i}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  // 单次等待：12s 后一次性读取（无逐帧外部 evaluate）
  await page.evaluate(() => new Promise((r) => setTimeout(r, 12000))).catch(() => {});
  const out = await page.evaluate(() => ({
    samples: window.__p7a2?.samples || [],
    bad: window.__p7a2?.bad || [],
    boot: window.__gevBoot?.snapshot?.() ?? null,
    stages: window.__bootTimeline?.snapshot?.()?.stages ?? null,
    gpu: (() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
      return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch (_) { return null; } })(),
  })).catch((e) => ({ err: String(e).slice(0, 200) }));

  const s = out.samples || [];
  const first = (p) => { const x = s.find(p); return x ? x.t : null; };
  const row = {
    run: i,
    firstMounted: first((x) => x.m),
    firstCardHit: first((x) => x.hit && /panel|lc-head|card/.test(x.hit)),
    firstReleased: first((x) => x.rel),
    firstInteractive: first((x) => x.inter),
    firstMaskPEnone: first((x) => x.pe === 'none'),
    badInPage: out.bad,
    netBad: netBad.slice(0, 10),
    marks: (out.boot?.marks || []).map((m) => `${m.t}:${m.name}`),
    stages: out.stages,
    gpu: out.gpu,
  };
  rows.push(row);
  writeFileSync(join(OUT, `inpage-${i}.json`), JSON.stringify({ row, samples: s }, null, 1));
  console.log(JSON.stringify(row));
  await browser.close();
}
writeFileSync(join(OUT, 'inpage-summary.json'), JSON.stringify(rows, null, 1));
