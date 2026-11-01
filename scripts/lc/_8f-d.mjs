#!/usr/bin/env node
/* Phase8F：D1–D12 运行时读数（只读；不改产品代码/阈值）
   一次性读：material 枚举+scrim、gloss/shadow、morph↔lens、tint/spill、a11y、
             同心圆角、字重、pp 行/hitbox、stats cfg/eff 同源
   用法: node scripts/lc/_8f-d.mjs <url> */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4175/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 600000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.mounted), { timeout: 120000 }).catch(() => {});
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) < 0.05;
}, { timeout: 90000 }).catch(() => {});
await sleep(6000);

const base = await page.evaluate(() => {
  const edge = globalThis.__gevEdge;
  const st = edge?.stats ? edge.stats() : null;
  const glass = globalThis.__lc?.glass?.state ? globalThis.__lc.glass.state() : null;
  const cards = [...document.querySelectorAll('.gev-lc')];
  const roots = [...document.querySelectorAll(':root')].map(() => 0);
  const rs = getComputedStyle(document.documentElement);
  const tok = {};
  for (const k of ['--lc-radius', '--lc-radius-inner', '--lc-inset', '--lc-text-scrim-a', '--lc-fg-flip-ms', '--lc-shadow-rgb', '--lc-shadow-a']) tok[k] = rs.getPropertyValue(k).trim();
  const panel = document.querySelector('.pp-panel') || document.querySelector('#pp-toggles');
  const rows = panel ? [...panel.querySelectorAll('.pp-toggle-btn, .pp-slider-row')] : [];
  const rowInfo = rows.slice(0, 4).map((r) => {
    const cs = getComputedStyle(r); const after = getComputedStyle(r, '::after');
    return { h: +r.getBoundingClientRect().height.toFixed(1), cssH: cs.minHeight, afterH: after.height, afterTop: after.top, afterBottom: after.bottom };
  });
  const labels = [...document.querySelectorAll('.pp-toggle-btn .pp-label')].slice(0, 3).map((el) => getComputedStyle(el).fontWeight);
  const innerEl = document.querySelector('.pp-panel-body') || document.querySelector('.data-panel-inner');
  return {
    token: tok,
    materials: cards.map((c) => c.dataset.lcMaterial || null),
    variant: glass?.variant, scrimMode: glass?.scrimMode, scrim: glass?.scrim, scrimAlpha: glass?.scrimAlpha,
    shadowA: glass?.shadowA, luma: glass?.luma, lumaSrc: glass?.lumaSrc, lumaSamples: glass?.lumaSamples,
    gloss: glass?.gloss, pointer: glass?.pointer, morph: glass?.morph,
    edgeCfg: st?.cfg || null, edgeEff: st?.eff || null, a11y: st?.a11y || null, look: st?.look?.per || null,
    backdrop: cards.map((c) => getComputedStyle(c).backdropFilter || getComputedStyle(c).webkitBackdropFilter),
    border: cards.map((c) => getComputedStyle(c).borderTopWidth),
    innerRadius: innerEl ? getComputedStyle(innerEl).borderTopLeftRadius : null,
    labelWeights: labels, bodyWeight: getComputedStyle(document.body).fontWeight,
    rows: rowInfo, rowCount: rows.length,
    textShadow: getComputedStyle(document.querySelector('#data-panel .panel-title') || document.body).textShadow,
    bgImage: (() => { const c = document.querySelector('#data-panel'); return c ? getComputedStyle(c).backgroundImage.slice(0, 160) : null; })(),
  };
});

/* D2 高光方位：真实鼠标 20% / 80% */
const rect = await page.evaluate(() => {
  const c = document.querySelector('#data-panel'); if (!c) return null;
  const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
});
let gloss = null;
if (rect) {
  await page.mouse.move(rect.x + rect.w * 0.2, rect.y + 20); await sleep(260);
  const a = await page.evaluate(() => ({ x: getComputedStyle(document.querySelector('#data-panel')).getPropertyValue('--lc-gloss-x').trim(), alpha: getComputedStyle(document.querySelector('#data-panel')).getPropertyValue('--lc-gloss-a').trim() }));
  await page.mouse.move(rect.x + rect.w * 0.8, rect.y + 20); await sleep(260);
  const b = await page.evaluate(() => ({ x: getComputedStyle(document.querySelector('#data-panel')).getPropertyValue('--lc-gloss-x').trim(), alpha: getComputedStyle(document.querySelector('#data-panel')).getPropertyValue('--lc-gloss-a').trim() }));
  gloss = { at20: a, at80: b };
}

/* D3 morph↔lens + D12 pp 行（真实鼠标点击卡头） */
const clickAt = async (x, y) => { await page.mouse.move(x, y); await sleep(120); await page.mouse.down(); await sleep(45); await page.mouse.up(); };
const hdr = await page.evaluate(() => {
  const el = document.querySelector('#data-panel .panel-header') || document.querySelector('#data-panel');
  const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const morph = { frames: 0, offFrames: 0, before: null, after: null };
morph.before = await page.evaluate(() => globalThis.__gevEdge?.cfg?.().enabled ?? null);
await clickAt(hdr.x, hdr.y);
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => ({ en: globalThis.__gevEdge?.cfg?.().enabled ?? null, m: globalThis.__lc?.glass?.state?.().morph?.active ?? null }));
  morph.frames++; if (s.en === false) morph.offFrames++;
  await sleep(20);
}
await sleep(700);
morph.after = await page.evaluate(() => globalThis.__gevEdge?.cfg?.().enabled ?? null);
const ppAfter = await page.evaluate(() => {
  const pp = document.querySelector('#pp-toggles'); const panel = document.querySelector('.pp-panel') || pp;
  if (!panel) return null;
  const rows = [...panel.querySelectorAll('.pp-toggle-btn, .pp-slider-row')];
  const rs = rows.map((r) => r.getBoundingClientRect());
  let minGap = Infinity;
  for (let i = 1; i < rs.length; i++) minGap = Math.min(minGap, rs[i].top - rs[i - 1].bottom);
  const phase = [...document.querySelectorAll('.gev-lc')].map((c) => c.dataset.lcPhase);
  return { phase, rowCount: rows.length, minGap: +minGap.toFixed(2), minH: Math.min(...rs.map((r) => r.height)).toFixed(1) };
});

/* D5 a11y 三态（真实 CDP emulate） */
const cdp = await page.createCDPSession();
const a11y = {};
for (const [name, feats] of Object.entries({ solid: [{ name: 'prefers-contrast', value: 'more' }], reduced: [{ name: 'prefers-reduced-transparency', value: 'reduce' }], full: [] })) {
  await cdp.send('Emulation.setEmulatedMedia', { features: feats });
  await sleep(700);
  a11y[name] = await page.evaluate(() => {
    const st = globalThis.__gevEdge?.stats?.();
    return { a11y: st?.a11y ?? null, effDisp: st?.eff?.dispPx ?? null, effBandAlpha: st?.eff?.bandAlpha ?? null, enabled: st?.eff?.enabled ?? null, surfaces: st?.surfaces?.length ?? null };
  });
}
await cdp.send('Emulation.setEmulatedMedia', { features: [] });

const out = { base, gloss, morph, ppAfter, a11y };
writeFileSync('.gev-logs/lc/phase8f/d1-d12.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
