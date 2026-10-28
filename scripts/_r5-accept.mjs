#!/usr/bin/env node
/* _r5-accept.mjs — round-5 acceptance matrix (1536x730, CDP real mouse, no __gevLc.open()).
   phases: A initial/materials  B 7 headers  C mutex  D pp scroll  E rapid+collapse  F reload  G fps  H combos
   usage: node scripts/_r5-accept.mjs A,B,C,D,E,F,G,H          (single page, sequential)
   or:    node scripts/_r5-accept.mjs B --fresh                 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r5-t829/accept');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PH = (process.argv[2] || 'A,B,C,D,E,F,G,H').split(',');
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1800)); };
const fails = [];
const chk = (name, ok, detail) => { if (!ok) fails.push({ name, detail }); console.log(ok ? '  ok ' : '  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument((rnOff) => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  window.__gevRailNormOff = !!rnOff;
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
  addEventListener('wheel', (e) => { window.__tr.wheel++; if (e.isTrusted) window.__tr.wheelT++; }, { capture: true, passive: true });
}, process.env.RN_OFF === '1');
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

const MAIN = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const ALL9 = MAIN.concat(['gev-voice-control', 'gev-gfx-fab']);

const load = async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  await sleep(9500);
};
const shot = async (name, clip) => {
  const p = path.join(OUT, name + '.png');
  await page.screenshot(clip ? { path: p, clip } : { path: p });
  return p;
};
// ---- pixel sampling: keep the page itself, decode in node with sharp
const grabRaw = async (clip) => {
  const buf = await page.screenshot({ clip, encoding: 'binary' });
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};
const patchMean = (img, cx, cy, r) => {
  let s = 0, n = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(img.h - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(img.w - 1, cx + r); x++) {
      const i = (y * img.w + x) * img.ch;
      s += (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3; n++;
    }
  return n ? s / n : 0;
};
// 中心透明（权威口径）：从中心 5 点命中的元素向上走到卡本身，逐层看 computed 的
// background-color / background-image / backdrop-filter —— 只要有一层「可见底或磨砂」就记下来。
// 像素 A/B（卡可见 vs visibility:hidden）只作参考：它会把卡内文字/图标内容也算成差异。
const centerProbe = async (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const r = el.getBoundingClientRect();
  const desc = (n) => (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + '|' + n.tagName;
  const pts = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.33], [0.5, 0.67]].map(([fx, fy]) => [Math.round(r.x + r.width * fx), Math.round(r.y + r.height * fy)]);
  const out = pts.map(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    const layers = [];
    let n = hit;
    let inside = false;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      const nr = n.getBoundingClientRect();
      const area = Math.round(nr.width * nr.height);
      const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const a = m ? (m[1].split(',')[3] === undefined ? 1 : parseFloat(m[1].split(',')[3])) : 1;
      if (a > 0.12) layers.push({ kind: 'bg', el: desc(n), bg: s.backgroundColor, area });
      if (s.backgroundImage && s.backgroundImage !== 'none') layers.push({ kind: 'bgimg', el: desc(n), img: s.backgroundImage.slice(0, 60), area });
      if (s.backdropFilter && s.backdropFilter !== 'none') layers.push({ kind: 'bf', el: desc(n), bf: s.backdropFilter, area });
      if (n === el) { inside = true; break; }
      n = n.parentElement;
    }
    return { x, y, inside, hit: hit ? desc(hit) : null, layers };
  });
  const warp = el.querySelector('.gev-lg-warp');
  return { pts: out, warpBf: warp ? getComputedStyle(warp).backdropFilter : null,
    cardBf: getComputedStyle(el).backdropFilter };
}, id);
const badCenterLayers = (probe) => {
  const out = [];
  probe.pts.forEach((p) => {
    if (!p.inside) out.push({ at: [p.x, p.y], why: 'point not inside card', hit: p.hit });
    p.layers.forEach((l) => {
      if (l.area < 400) return;
      // 渐变/图案只在「可见浓度」时才算法材质：全部色标 alpha < 0.2 的装饰径向渐变归为内容
      if (l.kind === 'bgimg') {
        const alphas = [...l.img.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
          const parts = m[1].split(',').map((x) => parseFloat(x));
          return parts.length > 3 ? parts[3] : 1;
        });
        const maxA = alphas.length ? Math.max(...alphas) : 1;
        if (maxA < 0.2) { (out.soft || (out.soft = [])).push({ at: [p.x, p.y], ...l, maxA }); return; }
      }
      if (l.kind === 'bg' && /\|(INPUT|SELECT|TEXTAREA)$/.test(l.el || '')) { (out.soft || (out.soft = [])).push({ at: [p.x, p.y], ...l }); return; }
      out.push({ at: [p.x, p.y], ...l });
    });
  });
  if (probe.warpBf && probe.warpBf !== 'none') out.push({ why: 'warp backdrop-filter', bf: probe.warpBf });
  if (probe.cardBf && probe.cardBf !== 'none') out.push({ why: 'card backdrop-filter', bf: probe.cardBf });
  return out;
};
const transparencyOf = async (id, tag) => {
  const rect = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
  const pts = [
    [0.5, 0.5], [0.32, 0.5], [0.68, 0.5], [0.5, 0.34], [0.5, 0.66],
  ].map(([fx, fy]) => [Math.round(rect.w * fx), Math.round(rect.h * fy)]);
  const clip = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.w, W - Math.max(0, rect.x)), height: Math.min(rect.h, H - Math.max(0, rect.y)) };
  const a = await grabRaw(clip);
  await page.evaluate((id) => { const el = document.getElementById(id); el.dataset.gevTmpVis = el.style.visibility; el.style.visibility = 'hidden'; }, id);
  await sleep(90);
  const b = await grabRaw(clip);
  await page.evaluate((id) => { const el = document.getElementById(id); el.style.visibility = el.dataset.gevTmpVis || ''; }, id);
  const diffs = pts.map(([x, y]) => Math.abs(patchMean(a, x, y, 8) - patchMean(b, x, y, 8)));
  // 控制点：卡外 8px 右侧的纯地图区域（同为两次截图，测噪声）
  const ctlClip = { x: Math.min(W - 30, Math.round(rect.x + rect.w) + 12), y: Math.max(0, Math.round(rect.y) + 10), width: 20, height: 20 };
  const ca = await grabRaw(ctlClip); await sleep(30);
  const noise = (() => { let s = 0; for (let i = 0; i < ca.data.length; i += ca.ch) s += ca.data[i]; return s / (ca.data.length / ca.ch); })();
  return { rect, diffs: diffs.map((d) => +d.toFixed(1)), max: +Math.max(...diffs).toFixed(1), noise: +noise.toFixed(0), tag };
};

const state = () => page.evaluate(() => window.__gevLc.state());
const shellOf = () => page.evaluate((ids) => {
  const out = {};
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const s = getComputedStyle(el);
    const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const a = m ? parseFloat(m[1].split(',')[3] === undefined ? 1 : m[1].split(',')[3]) : 1;
    const r = el.getBoundingClientRect();
    out[id] = { bg: s.backgroundColor, alpha: +a.toFixed(2), bf: s.backdropFilter, bgImg: s.backgroundImage, rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  });
  return out;
}, ALL9);
const pagewide = () => page.evaluate(() => {
  const frosted = [], dark = [], xclose = [], xglyph = [];
  document.querySelectorAll('*').forEach((el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const bf = s.backdropFilter;
    if (bf && bf !== 'none') frosted.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), id: el.id, bf, area: Math.round(r.width * r.height) });
    const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const a = m ? (m[1].split(',')[3] === undefined ? 1 : parseFloat(m[1].split(',')[3])) : 1;
    if (a > 0.25 && r.width * r.height > 300 && el.closest('.gev-lc') === null && el !== document.documentElement && el !== document.body) dark.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), id: el.id, bg: s.backgroundColor, area: Math.round(r.width * r.height) });
  });
  document.querySelectorAll('.gev-lc-close').forEach((e) => xclose.push(e.id || e.className));
  const txt = document.body.innerText || '';
  const n = (txt.match(/[✕✖]/g) || []).length;
  if (n) xglyph.push({ count: n });
  return { frosted, dark, xclose, xglyph };
});
/* header 命中点：优先取卡内真实 header 元素的中心（展开态顶部 24px 是 inner 内容，不是 header），
   逐个候选点用 elementFromPoint 校验「归属本卡」后才返回。 */
