// 诊断 2：reload 后 cctv 的 parent/class/inline/store 时间线（含 [gev-lc] 调试日志）
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '.gev-logs/u3';
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(Math.round(Date.now() % 100000) + ' ' + m.text().slice(0, 160)));
page.on('framenavigated', () => logs.push('NAV'));
await page.evaluateOnNewDocument(() => {
  const keep = (window.name || '').indexOf('keep') >= 0;
  if (!keep) {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.removeItem('gev-liquid-cards:v2:last');
  }
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  localStorage.setItem('gev.perfMode', '0');
  window.__gevcDebug = true;
  window.__tl = [];
  const t0 = performance.now();
  const sample = () => {
    try {
      const e = document.getElementById('cctv-panel');
      const r = document.getElementById('right-context-rail');
      window.__tl.push({
        t: Math.round(performance.now() - t0),
        has: !!e,
        parent: e && e.parentElement ? (e.parentElement.id || e.parentElement.tagName) : null,
        cls: e ? e.className : null,
        inline: e ? (e.getAttribute('style') || '').slice(0, 160) : null,
        railCls: r ? r.className : null,
        ids: window.__gevLc && window.__gevLc._ids ? window.__gevLc._ids() : null,
        store: (() => { try { return localStorage.getItem('gev-liquid-cards:v2'); } catch (x) { return null; } })(),
      });
    } catch (x) {}
  };
  for (let i = 0; i < 60; i++) setTimeout(sample, 200 * i);
});
const openCctv = async () => {
  const pt = await page.evaluate(() => {
    const el = document.getElementById('cctv-panel');
    const node = el.querySelector('.panel-header,.pp-header-row') || el;
    const r = node.getBoundingClientRect();
    for (let fy = 0.5; fy <= 0.9; fy += 0.2)
      for (let fx = 0.12; fx <= 0.92; fx += 0.08) {
        const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
        const hit = document.elementFromPoint(x, y);
        if (hit && el.contains(hit)) return { x, y };
      }
    return null;
  });
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await sleep(30);
  await page.mouse.down(); await sleep(45); await page.mouse.up();
  await sleep(1200);
};
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(11000);
await openCctv();
const storeBefore = await page.evaluate(() => localStorage.getItem('gev-liquid-cards:v2'));
await page.evaluate(() => (window.name = 'keep'));
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(12000);
const tl = await page.evaluate(() => window.__tl || []);
fs.writeFileSync(OUT + '/_diag-timeline.json', JSON.stringify({ storeBefore, logs, tl }, null, 1));
console.log('storeBefore reload:', storeBefore);
console.log('--- timeline (only rows where parent/cls/ids changed) ---');
let prev = '';
for (const row of tl) {
  const k = row.parent + '|' + row.cls + '|' + JSON.stringify(row.ids) + '|' + row.inline;
  if (k === prev) continue;
  prev = k;
  console.log(row.t + 'ms', 'parent=' + row.parent, 'cls=' + row.cls, 'ids=' + JSON.stringify(row.ids), 'rail=' + row.railCls);
  console.log('      inline=', (row.inline || '').slice(0, 120));
}
console.log('--- [gev-lc] logs ---');
for (const l of logs.filter((x) => x.indexOf('[gev-lc]') >= 0).slice(0, 80)) console.log(l);
await browser.close();
