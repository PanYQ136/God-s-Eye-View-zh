import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, H = 774;
const b = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'load' });
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => 0)) break; await sleep(400); }
await sleep(5000);
const r = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
const s = await p.evaluate(() => window.__gevEdge.stats());
console.log('surfaces', JSON.stringify(s.surfaces));
console.log('card rect', JSON.stringify(r), 'canvas', JSON.stringify(s.canvas), 'scale', s.scale, 'tex', s.tex);
/* 内置同帧取样钩子：读卡片顶沿一条横带（在 draw 内 readPixels） */
const grab = (y) => p.evaluate((y) => new Promise((res) => {
  window.__gevEdgeGrab = { x: 60, y: y, w: 60 };
  const iv = setInterval(() => {
    if (window.__gevEdgeGrabOut) { const o = window.__gevEdgeGrabOut; window.__gevEdgeGrabOut = null; clearInterval(iv); res(o); }
  }, 60);
  setTimeout(() => { clearInterval(iv); res(null); }, 4000);
}), y);
for (const y of [r.y - 2, r.y, r.y + 1, r.y + 3, r.y + 6, r.y + 10, r.y + 20]) {
  const o = await grab(Math.round(y));
  if (!o) { console.log('y', y, 'no grab'); continue; }
  const px = o.row.map((c) => c[3]);
  const nz = px.filter((a) => a > 0).length;
  console.log(`y=${Math.round(y)} nonZeroAlpha=${nz}/${px.length} alphaMax=${Math.max(...px)} rgbSample=${JSON.stringify(o.row.slice(20, 24))}`);
}
await b.close();