const pointFor = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  if (!el) return { ok: false };
  const er = el.getBoundingClientRect();
  const cands = [];
  el.querySelectorAll('.panel-header,.dock-tray-toggle,.pp-header-row,.location-toolbar-toggle,.panel-divider,.panel-title,.pp-header-label,.location-toolbar-label,.dock-title').forEach((h) => {
    const r = h.getBoundingClientRect();
    if (r.width > 20 && r.height > 8 && r.left >= er.left - 1 && r.right <= er.right + 1 && r.top >= er.top - 1 && r.bottom <= er.bottom + 1)
      cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
  });
  cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
  cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + er.height / 2)]);
  for (const q of cands) {
    const e = document.elementFromPoint(q[0], q[1]);
    if (e && el.contains(e)) return { ok: true, at: q, owner: e.closest('.gev-lc') ? e.closest('.gev-lc').id : null };
  }
  return { ok: false, at: cands[cands.length - 1] };
}, id);
const clickCard = async (id, wait = 1500) => {
  const p = await pointFor(id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1]);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(wait);
  return p;
};
/* 收起全部：只点「当前真的是浮层」的卡，并等它退出浮层态（避免 morph 中重复点导致又打开） */
const collapseAll = async () => {
  for (let g = 0; g < 6; g++) {
    const stx = await state();
    const open = MAIN.filter((id) => stx[id] && stx[id].floating);
    if (!open.length) break;
    for (const id of open) {
      const p = await pointFor(id);
      if (p.ok) { await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); }
      for (let k = 0; k < 14; k++) {
        const s2 = await state();
        if (!s2[id].floating) break;
        await sleep(140);
      }
    }
    await sleep(500);
  }
  await sleep(900);
};

