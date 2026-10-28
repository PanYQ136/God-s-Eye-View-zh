// 验证：reload 恢复路径（App 右栏自适应 init 抢卡）修复后 —— 浮层仍在 body、0 overlap、7/7 header 命中
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '.gev-logs/u3';
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const RUNS = Number(process.argv[2] || 3);
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  const keep = (window.name || '').indexOf('keep') >= 0;
  if (!keep) {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.removeItem('gev-liquid-cards:v2:last');
  }
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  localStorage.setItem('gev.perfMode', '0');
});
const probe = () =>
  page.evaluate((ids) => {
    const out = { rects: {}, headers: {}, ids: window.__gevLc ? window.__gevLc._ids() : null };
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) { out.rects[id] = null; continue; }
      const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      out.rects[id] = {
        x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
        disp: s.display, collapsed: e.classList.contains('collapsed'),
        floating: e.classList.contains('gev-lc-floating'),
        parent: e.parentElement ? (e.parentElement.id || e.parentElement.tagName) : null,
      };
      const node = e.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar,.location-bar-toggle') || e;
      const r = node.getBoundingClientRect();
      const hx = Math.round(r.left + r.width * 0.5), hy = Math.round(r.top + r.height * 0.5);
      const hit = document.elementFromPoint(hx, hy);
      out.headers[id] = { self: hit ? e.contains(hit) : false, at: [hx, hy], hit: hit ? (hit.id ? '#' + hit.id : hit.tagName.toLowerCase() + '.' + String(hit.className || '').split(' ')[0]) : null };
    }
    const vis = ids.filter((k) => out.rects[k] && out.rects[k].disp !== 'none' && out.rects[k].w > 4 && out.rects[k].h > 4);
    out.overlaps = [];
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const A = out.rects[vis[i]], B = out.rects[vis[j]];
      const w = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
      const h = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      if (w > 0 && h > 0) out.overlaps.push({ a: vis[i], b: vis[j], area: Math.round(w * h) });
    }
    return out;
  }, CARDS);
const clickHeader = async (id) => {
  const pt = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const node = el.querySelector('.panel-header,.pp-header-row') || el;
    const r = node.getBoundingClientRect();
    for (let fy = 0.5; fy <= 0.9; fy += 0.2)
      for (let fx = 0.12; fx <= 0.92; fx += 0.08) {
        const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
        const hit = document.elementFromPoint(x, y);
        if (hit && el.contains(hit)) return { x, y };
      }
    return null;
  }, id);
  if (!pt) return null;
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await sleep(30); await page.mouse.down(); await sleep(45); await page.mouse.up();
  await sleep(1200);
  return pt;
};
const results = [];
for (let run = 1; run <= RUNS; run++) {
  await page.evaluateOnNewDocument(() => {}); // noop
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
  await sleep(11000);
  const init = await probe();
  const clicked = await clickHeader('cctv-panel');
  await page.evaluate(() => (window.name = 'keep'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
  await sleep(12000);
  const after = await probe();
  await page.screenshot({ path: OUT + '/_reload-heal-' + run + '.png' });
  const bad = CARDS.filter((id) => !after.headers[id] || !after.headers[id].self);
  const row = {
    run,
    initOverlaps: init.overlaps,
    initHeadersBad: CARDS.filter((id) => !init.headers[id] || !init.headers[id].self),
    clicked,
    idsAfter: after.ids,
    cctv: after.rects['cctv-panel'],
    overlaps: after.overlaps,
    headersBad: bad,
    dispNone: CARDS.filter((id) => after.rects[id] && after.rects[id].disp === 'none'),
    ok: !after.overlaps.length && !bad.length,
  };
  results.push(row);
  console.log(JSON.stringify(row));
  await page.evaluate(() => { try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.removeItem('gev-liquid-cards:v2:last'); } catch (e) {} });
  await page.evaluate(() => (window.name = ''));
}
fs.writeFileSync(OUT + '/_reload-heal.json', JSON.stringify(results, null, 1));
console.log('SUMMARY ok:', results.filter((r) => r.ok).length + '/' + results.length);
await browser.close();
