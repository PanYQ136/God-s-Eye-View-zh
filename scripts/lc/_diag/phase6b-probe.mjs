#!/usr/bin/env node
/* Phase6B 复现探针：文字居中 / 溢出 / 位置面板布局 / hud-summary
   真实 Chrome（RTX 3060），1348×774（与视觉审计一致），真指针点击。 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6b';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${H + 160}`,
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true }));
  } catch {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 100; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(5000);

const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));

/* ── 通用：中心点 / 溢出 ─────────────────────────────────────────────── */
const probeCard = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const heads = [...el.querySelectorAll('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.location-toolbar,.panel-title,.pp-header-label,.location-toolbar-label,.gev-voice-heading,.gev-voice-readout')];
  const headInfo = heads.map((h) => {
    const r = h.getBoundingClientRect();
    const s = getComputedStyle(h);
    return {
      cls: String(h.className).slice(0, 40),
      rect: [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
      dy: Math.round((r.y + r.height / 2 - (b.y + b.height / 2)) * 10) / 10,
      dx: Math.round((r.x + r.width / 2 - (b.x + b.width / 2)) * 10) / 10,
      txt: (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      align: s.alignItems + '/' + s.display + '/' + s.paddingTop + ',' + s.paddingBottom + '/mh' + s.minHeight,
    };
  });
  const over = [...el.querySelectorAll('*')].filter((x) => x.scrollWidth > x.clientWidth + 1 && x.clientWidth > 0)
    .map((x) => {
      const r = x.getBoundingClientRect();
      return {
        tag: x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 30),
        sw: x.scrollWidth, cw: x.clientWidth,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        right: Math.round(r.right), cardRight: Math.round(b.right),
        ox: getComputedStyle(x).overflowX, ws: getComputedStyle(x).whiteSpace,
        txt: (x.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
      };
    });
  return {
    id, phase: el.dataset.lcPhase, parent: el.parentElement && (el.parentElement.id || el.parentElement.className),
    rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
    overflow: cs.overflowX + '/' + cs.overflowY, display: cs.display, pad: cs.padding,
    head: headInfo, over,
  };
}, id);

const cardCenter = (id, selIdx = 0) => page.evaluate((id, selIdx) => {
  const el = document.getElementById(id);
  const heads = [...el.querySelectorAll('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.location-toolbar,.panel-title,.pp-header-label,.location-toolbar-label,.gev-voice-heading,.gev-voice-readout')];
  const h = heads[selIdx];
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 24) / 2) };
}, id, selIdx);

const out = { gpu, errs };

/* ── 1) 初始（全 mini）：data/scene 标题居中 ─────────────────────────── */
out.mini = {};
for (const id of ['data-panel', 'scene-panel', 'gev-voice-control', 'location-bar', 'control-panel']) out.mini[id] = await probeCard(id);

/* ── 2) 打开 data-panel（真指针点标题） ─────────────────────────────── */
const clickHead = async (id, idx = 0) => {
  const pt = await cardCenter(id, idx);
  await page.mouse.click(pt.x, pt.y, { delay: 40 });
  await sleep(1400);
};
await clickHead('data-panel');
out.openKey = await page.evaluate(() => (window.__lc.api.openKeys ? window.__lc.api.openKeys() : null)).catch(() => null);
out.openData = await probeCard('data-panel');
await page.screenshot({ path: `${OUT}/data-open.png` }).catch(() => {});

/* ── 3) 切到 scene（互斥组内） ──────────────────────────────────────── */
const scenePt = await page.evaluate(() => { const b = document.getElementById('scene-panel').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(b.height, 24) / 2) }; });
await page.mouse.click(scenePt.x, scenePt.y, { delay: 40 });
await sleep(1500);
out.openScene = await probeCard('scene-panel');
await page.screenshot({ path: `${OUT}/scene-open.png` }).catch(() => {});

/* 收起 scene（再点一次） */
await page.mouse.click(scenePt.x, scenePt.y, { delay: 40 });
await sleep(1200);

/* ── 4) voice 卡 ────────────────────────────────────────────────────── */
out.voiceMini = await probeCard('gev-voice-control');
const voicePt = await page.evaluate(() => { const b = document.getElementById('gev-voice-control').getBoundingClientRect(); return { x: Math.round(b.x + b.width - 20), y: Math.round(b.y + 12) }; });
await page.mouse.click(voicePt.x, voicePt.y, { delay: 40 });
await sleep(1600);
out.voiceOpen = await probeCard('gev-voice-control');
out.voiceHeadingDetail = await page.evaluate(() => {
  const v = document.getElementById('gev-voice-control');
  const h = v.querySelector('.gev-voice-heading');
  if (!h) return null;
  const hb = h.getBoundingClientRect();
  const kids = [...h.children].map((c) => {
    const r = c.getBoundingClientRect();
    const s = getComputedStyle(c);
    return { cls: String(c.className).slice(0, 26), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], txt: (c.textContent || '').trim().slice(0, 20), flex: s.flex, disp: s.display, ws: s.whiteSpace, ov: s.overflow };
  });
  return { rect: [Math.round(hb.x), Math.round(hb.y), Math.round(hb.width), Math.round(hb.height)], sw: h.scrollWidth, cw: h.clientWidth, kids };
});
await page.screenshot({ path: `${OUT}/voice-open.png` }).catch(() => {});

