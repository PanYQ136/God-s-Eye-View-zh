// 诊断 4：reload 后 prime-open cctv 用的 nat/miniRect 与 heal-parent 时序（3 轮）
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
page.on('console', (m) => {
  const t = m.text();
  if (t.indexOf('[gev-lc]') >= 0) logs.push(t.slice(0, 260));
});
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
    const e = document.getElementById('cctv-panel');
    const r = document.getElementById('right-context-rail');
    const L = document.getElementById('left-panel-stack');
    window.__tl.push({
      t: Math.round(performance.now() - t0),
      parent: e && e.parentElement ? (e.parentElement.id || e.parentElement.tagName) : null,
      rect: e ? [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)] : null,
      inline: e ? (e.getAttribute('style') || '').slice(0, 90) : null,
      rail: r ? r.className : null,
      L: L ? getComputedStyle(L).transform : null,
    });
  };
  for (let i = 0; i < 80; i++) setTimeout(sample, 200 * i);
});
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
const out = [];
for (let run = 1; run <= 3; run++) {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
  await sleep(11000);
  await clickHeader('cctv-panel');
  await page.evaluate(() => (window.name = 'keep'));
  const mark = logs.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(12000);
  const tl = await page.evaluate(() => window.__tl || []);
  const cctv = await page.evaluate(() => {
    const e = document.getElementById('cctv-panel');
    const b = e.getBoundingClientRect();
    return { parent: e.parentElement.id || e.parentElement.tagName, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
  });
  out.push({ run, cctv, logs: logs.slice(mark) });
  console.log('== run', run, JSON.stringify(cctv));
  let prev = '';
  for (const row of tl) {
    const k = row.parent + '|' + JSON.stringify(row.rect) + '|' + row.inline + '|' + row.rail;
    if (k === prev) continue;
    prev = k;
    console.log('  ', row.t + 'ms', 'parent=' + row.parent, 'rect=' + JSON.stringify(row.rect), 'rail=' + row.rail, 'inline=' + (row.inline || '').slice(0, 70));
  }
  for (const l of logs.slice(mark).filter((x) => /open cctv|heal-parent|prime-open|plan cctv/.test(x)).slice(0, 12)) console.log('   log', l.slice(0, 200));
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} window.name = ''; });
}
fs.writeFileSync(OUT + '/_diag-prime-timing.json', JSON.stringify(out, null, 1));
await browser.close();
