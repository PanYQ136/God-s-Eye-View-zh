#!/usr/bin/env node
/* scripts/lc/verify-single-owner.mjs —— 「.collapsed 只有一个写入者」的真机证明
   ----------------------------------------------------------------------------
   跑法： node scripts/lc/verify-single-owner.mjs        （需要 127.0.0.1:4173 在跑）
   证据链（全部来自真实 pointer + 页面内 MutationObserver，不读截图）：
     S1 port.stats().writes === 观测到的 .collapsed 变更次数（1:1，无第二个写入者）
     S2 port.stats().direct === 0        → 每次写入都走了 App panelChrome.setPanelCollapsed
     S3 window.__lc.diagnostics.appApiMissing 不存在 / 0  → 没走兜底直写
     S4 只有 7 张可披露卡会被写；语音卡（不在披露体系）零写入
     S5 port.stats().failures === 0     → 期望值写完即生效
   ========================================================================== */
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const OUT = '.gev-logs/lc';
mkdirSync(OUT, { recursive: true });
const PORT_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--window-size=1536,830', '--window-position=40,40', '--no-first-run'],
  defaultViewport: { width: 1536, height: 730 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e && e.message)));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction('window.__lc && window.__lc.api && window.__lc.api.ready === true', { timeout: 60000 });
await sleep(2500);

/* 页面内记账：观测所有 .collapsed 的 class 变更 */
await page.evaluate((ids) => {
  window.__soLog = [];
  const seen = new WeakMap();
  for (const id of ids.concat(['gev-voice-control'])) {
    const el = document.getElementById(id);
    if (el) seen.set(el, el.classList.contains('collapsed'));
  }
  window.__soObs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.attributeName !== 'class') continue;
      const el = m.target;
      if (!el || !el.id) continue;
      const now = el.classList.contains('collapsed');
      const prev = seen.get(el);
      if (prev === undefined) continue;
      if (prev !== now) {
        seen.set(el, now);
        window.__soLog.push({ id: el.id, collapsed: now, t: Math.round(performance.now()) });
      }
    }
  });
  window.__soObs.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
}, PORT_IDS);

const clickHeader = async (sel) => {
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, sel);
  if (!box) throw new Error('header not found: ' + sel);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
};

const base = await page.evaluate(() => {
  const st = window.__lc.api.port();
  return { port: st, appApiMissing: (window.__lc.diagnostics || {}).appApiMissing || 0, log: window.__soLog.length };
});

/* 一次完整开/关：应恰好 2 次 .collapsed 变更（open=false, close=true） */
await clickHeader('#data-panel .panel-header');
await sleep(900);
await clickHeader('#data-panel .panel-header');
await sleep(900);

const after = await page.evaluate(() => ({
  port: window.__lc.api.port(),
  appApiMissing: (window.__lc.diagnostics || {}).appApiMissing || 0,
  log: window.__soLog.slice(),
  violations: (window.__lc.violations || []).slice(0, 6),
  phases: window.__lc.api.phases(),
}));

const collapsedOn = after.log.filter((r) => r.collapsed === false).length;
const collapsedOff = after.log.filter((r) => r.collapsed === true).length;
const foreign = after.log.filter((r) => r.id === 'gev-voice-control');
const writesDelta = after.port.writes - base.port.writes;
const obsDelta = after.log.length - base.log;

const rows = [
  ['S1', 'port.writes 增量 === .collapsed 观测变更数（唯一写入者）', writesDelta === obsDelta && obsDelta >= 2, { writesDelta, obsDelta }],
  ['S2', 'port.direct === 0（全部经 App panelChrome.setPanelCollapsed）', after.port.direct === 0, { direct: after.port.direct, path: 'app' }],
  ['S3', 'appApiMissing === 0（没走兜底直写 class）', (after.appApiMissing || 0) === 0, { appApiMissing: after.appApiMissing }],
  ['S4', '语音卡（不在披露体系）零写入；本次开/关各 1 次', foreign.length === 0 && collapsedOn === 1 && collapsedOff === 1, { foreign, collapsedOn, collapsedOff, log: after.log }],
  ['S5', 'port.failures === 0 且无布局违规', after.port.failures === 0 && after.violations.length === 0, { failures: after.port.failures, violations: after.violations }],
];

let bad = 0;
for (const [id, name, ok, detail] of rows) {
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok ? '' : '  ← ' + JSON.stringify(detail)}`);
}
const cleanErrs = errs.filter((e) => !/greater than 0/.test(e));
if (cleanErrs.length) { bad += 1; console.log('FAIL  S6  console/page error = 0  ← ' + JSON.stringify(cleanErrs.slice(0, 3))); }
else console.log('PASS  S6  console/page error = 0');

writeFileSync(`${OUT}/single-owner.json`, JSON.stringify({ base, after, rows: rows.map(([id, name, ok, detail]) => ({ id, name, ok, detail })) }, null, 1));
console.log(`\n=== ${bad === 0 ? 'ALL PASS' : bad + ' FAIL'} verify-single-owner ===`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