const overlaps = (o) => {
  const keys = Object.keys(o), out = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = o[keys[i]], b = o[keys[j]];
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0 && iy > 0) out.push({ a: keys[i], b: keys[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: +(ix * iy).toFixed(0) });
  }
  return out;
};
const rects = () => page.evaluate((ids) => {
  const o = {};
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return;
    const r = el.getBoundingClientRect();
    o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
  });
  return o;
}, ALL9);
const headerHits = () => page.evaluate((ids) => {
  const out = {};
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))];
    const e = document.elementFromPoint(q[0], q[1]);
    out[id] = { at: q, own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName + '.' + (e.className || '').toString().slice(0, 20) : null) };
  });
  return out;
}, ALL9);

await load();

if (PH.includes('A')) {
  const st = await state();
  const sh = await shellOf();
  const pw = await pagewide();
  const rr = await rects();
  put('A_state', { collapsed: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.collapsed])) });
  put('A_shell', sh);
  put('A_pagewide', pw);
  put('A_rects', rr);
  put('A_overlaps', overlaps(rr));
  chk('A initial all-mini', MAIN.every((id) => st[id] && st[id].collapsed), MAIN.filter((id) => !(st[id] && st[id].collapsed)));
  chk('A shell alpha 0', ALL9.every((id) => !sh[id] || sh[id].alpha === 0), Object.fromEntries(Object.entries(sh).filter(([, v]) => v.alpha !== 0)));
  chk('A pagewide backdrop-filter 0', pw.frosted.length === 0, pw.frosted);
  chk('A no dark solids', pw.dark.length === 0, pw.dark);
  chk('A x-close 0', pw.xclose.length === 0 && pw.xglyph.length === 0, { xclose: pw.xclose, xglyph: pw.xglyph });
  chk('A all in view', Object.values(sh).every((v) => v.inView), Object.entries(sh).filter(([, v]) => !v.inView).map(([k]) => k));
  chk('A no overlap', overlaps(rr).length === 0, overlaps(rr));
  put('A_tr', await page.evaluate(() => window.__tr));
  // 迷你态中心透明：computed 逐层（权威）+ 像素 A/B（参考）
  const tr = {}, cp = {};
  for (const id of ALL9) {
    cp[id] = await centerProbe(id);
    tr[id] = await transparencyOf(id, 'mini');
  }
  const badCenter = (probe) => {
    const out = [];
    probe.pts.forEach((p) => {
      if (!p.inside) out.push({ at: [p.x, p.y], why: 'point not inside card', hit: p.hit });
      p.layers.forEach((l) => { if (l.area >= 400) out.push({ at: [p.x, p.y], ...l }); });
    });
    if (probe.warpBf && probe.warpBf !== 'none') out.push({ why: 'warp backdrop-filter', bf: probe.warpBf });
    if (probe.cardBf && probe.cardBf !== 'none') out.push({ why: 'card backdrop-filter', bf: probe.cardBf });
    return out;
  };
  put('A_center_mini', Object.fromEntries(Object.entries(cp).map(([k, v]) => [k, { warpBf: v.warpBf, cardBf: v.cardBf, layers: v.pts.flatMap((p) => p.layers).slice(0, 6) }])));
  put('A_pixel_mini_ref', Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, { max: v.max, noise: v.noise, note: '像素差含卡内文字/图标内容，仅参考' }])));
  const cbad = Object.fromEntries(Object.entries(cp).map(([k, v]) => [k, badCenter(v)]).filter(([, v]) => v.length));
  chk('A mini centers transparent (no visible bg/bf layer >=400px²)', Object.keys(cbad).length === 0, cbad);
  await shot('A-initial');
}

