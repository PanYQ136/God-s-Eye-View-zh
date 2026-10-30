#!/usr/bin/env node
/* 探针：落位之后 tileset 的哪几个信号能真正表示「瓦片已上屏」 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 200; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(200);
}
const series = [];
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => {
    const v = window.__gevViewer;
    let ts = null;
    try {
      const p = v.scene.primitives;
      for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded && typeof q.tilesLoaded === 'boolean') ts = q; }
    } catch (e) {}
    const st = ts && ts.statistics;
    return {
      t: Math.round(performance.now()),
      loaded: ts ? !!ts.tilesLoaded : null,
      contentReady: st ? st.numberOfTilesWithContentReady : null,
      cmds: st ? st.numberOfCommands : null,
      selected: st ? st.numberOfTilesSelected : null,
      visits: st ? st.numberOfTilesVisited : null,
    };
  });
  series.push(s);
  await sleep(250);
}
console.log(series.map((s) => [s.t, s.loaded ? 1 : 0, s.contentReady, s.cmds, s.selected, s.visits].join('/')).join('\n'));
writeFileSync('.gev-logs/lc/phase6c3/probe-tileset.json', JSON.stringify(series, null, 1));
await browser.close();
