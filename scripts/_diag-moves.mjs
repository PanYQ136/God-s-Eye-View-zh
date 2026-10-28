// 诊断 3：谁在 reload 后把 cctv-panel 挪进/挪出 body（monkey-patch DOM 插入 + stack）
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
await page.evaluateOnNewDocument(() => {
  const keep = (window.name || '').indexOf('keep') >= 0;
  if (!keep) {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.removeItem('gev-liquid-cards:v2:last');
  }
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  localStorage.setItem('gev.perfMode', '0');
  window.__mv = [];
  const t0 = performance.now();
  const log = (op, node, parent) => {
    try {
      if (!node || node.id !== 'cctv-panel') return;
      window.__mv.push({ t: Math.round(performance.now() - t0), op, parent: parent ? parent.id || parent.tagName : null, stack: (new Error().stack || '').split('\n').slice(2, 6).join(' | ') });
    } catch (e) {}
  };
  const ap = Node.prototype.appendChild;
  Node.prototype.appendChild = function (n) { const r = ap.call(this, n); log('appendChild', n, this); return r; };
  const ib = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (n, ref) { const r = ib.call(this, n, ref); log('insertBefore', n, this); return r; };
  const ra = Element.prototype.removeChild;
  Element.prototype.removeChild = function (n) { const r = ra.call(this, n); log('removeChild', n, this); return r; };
});
const snap = () => page.evaluate(() => {
  const e = document.getElementById('cctv-panel');
  const r = document.getElementById('right-context-rail');
  const q = (id) => { const n = document.getElementById(id); const s = n && getComputedStyle(n); return n ? { disp: s.display, cls: n.className, inline: (n.getAttribute('style') || '').slice(0, 120) } : null; };
  return {
    ids: window.__gevLc ? window.__gevLc._ids() : null,
    cctvParent: e && e.parentElement ? (e.parentElement.id || e.parentElement.tagName) : null,
    cctv: q('cctv-panel'), pp: q('pp-toggles'), gcp: q('global-context-panel'),
    railCls: r ? r.className : null,
  };
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(11000);
// 真实点击 cctv
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
await sleep(1400);
const before = await snap();
await page.evaluate(() => (window.name = 'keep'));
await page.reload({ waitUntil: 'domcontentloaded' });
const series = [];
for (const ms of [1500, 3000, 5000, 6500, 8000, 9000, 11000, 14000]) {
  await sleep(ms - (series.length ? series[series.length - 1].at : 0));
  const s = await snap();
  s.at = ms;
  series.push(s);
}
const mv = await page.evaluate(() => window.__mv || []);
fs.writeFileSync(OUT + '/_diag-moves.json', JSON.stringify({ before, series, mv }, null, 1));
console.log('before reload:', JSON.stringify(before));
for (const s of series) console.log(s.at + 'ms', 'ids=' + JSON.stringify(s.ids), 'parent=' + s.cctvParent, 'rail=' + s.railCls, 'cctv.disp=' + (s.cctv && s.cctv.disp), 'pp.disp=' + (s.pp && s.pp.disp), 'gcp.disp=' + (s.gcp && s.gcp.disp));
console.log('--- DOM moves of #cctv-panel ---');
for (const m of mv) console.log(m.t + 'ms', m.op, '->', m.parent, '|', m.stack.slice(0, 220));
await browser.close();