if (PH.includes('B')) {
  const per = {};
  for (const id of MAIN) {
    // 确保全 mini 起点
    await collapseAll();
    await sleep(400);
    const c = await clickCard(id, 2200);
    const st = await state();
    const sh = await shellOf();
    const pw = await pagewide();
    const hits = await headerHits();
    const rr = await rects();
    const inner = await page.evaluate((id) => {
      const el = document.getElementById(id);
      let bf = 0, dark = [], whiteish = [];
      el.querySelectorAll('*').forEach((n) => {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return;
        const r = n.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (s.backdropFilter && s.backdropFilter !== 'none') bf++;
        const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/);
        const a = m ? (m[1].split(',')[3] === undefined ? 1 : parseFloat(m[1].split(',')[3])) : 1;
        if (a > 0.2 && r.width * r.height > 300) dark.push({ cls: (n.className || '').toString().slice(0, 40), bg: s.backgroundColor, area: Math.round(r.width * r.height) });
        if (a > 0.5 && /rgb\((2[0-9]{2}|1[5-9][0-9]),/.test(s.backgroundColor) && r.width * r.height > 200) whiteish.push({ cls: (n.className || '').toString().slice(0, 40), bg: s.backgroundColor });
      });
      return { bf, dark, whiteish };
    }, id);
    const tp = await transparencyOf(id, 'expanded');
    const cpb = await centerProbe(id);
    const cb = badCenterLayers(cpb);
    per[id] = { click: c, collapsed: st[id] && st[id].collapsed, floating: st[id] && st[id].floating,
      inView: sh[id] && sh[id].inView, shellAlpha: sh[id] && sh[id].alpha, shellBf: sh[id] && sh[id].bf,
      innerBf: inner.bf, innerDark: inner.dark.slice(0, 6), innerWhite: inner.whiteish.slice(0, 6),
      pageFrosted: pw.frosted.length, pageDark: pw.dark.length, rect: sh[id] && sh[id].rect,
      transparency: tp, centerBad: cb, warpBf: cpb.warpBf, overlaps: overlaps(rr), hits: { [id]: hits[id] } };
    await shot('B-open-' + id.replace('-panel', '').replace('-toggles', ''));
    console.log('  B', id, 'open=', st[id] && !st[id].collapsed, 'innerBf=', inner.bf, 'innerDark=', inner.dark.length, 'centerBad=', cb.length, 'ov=', overlaps(rr).length);
    // 收起
    await clickCard(id, 1300);
    await sleep(600);
  }
  put('B_headers', per);
  chk('B 7 headers open', MAIN.every((id) => per[id].floating && !per[id].collapsed), MAIN.filter((id) => !(per[id].floating && !per[id].collapsed)));
  chk('B 7 clicks hit own card', MAIN.every((id) => per[id].click.ok), MAIN.filter((id) => !per[id].click.ok));
  chk('B in view', MAIN.every((id) => per[id].inView), MAIN.filter((id) => !per[id].inView));
  chk('B shell alpha 0', MAIN.every((id) => per[id].shellAlpha === 0), Object.fromEntries(MAIN.map((id) => [id, per[id].shellAlpha]).filter(([, a]) => a !== 0)));
  chk('B inner backdrop-filter 0', MAIN.every((id) => per[id].innerBf === 0), Object.fromEntries(MAIN.map((id) => [id, per[id].innerBf]).filter(([, n]) => n)));
  chk('B inner no dark solid >20%', MAIN.every((id) => per[id].innerDark.length === 0), Object.fromEntries(MAIN.map((id) => [id, per[id].innerDark]).filter(([, d]) => d.length)));
  chk('B expanded centers transparent', MAIN.every((id) => per[id].centerBad.length === 0), Object.fromEntries(MAIN.map((id) => [id, per[id].centerBad]).filter(([, d]) => d.length)));
  chk('B page frosted 0 in every open state', MAIN.every((id) => per[id].pageFrosted === 0), Object.fromEntries(MAIN.map((id) => [id, per[id].pageFrosted])));
  chk('B no overlap while any single card open', MAIN.every((id) => per[id].overlaps.length === 0), Object.fromEntries(MAIN.map((id) => [id, per[id].overlaps]).filter(([, o]) => o.length)));
}

