#!/usr/bin/env node
/* Phase6B probe3：voice 卡开合路径 + hover 态溢出 + 语音卡视觉裁切 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6b';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 100; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(5000);

const out = {};
const state = () => page.evaluate(() => {
  const v = document.getElementById('gev-voice-control');
  const b = v.getBoundingClientRect();
  return {
    phase: v.dataset.lcPhase, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    sw: v.scrollWidth, cw: v.clientWidth, parent: v.parentElement.id || String(v.parentElement.className).slice(0, 24),
    status: v.dataset.status, cls: v.className,
  };
});
out.t0 = await state();
out.api = await page.evaluate(() => {
  const a = window.__lc && window.__lc.api;
  return a ? Object.keys(a) : null;
});
/* 卡内命中测试：heading 中心处的实际元素 */
out.hit = await page.evaluate(() => {
  const h = document.querySelector('#gev-voice-control .gev-voice-heading');
  const r = h.getBoundingClientRect();
  const pt = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 26) + (e.id ? '#' + e.id : '') : null; };
  return { headingRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], center: pt(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)), left: pt(Math.round(r.x + 6), Math.round(r.y + r.height / 2)) };
});
await page.screenshot({ path: `${OUT}/v3-mini.png`, clip: { x: 560, y: 620, width: 260, height: 150 } }).catch(() => {});

/* 尝试三种真实点击点 */
const tryClick = async (label, x, y) => {
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(150);
  await page.mouse.click(x, y, { delay: 60 });
  const samples = [];
  for (let i = 0; i < 8; i++) { await sleep(220); samples.push((await state()).phase); }
  const st = await state();
  out['click_' + label] = { samples, st };
  return st;
};
const hr = out.hit.headingRect;
const st1 = await tryClick('headingLeft', Math.round(hr[0] + 6), Math.round(hr[1] + hr[2] ? hr[1] + 6 : hr[1] + 6));
out.afterFirst = st1;
if (st1.phase === 'mini') {
  /* 再点一次卡顶标题区（可能第一次点到了控件） */
  await tryClick('headingRight', Math.round(hr[0] + hr[2] - 6), Math.round(hr[1] + 6));
} else {
  /* 已展开：等动画结束，量溢出 */
  await sleep(900);
  out.openState = await state();
  out.openTree = await page.evaluate(() => {
    const v = document.getElementById('gev-voice-control');
    const b = v.getBoundingClientRect();
    return [...v.querySelectorAll('*')].map((x) => {
      const r = x.getBoundingClientRect(), s = getComputedStyle(x);
      return { t: x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 24), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], sw: x.scrollWidth, cw: x.clientWidth, over: Math.round(r.right - b.right), disp: s.display, vis: s.visibility, ws: s.whiteSpace, ov: s.overflow, txt: (x.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) };
    }).filter((x) => x.over > 1 || x.sw > x.cw + 1);
  });
  await page.screenshot({ path: `${OUT}/v3-open.png`, clip: { x: Math.max(0, out.openState.rect[0] - 20), y: Math.max(0, out.openState.rect[1] - 20), width: out.openState.rect[2] + 40, height: out.openState.rect[3] + 40 } }).catch(() => {});
  await page.screenshot({ path: `${OUT}/v3-open-full.png` }).catch(() => {});
}
out.final = await state();
writeFileSync(`${OUT}/probe3.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
