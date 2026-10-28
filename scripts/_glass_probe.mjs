#!/usr/bin/env node
/**
 * _glass_probe.mjs —— 透明液态玻璃材质探针（只读）
 * 输出：每张卡的 rect / floating / collapsed / 卡壳+内层 computed 背景 / backdrop-filter
 * 用法: node scripts/_glass_probe.mjs [--vp=1536x730] [--shot=path.png]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const VP = arg('vp', '1536x730').split('x').map(Number);
const SHOT = arg('shot', '');
const OUT = arg('out', '.gev-logs/glass/probe.json');
const URL = arg('url', 'http://localhost:4173/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${VP[0]},${VP[1]}`,
  ],
  defaultViewport: { width: VP[0], height: VP[1], deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.setViewport({ width: VP[0], height: VP[1] });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000); // 等 App 启动/搬容器/Cesium 就绪

const data = await page.evaluate(() => {
  const ids = [
    'data-panel',
    'scene-panel',
    'pp-toggles',
    'cctv-panel',
    'global-context-panel',
    'location-bar',
    'control-panel',
    'gev-voice-control',
    'gev-gfx-fab',
  ];
  const cs = (el) => getComputedStyle(el);
  const out = { cards: {}, bgOffenders: [], closeBtns: 0, warp: [] };
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) {
      out.cards[id] = null;
      return;
    }
    const b = el.getBoundingClientRect();
    const c = cs(el);
    const warp = el.querySelector(':scope > .gev-lg-warp');
    const rec = {
      rect: {
        x: Math.round(b.left),
        y: Math.round(b.top),
        w: Math.round(b.width),
        h: Math.round(b.height),
      },
      floating: el.classList.contains('gev-lc-floating'),
      collapsed: el.classList.contains('collapsed'),
      hidden: c.visibility === 'hidden' || +c.opacity === 0,
      bg: c.backgroundColor,
      bgImage: c.backgroundImage.slice(0, 60),
      backdrop: (c.backdropFilter || '') + '|' + (c.webkitBackdropFilter || ''),
      filt: c.filter,
      warpBackdrop: warp ? (cs(warp).backdropFilter || cs(warp).webkitBackdropFilter || 'none') : 'no-warp',
      warpFilt: warp ? cs(warp).filter : 'no-warp',
    };
    // 卡内「可见暗底」扫描：alpha>0.02 且不是纯白极淡的 solid/gradient
    const bad = [];
    el.querySelectorAll('*').forEach((d) => {
      if (d.closest('.gev-lc-edge')) return;
      const s = cs(d);
      const m = (s.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(',').map((x) => parseFloat(x));
        const a = p.length > 3 ? p[3] : 1;
        if (a > 0.02) {
          const db = d.getBoundingClientRect();
          if (db.width > 6 && db.height > 6) {
            bad.push({
              sel:
                d.tagName.toLowerCase() +
                (d.id ? '#' + d.id : '') +
                (d.className && typeof d.className === 'string'
                  ? '.' + d.className.trim().split(/\s+/).slice(0, 2).join('.')
                  : ''),
              bg: s.backgroundColor,
              area: Math.round(db.width) + 'x' + Math.round(db.height),
              blur: s.backdropFilter || 'none',
            });
          }
        }
      }
      const bf = s.backdropFilter || s.webkitBackdropFilter || '';
      if (bf && bf !== 'none' && /blur|saturate/.test(bf)) {
        const db = d.getBoundingClientRect();
        if (db.width > 20 && db.height > 20)
          bad.push({ sel: 'BLUR:' + d.tagName.toLowerCase() + (d.id ? '#' + d.id : ''), blur: bf });
      }
    });
    rec.innerBad = bad.slice(0, 14);
    rec.innerBadCount = bad.length;
    out.cards[id] = rec;
    bad.forEach((x) => out.bgOffenders.push({ card: id, ...x }));
  });
  out.closeBtns = document.querySelectorAll('.gev-lc-close').length;
  return out;
});
data.pageErrors = errs;
data.url = URL;
data.viewport = VP;
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(path.resolve(OUT), JSON.stringify(data, null, 1));
if (SHOT) {
  fs.mkdirSync(path.dirname(path.resolve(SHOT)), { recursive: true });
  await page.screenshot({ path: path.resolve(SHOT) });
}
console.log('cards:');
for (const id in data.cards) {
  const c = data.cards[id];
  if (!c) {
    console.log('  ' + id + ' MISSING');
    continue;
  }
  console.log(
    `  ${id.padEnd(22)} ${JSON.stringify(c.rect).padEnd(34)} float=${c.floating ? 1 : 0} coll=${
      c.collapsed ? 1 : 0
    } bg=${(c.bg || '').padEnd(26)} warp=${c.warpBackdrop} bad=${c.innerBadCount}`,
  );
}
console.log('closeBtns=' + data.closeBtns + ' pageErrors=' + errs.length);
console.log('offenders(top):');
data.bgOffenders.slice(0, 20).forEach((o) => console.log('  ', JSON.stringify(o)));
if (SHOT) console.log('shot=' + path.resolve(SHOT));
await browser.close();