if (PH.includes('C')) {
  const sample = () => page.evaluate(() => {
    const cls = (id) => { const el = document.getElementById(id); return el ? !el.classList.contains('collapsed') : false; };
    const hid = (id) => { const el = document.getElementById(id); if (!el) return true; const s = getComputedStyle(el); return s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05; };
    return { left: ['data-panel', 'scene-panel'].filter(cls), right: ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter(cls),
      hiddenRight: ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter(hid), hiddenLeft: ['data-panel', 'scene-panel'].filter(hid) };
  });
  const startRec = () => page.evaluate(() => {
    window.__rec = { on: true, frames: [], t0: performance.now() };
    const tick = () => {
      if (!window.__rec.on) return;
      const cls = (id) => { const el = document.getElementById(id); return el ? !el.classList.contains('collapsed') : false; };
      const hid = (id) => { const el = document.getElementById(id); if (!el) return true; const s = getComputedStyle(el); return s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05; };
      const L = ['data-panel', 'scene-panel'].filter(cls), R = ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter(cls);
      window.__rec.frames.push({ t: performance.now(), L: L.length, R: R.length, l: L, r: R,
        hidR: ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter(hid).length, hidL: ['data-panel', 'scene-panel'].filter(hid).length });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const stopRec = () => page.evaluate(() => { window.__rec.on = false; return window.__rec.frames; });
  await startRec();
  const seq = [];
  const clicks = [];
  for (const id of ['data-panel', 'scene-panel', 'data-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'pp-toggles']) {
    clicks.push({ id, ...(await clickCard(id, 1400)) });
    seq.push(await sample());
  }
  const frames = await stopRec();
  // 旧 header 回切：关掉全部后打开 data，再点 scene，再点回 data
  const back = {};
  await clickCard('data-panel', 1400);
  back.sceneHit = await page.evaluate(() => { const el = document.getElementById('scene-panel'); const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + 14)]; const e = document.elementFromPoint(q[0], q[1]); return { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null, at: q }; });
  await clickCard('scene-panel', 1600);
  const backSt = await state();
  back.afterScene = { data: backSt['data-panel'].collapsed, scene: backSt['scene-panel'].collapsed };
  back.dataHit = await page.evaluate(() => { const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + 12)]; const e = document.elementFromPoint(q[0], q[1]); return { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null, at: q }; });
  await clickCard('data-panel', 1600);
  const backSt2 = await state();
  back.afterData = { data: backSt2['data-panel'].collapsed, scene: backSt2['scene-panel'].collapsed };
  const maxL = Math.max(...frames.map((f) => f.L)), maxR = Math.max(...frames.map((f) => f.R));
  const empty = frames.filter((f) => f.L === 0 || f.R === 0).length;
  const emptyAfter = frames.filter((f, i) => i > 0 && (f.L === 0 && frames[i - 1].L > 0 || f.R === 0 && frames[i - 1].R > 0)).length;
  put('C_mutex', { frames: frames.length, maxL, maxR, emptyFrames: empty, emptyAfterOpen: emptyAfter,
    hiddenRightFrames: frames.filter((f) => f.hidR).length, hiddenLeftFrames: frames.filter((f) => f.hidL).length, seq, clicks, back });
  chk('C left max 1', maxL <= 1, maxL);
  chk('C right max 1', maxR <= 1, maxR);
  chk('C no empty windows', emptyAfter === 0, emptyAfter);
  chk('C no hidden siblings', frames.every((f) => f.hidR === 0 && f.hidL === 0));
  chk('C old header click back', back.sceneHit.own && back.dataHit.own && !back.afterScene.scene && !back.afterData.data, back);
  // 复位
  await collapseAll();
}

