#!/usr/bin/env node
/* C6 诊断（一次性，不改产品）：定位 T2c/T5c/T6b/T3b-d-e 的口径问题
   A) 展开态 data-panel（与 gate 同态）用我的 edgeDisp + gate 的 metrics 双仪器量色散
   B) 平灰底衬下 hover 三连拍（S0 parked / S1 hover / S2 parked）→ 去掉地图运动
   C) gev-voice-kicker / gev-gfx-fab 的真实盒与 outline
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = '.gev-logs/lc/phase6c6';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4174/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist',
    '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 600000, defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(4000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const park = async () => { await page.mouse.move(4, 700, { steps: 3 }); await sleep(500); };

await page.evaluate(() => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  };
  /* 我的仪器 */
  const mine = (A, B, rect, edgePx, axis, bandPx, dir) => {
    dir = dir || 1;
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx); const prof = [], maxAt = [];
    for (let k = 0; k <= 14; k++) {
      const aa = edge + k * dir; let s = 0, n = 0, mx = 0;
      for (let t = Math.max(0, Math.min(aa, aa + dir)); t < Math.min(axis === 'y' ? A.h : A.w, Math.max(aa, aa + dir)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
          const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
          const drb = (A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]);
          s += drb; n++; if (Math.abs(drb) > mx) mx = Math.abs(drb);
        }
      }
      prof.push(n ? +(s / n).toFixed(2) : 0); maxAt.push(+mx.toFixed(1));
    }
    const bd = Math.max(1, Math.round(bandPx));
    return { mean: +(prof.slice(0, bd).reduce((a, b) => a + b, 0) / bd).toFixed(2), max2d: Math.max(...maxAt.slice(0, bd)), prof: prof.slice(0, bd) };
  };
  /* gate 的仪器（phase6c2-gate.mjs metrics 简化：只用 dprof / prof） */
  const gate = (A, B, rect, edgePx, axis, bandCss, dir) => {
    dir = dir || 1;
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx); const prof = [], dprof = [];
    for (let k = 0; k <= 12; k++) {
      const aa = edge + k * dir; let s = 0, n = 0, chd = 0;
      for (let t = Math.max(0, Math.min(aa, aa + dir)); t < Math.min(axis === 'y' ? A.h : A.w, Math.max(aa, aa + dir)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
          const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
          const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
          s += Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); n++; chd = Math.max(chd, Math.abs(dr - db));
        }
      }
      prof.push(n ? +(s / n).toFixed(2) : 0); dprof.push(chd);
    }
    const bd = Math.round(bandCss);
    return { gate_dispMax: Math.max(...dprof.slice(0, bd)), gate_prof: prof.slice(0, bd), gate_dprof: dprof.slice(0, bd) };
  };
  window.__dg = { dec, mine, gate };
});
const K = await page.evaluate(async (b64) => (await window.__dg.dec(b64)).w / innerWidth, await shot());

/* 展开 data-panel */
const hdr = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const b = el.getBoundingClientRect();
  const t = el.querySelector('.panel-header') || el; const tb = t.getBoundingClientRect();
  return { x: Math.round(tb.left + tb.width / 2), y: Math.round(tb.top + tb.height / 2) };
});
await page.mouse.move(hdr.x, hdr.y, { steps: 4 }); await sleep(80);
await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1800);
await park();
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, phase: document.getElementById('data-panel').dataset.lcPhase }; });
const band = await page.evaluate(() => { const s = window.__gevEdge.stats(); const f = (s.surfaces || []).find((x) => x.id === 'data-panel'); return f ? f.band : s.band; });
const rS = { x: rect.x * K, y: rect.y * K, w: rect.w * K, h: rect.h * K }, bandS = band * K;
console.log('EXPANDED', JSON.stringify(rect), 'band', band, 'K', K);

const measure = async (a, b) => page.evaluate(async (a, b, r, band) => {
  const A = await window.__dg.dec(a), B = await window.__dg.dec(b);
  const edges = { top: [r.y, 'y', 1], left: [r.x, 'x', 1], bot: [r.y + r.h, 'y', -1], right: [r.x + r.w, 'x', -1] };
  const out = {};
  for (const [k, [e, ax, dir]] of Object.entries(edges)) {
    out[k] = { ...window.__dg.mine(A, B, r, e, ax, band, dir), ...window.__dg.gate(A, B, r, e, ax, band, dir) };
  }
  return out;
}, a, b, rS, bandS);

/* A1 真地图 on/off */
const on1 = await shot();
await page.evaluate(() => window.__gevEdge.off()); await sleep(700);
const off = await shot();
await page.evaluate(() => window.__gevEdge.on()); await sleep(800);
const on2 = await shot();
const A1 = await measure(on1, off);
const A1n = await measure(on2, on1);
writeFileSync(`${OUT}/diag-expanded-realmap-on.png`, Buffer.from(on1, 'base64'));
console.log('A1 realmap expanded', JSON.stringify(A1));
console.log('A1 noise', JSON.stringify({ top: A1n.top, left: A1n.left }));