/* 收起 voice */
await page.mouse.click(voicePt.x, voicePt.y, { delay: 40 });
await sleep(1200);

/* ── 5) location-bar 展开 ───────────────────────────────────────────── */
out.locMini = await probeCard('location-bar');
const locPt = await page.evaluate(() => { const b = document.getElementById('location-bar').getBoundingClientRect(); return { x: Math.round(b.x + 30), y: Math.round(b.y + 12) }; });
await page.mouse.click(locPt.x, locPt.y, { delay: 40 });
await sleep(1600);
out.locOpen = await probeCard('location-bar');
out.locLayout = await page.evaluate(() => {
  const el = document.getElementById('location-bar');
  const b = el.getBoundingClientRect();
  const kids = [...el.querySelectorAll('.location-toolbar,.location-mini-status,.location-mini-city,.location-mini-poi,.dock-popover-content,.poi-row-container,.location-city-row,.location-pills,.location-search-wrap,.location-bar-divider')];
  return {
    card: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    cardPhase: el.dataset.lcPhase,
    cardPad: getComputedStyle(el).padding, cardDisplay: getComputedStyle(el).display, cardAlign: getComputedStyle(el).justifyContent + '/' + getComputedStyle(el).alignItems,
    inner: (() => { const i = el.querySelector('.location-inner'); if (!i) return null; const r = i.getBoundingClientRect(); return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], h: i.scrollHeight, display: getComputedStyle(i).display, gap: getComputedStyle(i).gap, pad: getComputedStyle(i).padding }; })(),
    kids: kids.map((k) => {
      const r = k.getBoundingClientRect();
      const s = getComputedStyle(k);
      return { cls: String(k.className || k.id).slice(0, 30), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], topGap: Math.round(r.top - b.top), bottomGap: Math.round(b.bottom - r.bottom), txt: (k.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36), disp: s.display, pos: s.position };
    }),
  };
});
await page.screenshot({ path: `${OUT}/loc-open.png` }).catch(() => {});
await page.screenshot({ path: `${OUT}/loc-crop.png`, clip: { x: Math.max(0, out.locOpen.rect[0] - 10), y: Math.max(0, out.locOpen.rect[1] - 10), width: out.locOpen.rect[2] + 20, height: out.locOpen.rect[3] + 20 } }).catch((e) => (out.locShotErr = String(e).slice(0, 120)));

/* ── 6) hud-summary ─────────────────────────────────────────────────── */
out.hud = await page.evaluate(() => {
  const el = document.getElementById('hud-summary');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const wrap = el.parentElement;
  const wr = wrap.getBoundingClientRect();
  const ws = getComputedStyle(wrap);
  return {
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
    txt: (el.textContent || '').trim(),
    len: (el.textContent || '').trim().length,
    css: { ws: s.whiteSpace, ov: s.overflow, ovy: s.overflowY, to: s.textOverflow, fs: s.fontSize, ls: s.letterSpacing, maxW: s.maxWidth, w: s.width, disp: s.display, vis: s.visibility, op: s.opacity },
    wrap: { rect: [Math.round(wr.x), Math.round(wr.y), Math.round(wr.width), Math.round(wr.height)], maxW: ws.maxWidth, w: ws.width, ov: ws.overflow },
    parentChain: (() => { const a = []; let n = el; for (let i = 0; i < 6 && n; i++) { const b = n.getBoundingClientRect(); a.push({ cls: n.id || String(n.className).slice(0, 24), w: Math.round(b.width), sw: n.scrollWidth, ov: getComputedStyle(n).overflow, maxW: getComputedStyle(n).maxWidth }); n = n.parentElement; } return a; })(),
    /* 文字实际渲染宽度（不限宽时） */
    textWidth: (() => { const c = document.createElement('canvas').getContext('2d'); c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; return Math.round(c.measureText((el.textContent || '').trim()).width); })(),
    visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.05,
  };
});
await page.screenshot({ path: `${OUT}/hud-crop.png`, clip: { x: Math.max(0, (out.hud ? out.hud.wrap.rect[0] : 60) - 20), y: Math.max(0, (out.hud ? out.hud.wrap.rect[1] : 100) - 30), width: 520, height: 140 } }).catch((e) => (out.hudShotErr = String(e).slice(0, 120)));

/* ── 7) 全页截图 ────────────────────────────────────────────────────── */
await page.screenshot({ path: `${OUT}/full.png` }).catch(() => {});
out.edge = await page.evaluate(() => (window.__gevEdge ? window.__gevEdge.stats() : null));

writeFileSync(`${OUT}/probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