if (PH.includes('D')) {
  const c = await clickCard('pp-toggles', 2200);
  const box = await page.evaluate(() => {
    const el = document.getElementById('pp-toggles');
    const r = el.getBoundingClientRect();
    const cands = [el, ...el.querySelectorAll('*')];
    const sc = cands.find((n) => { const s = getComputedStyle(n); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4; });
    // pp 的行 = 滚动容器里「同一父级」的 pp-toggle-group / pp-toggle-btn 兄弟（App 把内容挂在 header row 里）
    const allRows = sc ? [...sc.querySelectorAll('.pp-toggle-group, .pp-toggle-btn')] : [];
    const parentOf = allRows.length ? allRows[0].parentElement : null;
    const rows = parentOf ? [...parentOf.children]
      .filter((n) => n.getBoundingClientRect().height > 10 && !/pp-header-row|gev-lc-edge|gev-lg-warp|pp-header-label/.test((n.className || '').toString()))
      .map((n) => { const r2 = n.getBoundingClientRect(); return { cls: (n.className || '').toString().slice(0, 40), top: +r2.top.toFixed(1), bottom: +r2.bottom.toFixed(1), h: +r2.height.toFixed(1) }; })
      .sort((a, b) => a.top - b.top) : [];
    const btns = [...el.querySelectorAll('button')].map((b) => { const s = getComputedStyle(b); const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/); const a = m ? (m[1].split(',')[3] === undefined ? 1 : parseFloat(m[1].split(',')[3])) : 1; const r2 = b.getBoundingClientRect(); return { cls: (b.className || '').toString().slice(0, 30), bg: s.backgroundColor, a: +a.toFixed(2), color: s.color, dark: /rgb\(([0-9]|1[0-9]|2[0-9]|3[0-9]),/.test(s.color), rect: [+r2.x.toFixed(0), +r2.y.toFixed(0), +r2.width.toFixed(0), +r2.height.toFixed(0)], text: (b.textContent || '').trim().slice(0, 12) }; });
    return { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      scroller: sc ? { cls: (sc.className || '').toString().slice(0, 40), clientHeight: sc.clientHeight, scrollHeight: sc.scrollHeight, scrollTop: sc.scrollTop } : null,
      rows, btns };
  });
  const minGap = (() => { let m = 1e9; for (let i = 1; i < box.rows.length; i++) m = Math.min(m, +(box.rows[i].top - box.rows[i - 1].bottom).toFixed(1)); return box.rows.length > 1 ? m : null; })();
  // 真实滚轮
  const cx = Math.round(box.rect[0] + box.rect[2] / 2), cy = Math.round(box.rect[1] + box.rect[3] / 2);
  await page.mouse.move(cx, cy);
  const tops = [];
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: 120 });
    await sleep(220);
    tops.push(await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const cands = [el, ...el.querySelectorAll('*')]; const sc = cands.find((n) => { const s = getComputedStyle(n); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4; }); return sc ? Math.round(sc.scrollTop) : null; }));
  }
  await shot('D-pp-scrolled');
  put('D_pp', { ...box, minGap, scrollTops: tops, tr: await page.evaluate(() => window.__tr) });
  chk('D pp open', !!box.scroller);
  chk('D rows minGap >= 6', minGap === null ? false : minGap >= 6, minGap);
  chk('D wheel scrolls', tops[tops.length - 1] > (tops[0] || 0) + 40, tops);
  chk('D buttons transparent (no alpha>0.2)', box.btns.every((b) => b.a <= 0.2), box.btns.filter((b) => b.a > 0.2));
  chk('D no dark text on buttons', box.btns.every((b) => !b.dark), box.btns.filter((b) => b.dark).map((b) => b.text + ':' + b.color));
  // 收起
  await page.mouse.wheel({ deltaY: -2000 });
  await clickCard('pp-toggles', 1400);
  await sleep(800);
}

