#!/usr/bin/env node
/* Phase6B Gate — 真实 Chrome（RTX 3060）、1348×774、真指针
   ① data/scene header 与卡中心差 ≤1px  ② voice scrollWidth ≤ clientWidth + 文字完整
   ③ location 展开内容垂直居中（上下间隙差 ≤2px）  ④ hud-summary 无横向溢出
   ⑤ 8 卡无横向裁切  产物 .gev-logs/lc/phase6b/gate.json + 截图 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6b';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, ok, detail) => {
  R.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <- ' + JSON.stringify(detail).slice(0, 460)}`);
};

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
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 120; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(4800);
await page.mouse.move(4, 400);

/* ── GPU ─────────────────────────────────────────────────────────────── */
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
rec('G0 GPU renderer = RTX 3060（非软件渲染）', !!gpu && /RTX 3060/.test(gpu.renderer || '') && gpu.software === false, gpu && { renderer: gpu.renderer, software: gpu.software });

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
const measure = (ids) => page.evaluate((ids) => ids.map((id) => {
  const el = document.getElementById(id);
  const b = el.getBoundingClientRect();
  const heads = [...el.querySelectorAll('.panel-header,.pp-header-row,.dock-tray-toggle,.panel-title,.pp-header-label,.location-toolbar-label,.gev-voice-heading')];
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && r.width > 0 && r.height > 0; };
  const head = heads.map((h) => { const r = h.getBoundingClientRect(); return { cls: String(h.className).slice(0, 30), dy: Math.round((r.y + r.height / 2 - (b.y + b.height / 2)) * 10) / 10, h: Math.round(r.height), vis: vis(h), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; });
  /* 可见文字/装饰全部落在卡内（横向）；排除自身就是滚动容器（overflow-x auto/scroll）*/
  const outside = [...el.querySelectorAll('*')].filter((x) => {
    if (!vis(x)) return false;
    const r = x.getBoundingClientRect();
    const s = getComputedStyle(x);
    if (s.position === 'absolute' && (r.right > b.right + 1 || r.left < b.left - 1)) return true;
    return r.right > b.right + 1;
  }).map((x) => { const r = x.getBoundingClientRect(); return { t: x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 24), over: Math.round(r.right - b.right), sw: x.scrollWidth, cw: x.clientWidth, txt: (x.textContent || '').trim().slice(0, 18) }; });
  /* 卡内自身文字被裁（overflow 隐藏 + 内容更宽）*/
  const clipped = [...el.querySelectorAll('*')].filter((x) => {
    if (!vis(x)) return false;
    const s = getComputedStyle(x);
    const hidden = /(hidden|clip)/.test(s.overflowX);
    return hidden && x.scrollWidth > x.clientWidth + 1 && (x.textContent || '').trim().length > 0;
  }).map((x) => ({ t: x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 24), sw: x.scrollWidth, cw: x.clientWidth, tr: (x.textContent || '').trim().slice(0, 22) }));
  return { id, phase: el.dataset.lcPhase, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, head, outside, clipped };
}), ids);

/* ── 1) 静止态（全 mini） ─────────────────────────────────────────────── */
const rest = await measure(IDS);
const byId = (arr, id) => arr.find((c) => c.id === id);

for (const id of ['data-panel', 'scene-panel']) {
  const c = byId(rest, id);
  const h = c.head.find((x) => /panel-header/.test(x.cls)) || c.head[0];
  rec(`C1 ${id} 标题中心与卡中心差 ≤1px（实测 ${h && h.dy}px）`, !!h && Math.abs(h.dy) <= 1, { rect: c.rect, head: h });
}
const voiceRest = byId(rest, 'gev-voice-control');
rec(`V1 voice mini scrollWidth == clientWidth（实测 ${voiceRest.sw}/${voiceRest.cw}）`, voiceRest.sw <= voiceRest.cw, { sw: voiceRest.sw, cw: voiceRest.cw, outside: voiceRest.outside, clipped: voiceRest.clipped });
rec('V1 voice mini 无可见元素越出卡右缘', voiceRest.outside.length === 0, voiceRest.outside);
rec('V1 voice mini 无文字被裁（overflow+scrollWidth）', voiceRest.clipped.length === 0, voiceRest.clipped);