/* A2 2px hstripes */
await page.evaluate(() => { window.__gevEdge.testStripes(1, 2); }); await sleep(1600); await park();
const h1 = await shot();
await page.evaluate(() => window.__gevEdge.off()); await sleep(700);
const h0 = await shot();
await page.evaluate(() => window.__gevEdge.on()); await sleep(800);
const A2 = await measure(h1, h0);
writeFileSync(`${OUT}/diag-expanded-hstripes-on.png`, Buffer.from(h1, 'base64'));
console.log('A2 hstripes2px expanded', JSON.stringify(A2));

/* A3 2px vstripes */
await page.evaluate(() => { window.__gevEdge.testStripes(0, 2); }); await sleep(1600); await park();
const v1 = await shot();
await page.evaluate(() => window.__gevEdge.off()); await sleep(700);
const v0 = await shot();
await page.evaluate(() => window.__gevEdge.on()); await sleep(800);
const A3 = await measure(v1, v0);
console.log('A3 vstripes2px expanded', JSON.stringify(A3));
await page.evaluate(() => window.__gevEdge.testBg(false)); await sleep(1000);

/* B) 平灰底衬 hover 三连拍 */
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'dg-under';
  d.style.cssText = 'position:fixed;inset:0;background:#3a3f46;z-index:1;pointer-events:none';
  document.body.appendChild(d);
});
await sleep(700); await park();
const s0 = await shot();
const hb = await page.evaluate(() => { const t = document.querySelector('#data-panel .panel-header'); const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(hb.x, hb.y, { steps: 6 }); await sleep(800);
const s1 = await shot();
await park(); await sleep(700);
const s2 = await shot();
const hv = await page.evaluate(async (a, b, c, r) => {
  const dec = window.__dg.dec;
  const A = await dec(a), B = await dec(b), C = await dec(c);
  const d = (X, Y, insetTop, insetBot) => {
    let sum = 0, n = 0, mx = 0, above = 0;
    for (let y = Math.round(r.y + insetTop); y < Math.round(r.y + r.h) - insetBot; y++) {
      for (let x = Math.round(r.x + 6); x < Math.round(r.x + r.w) - 6; x++) {
        const i = (y * X.w + x) * 4;
        const dl = 0.2126 * (X.d[i] - Y.d[i]) + 0.7152 * (X.d[i + 1] - Y.d[i + 1]) + 0.0722 * (X.d[i + 2] - Y.d[i + 2]);
        sum += Math.abs(dl); n++; if (Math.abs(dl) > mx) mx = Math.abs(dl); if (dl > 2) above++;
      }
    }
    return { mean: +(sum / Math.max(1, n)).toFixed(3), max: +mx.toFixed(2), brighterFrac: +(above / Math.max(1, n)).toFixed(4) };
  };
  return { hover: d(A, B, 14, 14), restore: d(C, B, 14, 14), noisePair: d(C, A, 14, 14) };
}, s1, s0, s2, rS);
writeFileSync(`${OUT}/diag-hover-gray-s0.png`, Buffer.from(s0, 'base64'));
writeFileSync(`${OUT}/diag-hover-gray-s1.png`, Buffer.from(s1, 'base64'));
writeFileSync(`${OUT}/diag-hover-gray-s2.png`, Buffer.from(s2, 'base64'));
console.log('B hover(flat102) ', JSON.stringify(hv));
await page.evaluate(() => { const d = document.getElementById('dg-under'); if (d) d.remove(); });

/* C) voice kicker + fab outline */
const dom = await page.evaluate(() => {
  const k = document.querySelector('#gev-voice-control .gev-voice-kicker');
  const kcs = k ? getComputedStyle(k) : null, kr = k ? k.getBoundingClientRect() : null;
  const fab = document.getElementById('gev-gfx-fab');
  const fcs = fab ? getComputedStyle(fab) : null, fr = fab ? fab.getBoundingClientRect() : null;
  const vc = document.getElementById('gev-voice-control');
  return {
    kicker: k ? { rect: [+kr.x.toFixed(1), +kr.y.toFixed(1), +kr.width.toFixed(1), +kr.height.toFixed(1)], clientW: k.clientWidth, scrollW: k.scrollWidth,
      display: kcs.display, visibility: kcs.visibility, overflow: kcs.overflow, position: kcs.position, width: kcs.width, fontSize: kcs.fontSize, txt: (k.textContent || '').trim().slice(0, 24) } : null,
    voiceCard: vc ? { rect: [+vc.getBoundingClientRect().width.toFixed(1), +vc.getBoundingClientRect().height.toFixed(1)], scrollW: vc.scrollWidth, clientW: vc.clientWidth } : null,
    fab: fab ? { rect: [+fr.x.toFixed(1), +fr.y.toFixed(1), +fr.width.toFixed(1), +fr.height.toFixed(1)], outline: fcs.outline, outlineColor: fcs.outlineColor,
      outlineOffset: fcs.outlineOffset, border: fcs.borderTopWidth, bf: fcs.backdropFilter, bg: fcs.backgroundColor } : null,
  };
});
console.log('C dom', JSON.stringify(dom, null, 1));
writeFileSync(`${OUT}/c6diag.json`, JSON.stringify({ rect, band, K, A1_realmap: A1, A1_noise: A1n, A2_hstripes: A2, A3_vstripes: A3, hover_flat: hv, dom }, null, 1));
await browser.close();