const BASE = R.A_rects || null;
if (PH.includes('E')) {
  const base = BASE || (await rects());
  const before = await state();
  // 快速连点 16 击 @150ms（不等沉降）
  const order = ['data-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'data-panel', 'global-context-panel', 'location-bar', 'control-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'data-panel', 'global-context-panel', 'control-panel', 'location-bar', 'pp-toggles'];
  let missed = 0;
  const taps = [];
  for (const id of order) {
    const p = await pointFor(id);
    if (!p.ok) { missed++; taps.push({ id, ok: false, at: p.at }); continue; }
    await page.mouse.move(p.at[0], p.at[1]);
    await page.mouse.down();
    await page.mouse.up();
    taps.push({ id, ok: true });
    await sleep(150);
  }
  await sleep(4500);
  const st = await state();
  const rr = await rects();
  const ov = overlaps(rr);
  const outView = Object.entries(rr).filter(([, r]) => r[0] < -1 || r[1] < -1 || r[0] + r[2] > W + 1 || r[1] + r[3] > H + 1).map(([k]) => k);
  const hits = await headerHits();
  const closed = MAIN.filter((id) => st[id].collapsed);
  const badHits = closed.filter((id) => hits[id] && !hits[id].own);
  await shot('E-rapid');
  put('E_rapid', { taps, missed, expandedEnd: Object.entries(st).filter(([, v]) => !v.collapsed && v.floating).map(([k]) => k), ov, outView, closed, badHits, tr: await page.evaluate(() => window.__tr) });
  chk('E rapid landed taps >= 13/16 (misses = mid-morph transient, owner=sibling)', missed <= 3, taps.filter((t) => !t.ok));
  const endLeft = ['data-panel', 'scene-panel'].filter((id) => st[id] && !st[id].collapsed).length;
  const endRight = ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter((id) => st[id] && !st[id].collapsed).length;
  chk('E rapid end state mutex (left<=1, right<=1)', endLeft <= 1 && endRight <= 1, { endLeft, endRight });
  chk('E rapid no overlap', ov.length === 0, ov);
  chk('E rapid nothing out of view', outView.length === 0, outView);
  chk('E rapid closed headers own', badHits.length === 0, badHits);
  // 收起全部（带校验重试：morph 中的 header 可能还不是命中目标）
  await collapseAll();
  await sleep(2200);
  const after = await rects();
  const diff = Object.keys(base).filter((k) => after[k] && (Math.abs(after[k][0] - base[k][0]) > 0.6 || Math.abs(after[k][1] - base[k][1]) > 0.6 || Math.abs(after[k][2] - base[k][2]) > 0.6 || Math.abs(after[k][3] - base[k][3]) > 0.6)).map((k) => ({ k, base: base[k], now: after[k] }));
  const st2 = await state();
  await shot('E-collapsed');
  put('E_collapse', { diff, collapsed: Object.fromEntries(Object.entries(st2).map(([k, v]) => [k, v.collapsed])) });
  chk('E collapse back to baseline', diff.length === 0, diff);
  chk('E all mini after collapse', MAIN.every((id) => st2[id].collapsed), MAIN.filter((id) => !st2[id].collapsed));
}

if (PH.includes('F')) {
  const base = BASE || (await rects());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  const snaps = [];
  for (const t of [3000, 5000, 8000, 12000, 15000]) {
    await sleep(t - (snaps.length ? [3000, 5000, 8000, 12000, 15000][snaps.length - 1] : 0));
    const st = await state();
    snaps.push({ t, expanded: Object.entries(st).filter(([, v]) => !v.collapsed && v.floating).map(([k]) => k) });
  }
  await sleep(600);
  const rr = await rects();
  const diff = Object.keys(base).filter((k) => rr[k] && (Math.abs(rr[k][0] - base[k][0]) > 0.6 || Math.abs(rr[k][1] - base[k][1]) > 0.6)).map((k) => ({ k, base: base[k], now: rr[k] }));
  await shot('F-reloaded');
  put('F_reload', { snaps, diff });
  chk('F reload all mini', snaps.every((s) => s.expanded.length === 0), snaps);
  chk('F reload rects == baseline', diff.length === 0, diff);
}

if (PH.includes('G')) {
  const fps = [];
  for (let i = 0; i < 4; i++) {
    const v = await page.evaluate(() => new Promise((res) => {
      let n = 0; const t0 = performance.now();
      const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res(n / ((performance.now() - t0) / 1000)); };
      requestAnimationFrame(tick);
    }));
    fps.push(+v.toFixed(1));
  }
  const med = fps.slice().sort((a, b) => a - b)[Math.floor(fps.length / 2)];
  put('G_fps', { fps, median: med, errors: errs.slice(0, 10) });
  chk('G fps >= 30', med >= 30, med);
  chk('G no console errors', errs.length === 0, errs.slice(0, 5));
}

if (PH.includes('H')) {
  const groups = [['data-panel', 'scene-panel'], ['pp-toggles', 'cctv-panel', 'global-context-panel'], ['location-bar', 'control-panel', 'gev-voice-control']];
  const pairs = [];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++)
    for (const a of groups[i]) for (const b of groups[j]) pairs.push([a, b]);
  const combos = [];
  for (const pair of pairs) {
    const st0 = await state();
    await collapseAll();
    await sleep(500);
    const c1 = await clickCard(pair[0], 1500);
    const c2 = await clickCard(pair[1], 2600);
    await sleep(2600);
    const rr = await rects();
    const ov = overlaps(rr);
    const hits = await headerHits();
    const st = await state();
    const closed = MAIN.filter((id) => st[id].collapsed && id !== pair[0] && id !== pair[1]);
    const badHits = closed.filter((id) => hits[id] && !hits[id].own);
    const outView = Object.entries(rr).filter(([, r]) => r[0] < -1 || r[1] < -1 || r[0] + r[2] > W + 1 || r[1] + r[3] > H + 1).map(([k]) => k);
    combos.push({ pair, clicks: [c1.ok, c2.ok], ov, badHits, outView, rects: rr });
    console.log('  H', pair.join('+'), 'ov=', ov.length, 'badHits=', badHits.length, 'out=', outView.length);
    await collapseAll();
    await sleep(400);
  }
  put('H_combos', combos);
  chk('H combos no overlap', combos.every((c) => c.ov.length === 0), combos.filter((c) => c.ov.length).map((c) => ({ pair: c.pair, ov: c.ov })));
  chk('H combos closed headers own', combos.every((c) => c.badHits.length === 0), combos.filter((c) => c.badHits.length).map((c) => ({ pair: c.pair, bad: c.badHits })));
  chk('H combos in view', combos.every((c) => c.outView.length === 0), combos.filter((c) => c.outView.length).map((c) => ({ pair: c.pair, out: c.outView })));
}

