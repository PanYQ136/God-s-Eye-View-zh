#!/usr/bin/env node
/* Phase6C3-followup · 诊断二（可复现）：强制一次 live-data 批失败，抓住「可见红色 LOAD FAILED」
   —— 由哪个 DOM 节点画出来、文字为何是英文、诊断为何说不可见。
   做法：CDP 拦掉 flights 上游 API → dataManager.toggle 打开 flights → 批次以 error 收尾。
   （只做拦截与采样，不改产品代码。）
   用法: node scripts/lc/_diag/phase6c3-followup-failchip2.mjs [tag] [runs]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'g1';
const RUNS = Number(process.argv[3] || 2);
const OUT = '.gev-logs/lc/phase6c3';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHIP = () => {
  const chip = document.getElementById('global-loading-status');
  const label = document.getElementById('global-loading-label');
  if (!chip || !label) return { missing: true };
  const cs = getComputedStyle(chip);
  const lcs = getComputedStyle(label);
  const r = chip.getBoundingClientRect();
  const lr = label.getBoundingClientRect();
  const cellHost = label.querySelector('[class*=cell], [class*=flap], .sf-cells, [data-flap-next]');
  const cells = cellHost ? [...cellHost.children] : [];
  /* 所有「文字里带 LOAD FAILED」的可见元素（全文档扫，含中文） */
  const matches = [];
  for (const el of document.querySelectorAll('body *')) {
    const t = el.textContent || '';
    if (!/LOAD FAILED|加载失败/.test(t)) continue;
    if (el.children.length > 3) continue; /* 只看叶子附近，避免祖先重复 */
    const er = el.getBoundingClientRect();
    const e2 = getComputedStyle(el);
    matches.push({ id: el.id || '', cls: (el.className || '').toString().slice(0, 40), rect: [Math.round(er.left), Math.round(er.top), Math.round(er.width), Math.round(er.height)],
      display: e2.display, visibility: e2.visibility, color: e2.color, text: t.trim().slice(0, 40) });
  }
  return {
    hidden: chip.hidden, display: cs.display, offsetW: chip.offsetWidth, offsetH: chip.offsetHeight,
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    labelRect: [Math.round(lr.left), Math.round(lr.top), Math.round(lr.width), Math.round(lr.height)],
    state: chip.dataset.state || null, chipColor: cs.color, labelColor: lcs.color,
    labelTextNode: String(label.textContent || '').trim().slice(0, 40),
    labelHTML: label.outerHTML.slice(0, 600),
    cellCount: cells.length,
    cellData: cells.slice(0, 20).map((c) => ({ n: c.dataset.flapNext || '', p: c.dataset.flapPrev || '', cls: (c.className || '').toString().slice(0, 30), w: Math.round(c.getBoundingClientRect().width) })),
    cellHostRect: cellHost ? (() => { const q = cellHost.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })() : null,
    stack674x83: document.elementsFromPoint(674, 83).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}#${el.id || '-'}.${(el.className || '').toString().split(' ')[0] || '-'}`),
    matches,
    at: +performance.now().toFixed(0),
  };
};

const LAYERS = () => {
  try {
    const dm = window.__godsEyeView.dataManager;
    const list = dm.layers && dm.layers.values ? [...dm.layers.values()] : [];
    return list.filter((l) => l.enabled || l.error || l.keyRequired)
      .map((l) => ({ id: l.id, enabled: !!l.enabled, err: l.error ? String(l.error).slice(0, 80) : null, key: l.keyRequired || null, st: l.stats && l.stats.status }));
  } catch (e) { return { err: String(e && e.message || e) }; }
};

for (let run = 1; run <= RUNS; run++) {
  const browser = await puppeteer.launch({
    headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist',
      '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
    protocolTimeout: 600000, defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*api/opensky*', '*api/flights*', '*api/adsb*'] });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
    try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  });
  const shot = async (name) => {
    const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
    writeFileSync(`${OUT}/${TAG}-r${run}-${name}.png`, Buffer.from(b64, 'base64'));
  };
  await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
  for (let i = 0; i < 800; i++) {
    const ok = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot().interactiveAt != null)
      && !!(window.__godsEyeView && window.__godsEyeView.dataManager)).catch(() => false);
    if (ok) break; await sleep(60);
  }
  /* 打开 flights（上游已拦）→ 该批次必然以 error 收尾 → 芯片进 LOAD FAILED */
  const tog = await page.evaluate(async () => {
    try {
      const dm = window.__godsEyeView.dataManager;
      const ids = [...dm.layers.keys()];
      const target = ids.includes('flights') ? 'flights' : ids[0];
      dm.toggle(target);
      return { target, ids: ids.slice(0, 6) };
    } catch (e) { return { err: String(e && e.message || e) }; }
  });
  console.log(`run ${run} toggle →`, JSON.stringify(tog));
  const samples = [];
  let shots = 0;
  for (let i = 0; i < 240; i++) {
    await sleep(25);
    const c = await page.evaluate(CHIP);
    c.t = +(i * 25).toFixed(0);
    if (c && c.hidden === false && shots < 30) { await shot(`visible+${c.t}ms`); c.png = `${TAG}-r${run}-visible+${c.t}ms.png`; shots += 1; }
    samples.push(c);
    if (c && c.hidden === false) c.layers = await page.evaluate(LAYERS);
    if (i % 10 === 0) {
      console.log(` ${c.t}ms hidden=${c.hidden} disp=${c.display} w=${c.offsetW} state=${c.state} text="${c.labelTextNode}" cells=${c.cellCount} cellsTxt="${(c.cellData || []).map((x) => x.n).join('')}" color=${c.labelColor}`);
    }
  }
  writeFileSync(`${OUT}/followup-${TAG}-r${run}-failchip2.json`, JSON.stringify({ run, tog, samples }, null, 2));
  const vis = samples.filter((s) => s.hidden === false);
  console.log(`run ${run}: visible samples ${vis.length} · first visible`, vis[0] ? JSON.stringify({ t: vis[0].t, rect: vis[0].rect, labelRect: vis[0].labelRect, text: vis[0].labelTextNode, cells: vis[0].cellCount, cellsTxt: (vis[0].cellData || []).map((x) => x.n).join(''), color: vis[0].labelColor, matches: vis[0].matches }) : 'none');
  await browser.close();
}
console.log('DONE');
