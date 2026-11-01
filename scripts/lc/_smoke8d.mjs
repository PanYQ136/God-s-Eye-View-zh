#!/usr/bin/env node
/* Phase8D 冒烟：总线接管后的真实交互（1 页面 / 真鼠标 / 6 条断言）
   A1 桥就位且槽位齐全（lc / lc.api / lc.glass / edge.lens / boot / gpu / app.panelApi）
   A2 兼容面身份一致：window.__lc.api === bridge.get('lc.api')
   A3 真实点击开卡 → morph 记录进 lc.morph.last（bus 写入可见）
   A4 变形期 lens 被关：edge.cfg().enabled === false（#3 的契约经桥仍然成立）
   A5 变形结束 1 帧后 lens 恢复 true
   A6 再点一次收起 → phase 回到 mini、lens 仍 true，且无 pageerror
*/
import puppeteer from 'puppeteer';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__gevBoot && window.__gevBoot.state === 'interactive'), { timeout: 60000 });
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.mounted), { timeout: 60000 });
await sleep(2500);

const R = { asserts: [] };
const ok = (id, pass, detail) => R.asserts.push({ id, pass: !!pass, detail });

/* A1 */
const slots = await page.evaluate(() => globalThis.__gevBridge.list().map((s) => s.name));
ok('A1 桥槽位', ['lc', 'lc.api', 'lc.glass', 'edge.lens', 'edge.lensState', 'boot', 'gpu', 'app.panelApi'].every((n) => slots.includes(n)), slots.join(','));

/* A2 */
const ident = await page.evaluate(() => window.__lc.api === globalThis.__gevBridge.get('lc.api'));
ok('A2 兼容面身份', ident, 'window.__lc.api === bridge.get(lc.api)');

/* 真实鼠标点开 #data-panel 的标题热区 */
/* 热区 = 标题行（.panel-header）正中，和 gate 的 pp 开卡口径一致 */
const headerPt = () => page.evaluate(() => {
  const el = document.querySelector('#data-panel .panel-header') || document.querySelector('#data-panel');
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, what: (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || {}).className || '' };
});
const box = await headerPt();
if (!box) { ok('A3-A5', false, 'no #data-panel'); }
else {
  await page.mouse.move(box.x, box.y);
  await sleep(120);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();

  /* 变形期采样：lens 应被关掉（morph→lens 契约） */
  const samples = [];
  for (let i = 0; i < 24; i++) {
    samples.push(await page.evaluate(() => ({
      t: +performance.now().toFixed(0),
      phase: (window.__lc.api.state().cards['data-panel'] || {}).phase,
      lens: window.__gevEdge && window.__gevEdge.cfg ? window.__gevEdge.cfg().enabled : null,
    })));
    await sleep(35);
  }
  await sleep(900);
  const after = await page.evaluate(() => ({
    phase: (window.__lc.api.state().cards['data-panel'] || {}).phase,
    lens: window.__gevEdge.cfg().enabled,
    morph: (window.__lc.morph && window.__lc.morph.last) || null,
    viaBridge: !!(globalThis.__gevBridge.get('lc') || {}).morph,
  }));
  ok('A3 morph 经总线写入', !!(after.morph && after.morph.id), JSON.stringify(after.morph && { id: after.morph.id, duration: after.morph.duration }) + ' clicked:' + JSON.stringify(box));
  ok('A4 变形期 lens 关闭', samples.some((s) => s.lens === false), `samples lens: ${[...new Set(samples.map((s) => s.lens))].join('/')}`);
  ok('A5 变形后 lens 恢复', after.lens === true, `lens=${after.lens} phase=${after.phase}`);

  /* 收起：展开后卡壳位置变了，必须重新量热区（否则点在卡体内部，不触发开合） */
  const box2 = await headerPt();
  await page.mouse.move(box2.x, box2.y);
  await sleep(120);
  await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(1200);
  const closed = await page.evaluate(() => ({
    phase: document.getElementById('data-panel').getAttribute('data-lc-phase'),
    statePhase: (window.__lc.api.state().cards['data-panel'] || {}).phase,
    lens: window.__gevEdge.cfg().enabled,
  }));
  ok('A6 收起后回到 mini', closed.phase === 'mini' && closed.lens === true, JSON.stringify(closed) + ' clicked:' + JSON.stringify(box2));
}

/* 截图：1x 全图（视觉复核用） */
await page.screenshot({ path: '.gev-logs/lc/phase8d/shot-D-1x.png' });
R.errors = errs.slice(0, 6);
R.pass = R.asserts.every((a) => a.pass) && errs.length === 0;
console.log(JSON.stringify(R, null, 1));
await browser.close();
process.exit(R.pass ? 0 : 1);