if (PH.includes('I')) {
  /* reviewer 最低线：3 击终态（显示 → 视觉预设 → 上下文）两卡 header 各自 own=true，
     且真实点击各开自己；5 轮确定性。 */
  const rounds = [];
  for (let r = 1; r <= 5; r++) {
    await load();
    await clickCard('pp-toggles', 1200);
    await clickCard('control-panel', 1200);
    await clickCard('global-context-panel', 1200);
    await sleep(3500);
    const rr = await rects();
    const ov = overlaps(rr);
    const hits = await headerHits();
    // 真实点击 cctv 的 header → 必须打开 cctv、关掉 global
    const cctvClick = await clickCard('cctv-panel', 1800);
    const st1 = await state();
    const afterCctv = { cctvOpen: !st1['cctv-panel'].collapsed, globalClosed: st1['global-context-panel'].collapsed };
    // 再真实点击 pp 的 header → 必须打开 pp、关掉 cctv
    const ppClick = await clickCard('pp-toggles', 1800);
    const st2 = await state();
    const afterPp = { ppOpen: !st2['pp-toggles'].collapsed, cctvClosed: st2['cctv-panel'].collapsed };
    const after2 = await rects();
    rounds.push({ r, rects: rr, ov, hits: { pp: hits['pp-toggles'], cctv: hits['cctv-panel'], global: hits['global-context-panel'] },
      cctvClick, afterCctv, ppClick, afterPp, ovAfter: overlaps(after2), after2 });
    console.log('  I round', r, 'ov=', JSON.stringify(ov), 'ppOwn=', hits['pp-toggles'].own, 'cctvOwn=', hits['cctv-panel'].own,
      'cctvOpens=', afterCctv.cctvOpen, 'ppOpens=', afterPp.ppOpen, 'pp=', JSON.stringify(rr['pp-toggles']), 'cctv=', JSON.stringify(rr['cctv-panel']));
    await shot('I-round' + r);
  }
  const sig = (x) => JSON.stringify(x);
  put('I_3click', { rounds, deterministic: new Set(rounds.map((x) => sig([x.rects['pp-toggles'], x.rects['cctv-panel']]))).size });
  chk('I 5/5 no overlap at settle', rounds.every((x) => x.ov.length === 0 && x.ovAfter.length === 0), rounds.filter((x) => x.ov.length || x.ovAfter.length).map((x) => ({ r: x.r, ov: x.ov, ovAfter: x.ovAfter })));
  chk('I 5/5 both headers own', rounds.every((x) => x.hits.pp.own && x.hits.cctv.own), rounds.map((x) => ({ r: x.r, pp: x.hits.pp, cctv: x.hits.cctv })));
  chk('I clicking cctv opens cctv / closes global', rounds.every((x) => x.afterCctv.cctvOpen && x.afterCctv.globalClosed), rounds.map((x) => ({ r: x.r, a: x.afterCctv })));
  chk('I clicking pp opens pp / closes cctv', rounds.every((x) => x.afterPp.ppOpen && x.afterPp.cctvClosed), rounds.map((x) => ({ r: x.r, a: x.afterPp })));
  chk('I deterministic final rects', new Set(rounds.map((x) => sig([x.rects['pp-toggles'], x.rects['cctv-panel']]))).size === 1, rounds.map((x) => [x.rects['pp-toggles'], x.rects['cctv-panel']]));
}

R.fails = fails;
R.viewport = { W, H };
fs.writeFileSync(path.join(OUT, 'accept-' + PH.join('') + '.json'), JSON.stringify(R, null, 2));
console.log('#### FAILS', fails.length, JSON.stringify(fails).slice(0, 3000));
await browser.close();
process.exit(fails.length ? 1 : 0);
