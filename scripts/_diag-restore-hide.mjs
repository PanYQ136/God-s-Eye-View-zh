// 诊断：restore（刷新恢复 cctv 浮层）路径下，pp-toggles / global-context-panel 为何 display:none
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
});
const dump = () =>
  page.evaluate(() => {
    const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
    const out = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) { out[id] = null; continue; }
      const s = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      out[id] = {
        display: s.display, vis: s.visibility, op: s.opacity,
        inline: e.getAttribute('style') || '',
        cls: e.className,
        parent: e.parentElement ? (e.parentElement.id || e.parentElement.tagName) : null,
        parentDisplay: e.parentElement ? getComputedStyle(e.parentElement).display : null,
        rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
        collapsed: e.classList.contains('collapsed'),
        floating: e.classList.contains('gev-lc-floating'),
        hidden: e.hasAttribute('hidden'),
        dataVis: e.dataset ? (e.dataset.visible || e.dataset.vis || '') : '',
      };
    }
    const rails = {};
    for (const rid of ['right-context-rail', 'left-panel-stack', 'command-dock']) {
      const r = document.getElementById(rid);
      if (!r) continue;
      rails[rid] = {
        inline: r.getAttribute('style') || '',
        cls: r.className,
        display: getComputedStyle(r).display,
        kids: [...r.children].map((c) => (c.id || c.className) + ':' + getComputedStyle(c).display),
      };
    }
    return { cards: out, rails, floating: window.__gevLc ? window.__gevLc._ids() : null, store: window.__gevLc ? window.__gevLc.store() : null };
  });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(11000);
const html = await page.evaluate(() => document.documentElement.className);
const A0 = await dump();

// 用真实鼠标点 cctv header
const pt = await page.evaluate(() => {
  const el = document.getElementById('cctv-panel');
  const node = el.querySelector('.panel-header,.pp-header-row') || el;
  const r = node.getBoundingClientRect();
  for (let fy = 0.5; fy <= 0.9; fy += 0.2)
    for (let fx = 0.12; fx <= 0.92; fx += 0.08) {
      const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) return { x, y, hit: hit.tagName + '.' + String(hit.className || '').split(' ')[0] };
    }
  return null;
});
await page.mouse.move(pt.x, pt.y, { steps: 4 });
await sleep(30);
await page.mouse.down(); await sleep(45); await page.mouse.up();
await sleep(1200);
const A1 = await dump();
await page.evaluate(() => (window.name = 'keep'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
const B = await dump();
const htmlB = await page.evaluate(() => document.documentElement.className);
await page.screenshot({ path: OUT + '/_diag-reload.png' });
fs.writeFileSync(OUT + '/_diag-restore.json', JSON.stringify({ html, A0, clickPt: pt, A1, htmlB, B }, null, 1));
console.log('htmlClass before:', html, '| after reload:', htmlB);
for (const [tag, S] of [['A0-initial', A0], ['A1-after-click', A1], ['B-after-reload', B]]) {
  console.log('\n==', tag, 'floating=', S.floating, 'store=', JSON.stringify(S.store));
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
    const c = S.cards[id];
    console.log('  ', id, c ? `disp=${c.display} vis=${c.vis} op=${c.op} parent=${c.parent}(${c.parentDisplay}) inline="${c.inline}" cls="${c.cls}"` : 'null');
  }
  console.log('  rails=', JSON.stringify(S.rails['right-context-rail']));
}
await browser.close();
