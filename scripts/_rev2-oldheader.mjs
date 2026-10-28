#!/usr/bin/env node
/** _rev2-oldheader.mjs — 互斥切换后「旧 header 仍可见可点」的证据：
 *  每例：打开 A → 点 B（A 应收起、B 打开）→ 命中测试 A header 中心（owner 必须是 A）
 *        → 真实点击 A header（A 重新打开、B 收起）
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/rev2-accept');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__rv = { down: 0, downTrusted: 0, click: 0, clickTrusted: 0 };
  const rec = (e) => { const o = window.__rv; if (e.type === 'pointerdown') { o.down++; if (e.isTrusted) o.downTrusted++; } else { o.click++; if (e.isTrusted) o.clickTrusted++; } };
  for (const t of ['pointerdown', 'click']) document.addEventListener(t, rec, true);
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8500);
const opened = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel'];
  return ids.filter((i) => { const e = document.getElementById(i); return e && !e.classList.contains('collapsed'); });
});
const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const e = document.getElementById(id);
    const h = e.querySelector('.panel-title, .pp-header-label, .panel-header, .pp-header-row') || e;
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, id);
  await page.mouse.move(p.x, p.y); await sleep(70); await page.mouse.down(); await sleep(45); await page.mouse.up();
  await sleep(1400);
  return p;
};
const hitAt = (id) => page.evaluate((id) => {
  const e = document.getElementById(id);
  const h = e.querySelector('.panel-title, .pp-header-label, .panel-header, .pp-header-row') || e;
  const r = h.getBoundingClientRect();
  const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  const own = el && el.closest ? el.closest('[id]') : null;
  const cs = getComputedStyle(e);
  return { rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
    hit: el ? el.tagName + '.' + String(el.className || '').slice(0, 26) : null,
    owner: own ? own.id : null, onOwnHeader: !!(el && h.contains(el)),
    hidden: cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < .05 };
}, id);

const cases = [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'], ['pp-toggles', 'cctv-panel'],
  ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']];
const out = [];
for (const [A, B] of cases) {
  let now = await opened();
  if (!now.includes(A)) { await clickHeader(A); }
  if (!(await opened()).includes(A)) { out.push({ case: A + '->' + B, error: 'cannot open A' }); continue; }
  const pB = await clickHeader(B);
  const afterSwap = await opened();
  const hitA = await hitAt(A);
  const pA2 = await clickHeader(A);        // 真实点击旧 header
  const afterBack = await opened();
  const hitB = await hitAt(B);
  out.push({ case: A + '->' + B, clickedB: pB, openedAfterSwap: afterSwap, oldHeader: hitA,
    clickedOldA: pA2, openedAfterOldClick: afterBack,
    newHeaderAfter: hitB, verdict: { onlyOneAfterSwap: afterSwap.filter((x) => [A, B].includes(x)).length <= 1 && afterSwap.includes(B),
      oldHeaderClickable: hitA.onOwnHeader && !hitA.hidden, backSwap: afterBack.includes(A) && !afterBack.includes(B) } });
}
const trust = await page.evaluate(() => window.__rv);
console.log(JSON.stringify({ out, trust }, null, 1));
fs.writeFileSync(path.join(OUT, 'oldheader.json'), JSON.stringify({ out, trust }, null, 1));
await browser.close();
