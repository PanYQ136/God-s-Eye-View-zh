import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,730'] });
const p = await b.newPage();
await p.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await p.keyboard.press('Escape').catch(() => {});
await p.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(2500);
const info = await p.evaluate(() => {
  const el = document.getElementById('data-panel');
  const desc = (n, d = 0) => ({ t: n.tagName, id: n.id, cls: String(n.className).slice(0, 70), r: (() => { const q = n.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })(), kids: d < 3 ? [...n.children].slice(0, 6).map((c) => desc(c, d + 1)) : undefined });
  return { outer: el.outerHTML.slice(0, 700), tree: desc(el), collapsed: el.classList.contains('collapsed'), gevLc: el.dataset.gevLc };
});
console.log(JSON.stringify(info, null, 1));
// try click candidates
const cands = ['#data-panel .panel-header', '#data-panel .pp-panel-head', '#data-panel h2', '#data-panel .pp-panel-title', '#data-panel [role="button"]', '#data-panel'];
for (const sel of cands) {
  const r = await p.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return { sel, missing: true };
    const before = document.getElementById('data-panel').classList.contains('collapsed');
    el.click();
    return { sel, before, after: document.getElementById('data-panel').classList.contains('collapsed') };
  }, sel);
  await sleep(800);
  r.settled = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { collapsed: document.getElementById('data-panel').classList.contains('collapsed'), h: Math.round(q.height), w: Math.round(q.width) }; });
  console.log(JSON.stringify(r));
  if (!r.settled.collapsed) { await p.evaluate(() => document.getElementById('data-panel').classList.add('collapsed')); await sleep(600); }
}
await b.close();
