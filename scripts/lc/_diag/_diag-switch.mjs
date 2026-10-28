import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'], protocolTimeout: 300000, defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(8000);
/* 先开 data */
let p = await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(p.x, p.y, { steps: 3 }); await page.mouse.down(); await sleep(28); await page.mouse.up();
await sleep(1400);
/* 在页面里挂一个逐帧记录器 */
await page.evaluate(() => {
  window.__trace = [];
  const tick = () => {
    try {
      const r = window.__lc.result || {};
      const b = (r.boxes || {})['scene-panel'];
      const db = (r.boxes || {})['data-panel'];
      const e = document.getElementById('scene-panel');
      const a = e.getAnimations()[0];
      window.__trace.push({
        t: Math.round(performance.now()),
        ph: window.__lc.api.phases(),
        sceneBox: b ? [b.x, b.y, b.w, b.h] : null,
        dataBox: db ? [db.x, db.y, db.w, db.h] : null,
        sceneAnims: e.getAnimations().length,
        ct: a ? Math.round(a.currentTime || 0) : null,
        ps: a ? a.playState : null,
        viol: (window.__lc.violations || []).map((v) => JSON.stringify(v).slice(0, 120)),
        rail: [...document.getElementById('left-panel-stack').children].map((n) => { const b = n.getBoundingClientRect(); return { k: n.id || n.className, o: getComputedStyle(n).order, y: Math.round(b.y), h: Math.round(b.height) }; }),
        ph: [...document.querySelectorAll('.gev-lc-placeholder')].map((n) => { const b = n.getBoundingClientRect(); return { for: n.dataset.lcFor, o: getComputedStyle(n).order, y: Math.round(b.y), h: Math.round(b.height) }; }),
      });
    } catch (err) { window.__trace.push({ err: String(err) }); }
    if (window.__trace.length < 120) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
/* 再点 scene */
p = await page.evaluate(() => { const b = document.querySelector('#scene-panel .panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(p.x, p.y, { steps: 3 }); await page.mouse.down(); await sleep(28); await page.mouse.up();
await sleep(2000);
const tr = await page.evaluate(() => window.__trace);
const seen = new Set();
for (const r of tr) {
  if (!r.ph) continue;
  const key = `${r.ph['data-panel']}|${r.ph['scene-panel']}|${JSON.stringify(r.sceneBox)}|${JSON.stringify(r.rail)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(r.t, 'data=' + r.ph['data-panel'], 'scene=' + r.ph['scene-panel'], 'sceneBox=' + JSON.stringify(r.sceneBox), 'anims=' + r.sceneAnims, 'ct=' + r.ct, 'rail=' + JSON.stringify(r.rail), 'ph=' + JSON.stringify(r.ph2 || r.ph), 'viol=' + r.viol.length);
}
console.log('总帧', tr.length, 'errors', JSON.stringify(errs));
await browser.close();
