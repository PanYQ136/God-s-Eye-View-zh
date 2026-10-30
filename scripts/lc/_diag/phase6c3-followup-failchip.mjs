#!/usr/bin/env node
/* Phase6C3-followup · 诊断一：reveal 时可见红色 `LOAD FAILED` 到底是哪个 DOM 节点
   —— 纯只读采样（不截图循环、不改产品代码）。
   产出 .gev-logs/lc/phase6c3/followup-failchip.json + 一张全屏 PNG。
   用法: node scripts/lc/_diag/phase6c3-followup-failchip.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'f1';
const OUT = '.gev-logs/lc/phase6c3';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 600000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});

const dump = () => page.evaluate(() => {
  const W = innerWidth;
  const vis = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(), id: el.id || '', cls: (el.className || '').toString().slice(0, 80),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      offsetW: el.offsetWidth, offsetH: el.offsetHeight, hiddenAttr: el.hasAttribute('hidden'),
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      color: cs.color, bg: cs.backgroundColor, fontSize: cs.fontSize, letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform, top: cs.top, left: cs.left, zIndex: cs.zIndex,
      pointerEvents: cs.pointerEvents, text: String(el.textContent || '').trim().slice(0, 120).slice(0, 120),
      parent: el.parentElement ? (el.parentElement.id || el.parentElement.tagName.toLowerCase() + '.' + (el.parentElement.className || '').toString().split(' ')[0]) : '',
    };
  };
  /* 1) 同 id 有几个 */
  const byId = [...document.querySelectorAll('[id="global-loading-status"]')].map(vis);
  /* 2) 全文档所有「自己带这段文字」的叶子节点（textContent 精确匹配，含中文） */
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (!/LOAD FAILED|加载失败/i.test(t)) continue;
    const el = n.parentElement;
    hits.push({ where: 'textnode', text: t.slice(0, 60), node: vis(el), chain: (() => { const c = []; let p = el; for (let i = 0; i < 6 && p; i++) { c.push(vis(p)); p = p.parentElement; } return c; })() });
  }
  /* 3) 属性/aria-label 里带这段文字的节点 */
  for (const el of document.querySelectorAll('[aria-label],[title],[data-label]')) {
    const a = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('data-label') || '');
    if (/LOAD FAILED|加载失败/i.test(a)) hits.push({ where: 'attr', attr: a.trim().slice(0, 60), node: vis(el) });
  }
  /* 4) 顶部中央在这一高度上到底叠了谁 */
  const stack = [70, 78, 84, 92, 100].map((y) => ({
    y, els: document.elementsFromPoint(Math.round(W / 2), y).slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}#${el.id || '-'}.${(el.className || '').toString().split(' ')[0] || '-'} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`;
    }),
  }));
  /* 5) 页内 loading 状态机快照 */
  const chip = document.getElementById('global-loading-status');
  const st = {
    bodyClass: document.body.className,
    globalLoadingStatus: { hidden: chip ? chip.hidden : null, state: chip && chip.dataset ? chip.dataset.state : null,
      label: document.getElementById('global-loading-label')?.textContent?.trim() || null },
    otherChips: ['traffic-sync-chip', 'cctv-sync-chip'].map((id) => {
      const e = document.getElementById(id); if (!e) return { id, missing: true };
      const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      return { id, cls: e.className, display: cs.display, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], text: e.textContent.trim().slice(0, 60) };
    }),
  };
  return { hits, byId, stack, st };
});

const apiState = () => page.evaluate(async () => {
  const out = { layers: null, health: null };
  try {
    const dm = window.__godsEyeView && window.__godsEyeView.dataManager;
    const lay = dm && (dm.layers || dm.getAllLayers && dm.getAllLayers());
    if (Array.isArray(lay)) out.layers = lay.map((l) => ({ id: l.id, enabled: l.enabled, error: l.error || null, keyRequired: l.keyRequired || null, unavailable: l.unavailable || null, stats: l.stats && { count: l.stats.count, status: l.stats.status } }));
  } catch (e) { out.layersErr = String(e && e.message || e); }
  try {
    const r = await fetch('/api/sources/health', { cache: 'no-store' });
    const j = await r.json();
    out.health = { summary: j.summary || null, down: (j.channels || j.sources || []).filter?.((c) => c.ok === false || c.state === 'down').map?.((c) => ({ id: c.id || c.name, err: (c.error || c.detail || '').toString().slice(0, 80) })) || null };
  } catch (e) { out.healthErr = String(e && e.message || e); }
  return out;
});

const cdp = await page.createCDPSession();
const shot = async (name) => {
  const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
  writeFileSync(`${OUT}/${TAG}-${name}.png`, Buffer.from(b64, 'base64'));
  return `${OUT}/${TAG}-${name}.png`;
};

const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
let revealAt = null;
for (let i = 0; i < 1000; i++) {
  const r = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot().interactiveAt != null)).catch(() => false);
  if (r) { revealAt = Date.now(); break; }
  await sleep(40);
}
const boot = await page.evaluate(() => (window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null));
console.log('reveal at +' + (revealAt ? revealAt - t0 : -1) + 'ms · reason', boot && boot.reason);

const samples = [];
for (const at of [100, 1000, 2500]) {
  const now = Date.now() - (revealAt || t0);
  if (at > now) await sleep(at - now);
  const d = await dump();
  samples.push({ at, ...d, png: null });
  console.log(`--- reveal+${at}ms ---`);
  console.log('byId global-loading-status count:', d.byId.length, JSON.stringify(d.byId));
  console.log('text hits:', JSON.stringify(d.hits.map((h) => ({ where: h.where, text: h.text, node: h.node && { id: h.node.id, cls: h.node.cls, rect: h.node.rect, hidden: h.node.hiddenAttr, display: h.node.display, color: h.node.color } }))));
  console.log('stack@y78/84:', JSON.stringify(d.stack.filter((s) => s.y === 78 || s.y === 84)));
  console.log('state:', JSON.stringify(d.st));
}
samples[0].png = await shot('reveal+100');
samples[1].png = await shot('reveal+1000');
const st = await apiState();
console.log('layers:', JSON.stringify(st.layers));
console.log('health:', JSON.stringify(st.health));
console.log('errs:', JSON.stringify(errs.slice(0, 10)));

writeFileSync(`${OUT}/followup-${TAG}-failchip.json`, JSON.stringify({ tag: TAG, t0, revealAt, boot, samples, api: st, errs }, null, 2));
await browser.close();
console.log('saved', `${OUT}/followup-${TAG}-failchip.json`);
