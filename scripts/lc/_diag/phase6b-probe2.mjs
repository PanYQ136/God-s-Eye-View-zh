#!/usr/bin/env node
/* Phase6B 深挖：data/scene 头部下移 14px 的成因 + voice 卡横向溢出源 + 结构树 */
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

const tree = (id, maxDepth = 4) => page.evaluate((id, maxDepth) => {
  const root = document.getElementById(id);
  const b = root.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  const walk = (el, depth) => {
    const r = el.getBoundingClientRect();
    const s = cs(el);
    const node = {
      tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      rect: [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
      relTop: Math.round((r.top - b.top) * 10) / 10,
      relBottom: Math.round((b.bottom - r.bottom) * 10) / 10,
      rightOver: Math.round((r.right - b.right) * 10) / 10,
      disp: s.display, pos: s.position, m: s.margin, pad: s.padding, gap: s.gap, dir: s.flexDirection,
      align: s.alignItems, justify: s.justifyContent, h: s.height, minH: s.minHeight, ov: s.overflow,
      vis: s.visibility, op: s.opacity, trans: s.transform, z: s.zIndex, grid: s.gridTemplateRows + '/' + s.gridTemplateColumns, flexGrow: s.flexGrow, flexBasis: s.flexBasis,
      txt: (el.children.length === 0 ? (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34) : ''),
    };
    node.kids = depth <= 0 ? undefined : [...el.children].map((k) => walk(k, depth - 1));
    return node;
  };
  return walk(root, maxDepth);
}, id, maxDepth);

const out = {};
out.dataMini = await tree('data-panel', 3);
out.sceneMini = await tree('scene-panel', 3);
out.voiceMini = await tree('gev-voice-control', 3);
out.voiceParentChain = await page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  const a = []; let n = el.parentElement;
  for (let i = 0; i < 6 && n; i++) { a.push(n.id || String(n.className).slice(0, 30)); n = n.parentElement; }
  const cv = el.querySelector('.gev-voice-cost-value');
  const tier = el.querySelector('.gev-voice-tier-btn');
  return {
    chain: a,
    costValue: cv ? { disp: getComputedStyle(cv).display, rect: [Math.round(cv.getBoundingClientRect().x), Math.round(cv.getBoundingClientRect().width)], txt: cv.textContent.trim() } : null,
    tier: tier ? { disp: getComputedStyle(tier).display, txt: tier.textContent.trim(), rect: [Math.round(tier.getBoundingClientRect().x), Math.round(tier.getBoundingClientRect().width)] } : null,
    beyond: [...el.querySelectorAll('*')].map((x) => { const r = x.getBoundingClientRect(); const c = el.getBoundingClientRect(); return { t: x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 24), over: Math.round(r.right - c.right), w: Math.round(r.width), ov: getComputedStyle(x).overflow, txt: (x.textContent || '').trim().slice(0, 18) }; }).filter((x) => x.over > 0).slice(0, 12),
    stage: el.parentElement && el.parentElement.className,
  };
});
/* voice 展开：点 heading 正中 */
const hp = await page.evaluate(() => { const h = document.querySelector('#gev-voice-control .gev-voice-heading'); const r = h.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.click(hp.x, hp.y, { delay: 40 });
await sleep(1600);
out.voiceOpen = await tree('gev-voice-control', 3);
out.voiceOpenRect = await page.evaluate(() => { const el = document.getElementById('gev-voice-control'); const b = el.getBoundingClientRect(); return { phase: el.dataset.lcPhase, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, parent: el.parentElement.className || el.parentElement.id, beyond: [...el.querySelectorAll('*')].map((x) => { const r = x.getBoundingClientRect(); return { t: x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 22), over: Math.round(r.right - b.right), below: Math.round(r.bottom - b.bottom), w: Math.round(r.width), txt: (x.textContent || '').trim().slice(0, 16) }; }).filter((x) => x.over > 0 || x.below > 0).slice(0, 14) }; });
await page.screenshot({ path: `${OUT}/voice2-open.png` }).catch(() => {});

/* hud 可见性链 */
out.hudVis = await page.evaluate(() => {
  const el = document.getElementById('hud-summary');
  const chain = []; let n = el;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    if (s.visibility !== 'visible' || s.opacity !== '1' || s.display === 'none') chain.push({ t: n.id || String(n.className).slice(0, 24), vis: s.visibility, op: s.opacity, disp: s.display });
    n = n.parentElement;
  }
  return { chain, bodyCls: document.body.className, hudActive: document.getElementById('intel-hud') ? document.getElementById('intel-hud').className : null };
});

writeFileSync(`${OUT}/probe2.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