const horizontal = rest.filter((c) => c.sw > c.cw + 1 || c.outside.length > 0);
rec('H1 8 卡静止态：0 横向溢出 / 0 元素越出卡缘', horizontal.length === 0, horizontal.map((c) => ({ id: c.id, sw: [c.sw, c.cw], out: c.outside })));

/* ── 2) voice hover：数值不再挤出卡外 ─────────────────────────────────── */
const vb = voiceRest.rect;
await page.mouse.move(Math.round(vb[0] + vb[2] / 2), Math.round(vb[1] + vb[3] - 12), { steps: 6 });
await sleep(700);
const voiceHover = await page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  const b = el.getBoundingClientRect();
  const head = el.querySelector('.gev-voice-heading');
  const hv = head.getBoundingClientRect();
  const cv = el.querySelector('.gev-voice-cost-value');
  const cvr = cv.getBoundingClientRect();
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && r.width > 0; };
  return {
    hover: el.matches(':hover'),
    card: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    headSw: head.scrollWidth, headCw: head.clientWidth,
    value: { disp: getComputedStyle(cv).display, rect: [Math.round(cvr.x), Math.round(cvr.y), Math.round(cvr.width), Math.round(cvr.height)], right: Math.round(cvr.right), inside: cvr.right <= b.right + 1 && cvr.left >= b.left - 1 },
    /* 行内内容（标题/状态/档位/数值/radout）不得越出卡缘；两枚 tooltip 是设计内的浮层，
       单独归类（它们本来就画在卡外、z-index 7/8，不参与卡内布局）。 */
    outside: [...el.querySelectorAll('*')].filter((x) => vis(x) && !x.closest('.gev-voice-help-tray,.gev-voice-error-tray') && x.getBoundingClientRect().right > b.right + 1)
      .map((x) => { const r = x.getBoundingClientRect(); return { t: x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 24), over: Math.round(r.right - b.right), txt: (x.textContent || '').trim().slice(0, 16) }; }),
    popovers: [...el.querySelectorAll('.gev-voice-help-tray,.gev-voice-error-tray')].map((x) => {
      const r = x.getBoundingClientRect(); const s = getComputedStyle(x);
      return { t: String(x.className).slice(0, 22), disp: s.display, vis: s.visibility, z: s.zIndex, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], clippedByCard: s.display !== 'none' && (r.left < b.left || r.right > b.right) && /(hidden|clip)/.test(getComputedStyle(el).overflow) };
    }),
    clipped: [...el.querySelectorAll('*')].filter((x) => { const s = getComputedStyle(x); return vis(x) && /(hidden|clip)/.test(s.overflowX) && x.scrollWidth > x.clientWidth + 1 && (x.textContent || '').trim().length > 0; })
      .map((x) => ({ t: String(x.className).slice(0, 22), sw: x.scrollWidth, cw: x.clientWidth, txt: (x.textContent || '').trim().slice(0, 18) })),
    text: (el.querySelector('.gev-voice-heading') || {}).textContent,
  };
});
await page.screenshot({ path: `${OUT}/gate-voice-hover.png`, clip: { x: Math.round(vb[0] - 30), y: Math.round(vb[1] - 70), width: Math.round(vb[2] + 90), height: Math.round(vb[3] + 90) } }).catch(() => {});
rec('V2 voice hover：:hover 命中（真指针）', voiceHover.hover === true, voiceHover.hover);
rec('V2 hover 时成本数值可见且完整落在卡内', voiceHover.value.disp !== 'none' && voiceHover.value.inside, voiceHover.value);
rec(`V2 hover 时标题行内容 ≤ 行宽（${voiceHover.headSw}/${voiceHover.headCw}）`, voiceHover.headSw <= voiceHover.headCw, { sw: voiceHover.headSw, cw: voiceHover.headCw });
rec('V2 hover 时无行内元素越出卡右缘（tooltip 浮层单列）', voiceHover.outside.length === 0, voiceHover.outside);
rec('V2 hover 时 tooltip 不被卡壳裁切（设计内浮层，卡 overflow 未裁剪它）', voiceHover.popovers.every((p) => p.clippedByCard === false), voiceHover.popovers);
rec('V2 hover 时无文字被裁', voiceHover.clipped.length === 0, voiceHover.clipped);
await page.mouse.move(4, 400);
await sleep(500);
const voiceBack = await page.evaluate(() => { const el = document.getElementById('gev-voice-control'); return { sw: el.scrollWidth, cw: el.clientWidth, val: getComputedStyle(el.querySelector('.gev-voice-cost-value')).display }; });
rec('V2 移开后回到常态（数值隐藏、scrollWidth 回 baseline）', voiceBack.val === 'none' && voiceBack.sw <= voiceBack.cw, voiceBack);
await page.screenshot({ path: `${OUT}/gate-voice-rest.png`, clip: { x: Math.round(vb[0] - 20), y: Math.round(vb[1] - 20), width: Math.round(vb[2] + 60), height: Math.round(vb[3] + 40) } }).catch(() => {});

