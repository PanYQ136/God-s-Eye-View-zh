#!/usr/bin/env node
/* 一次性探针：冷加载后列出所有 layer 的 enabled / error / keyRequired，以及 live-data 主开关、
   LOAD FAILED 芯片当前状态；用于给 fail-chip 复现选靶（不改产品代码）。
   用法: node scripts/lc/_diag/_probe-layers.mjs */
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist',
    '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 } });
const p = await b.newPage(); await p.bringToFront();
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {} try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {} });
await p.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 800; i++) {
  const ok = await p.evaluate(() => !!(window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot().interactiveAt != null)).catch(() => false);
  if (ok) break; await new Promise((r) => setTimeout(r, 60));
}
const out = await p.evaluate(() => {
  const dm = window.__godsEyeView && window.__godsEyeView.dataManager;
  const list = dm && dm.layers && dm.layers.values ? [...dm.layers.values()] : [];
  const chip = document.getElementById('global-loading-status');
  return {
    n: list.length,
    enabled: list.filter((l) => l.enabled).map((l) => ({ id: l.id, err: l.error ? String(l.error).slice(0, 60) : null, key: l.keyRequired || null, st: l.stats && l.stats.status })),
    allWithErr: list.filter((l) => l.error).map((l) => ({ id: l.id, err: String(l.error).slice(0, 60) })),
    chip: chip ? { hidden: chip.hidden, state: chip.dataset.state || null, text: document.getElementById('global-loading-label').textContent } : null,
    keys: Object.keys(dm || {}).slice(0, 40),
    liveData: (() => { try { return window.__gevLiveData ? Object.keys(window.__gevLiveData) : null; } catch (e) { return 'err'; } })(),
  };
});
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
await b.close();