/* ── 3) location-bar 展开：内容垂直居中 ───────────────────────────────── */
const lb = byId(rest, 'location-bar').rect;
await page.mouse.click(Math.round(lb[0] + 30), Math.round(lb[1] + 12), { delay: 40 });
await sleep(1700);
const loc = await page.evaluate(() => {
  const el = document.getElementById('location-bar');
  const b = el.getBoundingClientRect();
  const inner = el.querySelector('.location-inner');
  const tb = el.querySelector('.location-toolbar');
  const pop = el.querySelector('#location-bar-popover');
  const rr = (x) => { const r = x.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const first = tb.getBoundingClientRect().top - b.top;
  const last = b.bottom - pop.getBoundingClientRect().bottom;
  return {
    phase: el.dataset.lcPhase, card: rr(el), inner: inner ? rr(inner) : null, innerH: inner && inner.getBoundingClientRect().height,
    toolbar: rr(tb), popover: rr(pop),
    topGap: Math.round(first * 10) / 10, bottomGap: Math.round(last * 10) / 10,
    sw: el.scrollWidth, cw: el.clientWidth,
    contentH: Math.round((pop.getBoundingClientRect().bottom - tb.getBoundingClientRect().top) * 10) / 10,
    clipped: [...el.querySelectorAll('*')].filter((x) => { const s = getComputedStyle(x); const r = x.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && /(hidden|clip)/.test(s.overflowX) && x.scrollWidth > x.clientWidth + 1 && (x.textContent || '').trim().length > 0; }).map((x) => ({ t: String(x.className).slice(0, 22), sw: x.scrollWidth, cw: x.clientWidth, ovx: getComputedStyle(x).overflowX })),
    scrollRows: [...el.querySelectorAll('*')].filter((x) => /(auto|scroll)/.test(getComputedStyle(x).overflowX) && x.scrollWidth > x.clientWidth + 1).map((x) => ({ t: String(x.className).slice(0, 20), sw: x.scrollWidth, cw: x.clientWidth })),
  };
});
await page.screenshot({ path: `${OUT}/gate-loc-open.png`, clip: { x: Math.round(loc.card[0] - 14), y: Math.round(loc.card[1] - 14), width: Math.round(loc.card[2] + 28), height: Math.round(loc.card[3] + 28) } }).catch(() => {});
rec('L1 location 展开 phase=open', loc.phase === 'open', loc.phase);
rec(`L1 展开内容垂直居中（上 ${loc.topGap}px / 下 ${loc.bottomGap}px，差 ≤2px）`, Math.abs(loc.topGap - loc.bottomGap) <= 2, { top: loc.topGap, bottom: loc.bottomGap, inner: loc.inner, contentH: loc.contentH });
rec('L1 内容撑满卡高、无「贴底大空白」（内容高/可用高 ≥ 0.8）', loc.contentH / (loc.card[3] - 16) >= 0.8, { contentH: loc.contentH, avail: loc.card[3] - 16 });
rec(`L1 卡片无横向溢出（${loc.sw}/${loc.cw}）`, loc.sw <= loc.cw, { sw: loc.sw, cw: loc.cw, scrollRows: loc.scrollRows });
rec('L1 卡内文字无裁切（滚动容器除外）', loc.clipped.length === 0, { clipped: loc.clipped, scrollRows: loc.scrollRows });
/* 收起位置面板 */
await page.mouse.click(Math.round(loc.card[0] + 30), Math.round(loc.card[1] + 12), { delay: 40 });
await sleep(1300);

/* ── 4) hud-summary：无横向溢出 ───────────────────────────────────────── */
const hud = await page.evaluate(() => {
  const el = document.getElementById('hud-summary');
  const wrap = el.parentElement;
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    sw: el.scrollWidth, cw: el.clientWidth, h: Math.round(r.height), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    ws: s.whiteSpace, ov: s.overflow, to: s.textOverflow, vis: s.visibility,
    wrapSw: wrap.scrollWidth, wrapCw: wrap.clientWidth,
    lines: Math.round(r.height / (parseFloat(s.lineHeight) || 14)),
    txt: (el.textContent || '').trim(),
  };
});
rec(`D1 hud-summary 无横向溢出（scrollWidth ${hud.sw} == clientWidth ${hud.cw}）`, hud.sw <= hud.cw, hud);
rec('D1 hud-summary 折行后完整（white-space normal / wrap 容器内不越界）', hud.ws === 'normal' && hud.wrapSw <= hud.wrapCw, { ws: hud.ws, wrap: [hud.wrapSw, hud.wrapCw], lines: hud.lines, h: hud.h });

/* ── 5) data/scene 展开态标题仍在卡内、无横向裁切 ─────────────────────── */
const dp = byId(rest, 'data-panel').rect;
await page.mouse.click(Math.round(dp[0] + dp[2] / 2), Math.round(dp[1] + 24), { delay: 40 });
await sleep(1500);
const openData = await measure(['data-panel']);
await page.screenshot({ path: `${OUT}/gate-data-open.png`, clip: { x: Math.round(dp[0] - 14), y: Math.round(dp[1] - 14), width: dp[2] + 28, height: 420 } }).catch(() => {});
rec('C2 data 展开态：无横向溢出 / 无越界元素', openData[0].sw <= openData[0].cw && openData[0].outside.length === 0, { sw: [openData[0].sw, openData[0].cw], out: openData[0].outside });
await page.mouse.click(Math.round(dp[0] + dp[2] / 2), Math.round(dp[1] + 24), { delay: 40 });
await sleep(1200);
const backRest = await measure(['data-panel', 'scene-panel']);
for (const id of ['data-panel', 'scene-panel']) {
  const c = byId(backRest, id);
  const h = c.head.find((x) => /panel-header/.test(x.cls)) || c.head[0];
  rec(`C1 ${id} 收起后回到 mini 且标题仍居中（差 ${h && h.dy}px）`, c.phase === 'mini' && Math.abs(h.dy) <= 1, { phase: c.phase, dy: h && h.dy });
}

/* ── 截图：全页 + 两张卡裁切 ─────────────────────────────────────────── */
await page.screenshot({ path: `${OUT}/gate-full.png` }).catch(() => {});
await page.screenshot({ path: `${OUT}/gate-left-crop.png`, clip: { x: 30, y: 70, width: 260, height: 200 } }).catch(() => {});
const summary = { gpu: gpu && gpu.renderer, pass: R.filter((r) => r.ok).length, total: R.length, errs: errs.slice(0, 6) };
writeFileSync(`${OUT}/gate.json`, JSON.stringify({ summary, results: R, rest, voiceHover, voiceBack, loc, hud }, null, 2));
console.log(`\n== ${summary.pass}/${summary.total} PASS ==`);
console.log(JSON.stringify({ summary, fails: R.filter((r) => !r.ok).map((r) => r.name) }));
await browser.close();
