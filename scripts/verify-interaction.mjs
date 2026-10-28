#!/usr/bin/env node
/**
 * verify-interaction.mjs —— t_b37e6b4b 验收：真实指针点击（不用 __gevLc.open）
 *  1) 依次真实点击 7 张 header：每张都打开、不出现「点了没反应/卡消失」
 *  2) 组内切换 data→scene / pp→cctv→global / location→control：平滑替换、overlap=0
 *  3) 快速连点 7 张：不叠卡、不跳位、最终状态确定（最后一次点击生效）
 *  4) 全部关闭：7 卡回初始折叠位
 *  5) 全程记录 rect + visibility + 点击命中元素；console error=0
 * 输出：.gev-logs/t_b37e6b4b/verify.json + 关键截图
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const OUT = path.resolve('.gev-logs/t_b37e6b4b');
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    window.__gevcDebug = true;
  } catch (e) {}
});
const errs = [];
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errs.push(t.slice(0, 200));
  if (/\[gev-lc\]|error/i.test(t)) { logs.push(t.slice(0, 220)); console.log('[console]', t.slice(0, 220)); }
});
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1500);

/* ── 第二 owner 取证：在 App 自己的 click 落点（标题条元素 + document 委托）挂计数器。
   唯一 owner 生效时，本层在 capture 阶段 stopImmediatePropagation → 计数器必须恒为 0。
   只要 App 收到一次 click，它就会 setPanelCollapsed() 改 .collapsed = 用户看到的乱跳。 */
await page.evaluate(() => {
  window.__appHits = [];
  const push = (why, e) => {
    const t = e.target;
    const card = t && t.closest ? t.closest('.gev-lc') : null;
    window.__appHits.push({
      why,
      card: card ? card.id : null,
      tag: t ? t.tagName : null,
      cls: t && typeof t.className === 'string' ? t.className.slice(0, 60) : '',
      detail: e.detail,
    });
  };
  document.querySelectorAll('.dock-tray-toggle,.panel-header,.pp-header-row').forEach((b) => {
    b.addEventListener('click', (e) => push('el', e), false);
  });
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.dock-tray-toggle,.panel-header,.pp-header-row'))
      push('doc', e);
  });
});
const appHits = () => page.evaluate(() => window.__appHits.slice());
/* 按下时刻的真实命中（用于区分「App 吞了点击」与「测试瞄准时卡片已经滑走」）*/
await page.evaluate(() => {
  window.__downs = [];
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target;
      const card = t && t.closest ? t.closest('.gev-lc') : null;
      window.__downs.push({
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        card: card ? card.id : null,
        hdr: !!(t && t.closest && t.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.panel-title,.pp-header-label,.location-toolbar')),
        tgt: t ? t.tagName.toLowerCase() + '.' + String(t.className || '').slice(0, 40) : null,
      });
    },
    true,
  );
});
const downsSince = (n) => page.evaluate((n) => window.__downs.slice(n), n);
const downsLen = () => page.evaluate(() => window.__downs.length);


const snap = () => page.evaluate(() => window.__gevLc.state());
// 关键：点在 header 上「非按钮」的位置（标题文字区），避免误点 header 内的真控件
const headPoint = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const head = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle') || el;
  const b = head.getBoundingClientRect();
  const isCtl = (n) => n && n.closest && n.closest('input,select,textarea,a,label,button:not(.panel-header):not(.dock-tray-toggle),.panel-collapse-btn,.context-radio-dock,.pp-toggle-btn,.scene-btn');
  let x = null, y = Math.round(b.top + b.height / 2);
  for (let i = 1; i <= 10; i++) {
    const cx = Math.round(b.left + (b.width * i) / 11);
    const hit = document.elementFromPoint(cx, y);
    if (hit && !isCtl(hit) && hit.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle') && hit.closest('[id="' + id + '"]')) { x = cx; break; }
  }
  if (x === null) x = Math.round(b.left + b.width / 2);
  const hit = document.elementFromPoint(x, y);
  const desc = (n) => n ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '') : 'null';
  const owner = hit && hit.closest('.gev-lc');
  return {
    x, y, head: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
    hit: desc(hit),
    hitInCard: !!(hit && hit.closest('[id="' + id + '"]')),
    hitInOtherCard: !!(owner && owner.id !== id),
    hitInHeader: !!(hit && hit.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle')),
    hitOwner: owner ? owner.id : null,
  };
}, id);

/* 像真人一样「瞄准即刻按下」：连点测试里卡片正在动，取点后到按下之间布局可能已经移位，
   所以按下前复核命中元素；没命中目标 header 就重新取点（最多 5 次）。 */
const aimAndClick = async (id, maxTry = 5) => {
  let p = null;
  let tries = 0;
  for (let i = 0; i < maxTry; i++) {
    tries = i + 1;
    p = await headPoint(id);
    if (p.hitInCard && p.hitInHeader) break;
    await sleep(50);
  }
  await page.mouse.move(p.x, p.y);
  const pre = await page.evaluate((x, y) => {
    const h = document.elementFromPoint(x, y);
    return h ? { tag: h.tagName.toLowerCase(), cls: typeof h.className === 'string' ? h.className : '', card: (h.closest && h.closest('.gev-lc') || {}).id || null, header: !!(h.closest && h.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle')) } : null;
  }, p.x, p.y);
  await sleep(30);
  await page.mouse.down(); await sleep(30); await page.mouse.up();
  return { ...p, tries, preClick: pre, aimed: !!(pre && pre.card === id && pre.header) };
};

const clickAt = async (p) => {
  await page.mouse.move(p.x, p.y);
  await sleep(40);
  await page.mouse.down(); await sleep(30); await page.mouse.up();
};

const overlaps = (st) => {
  const vis = IDS.filter((id) => st[id] && st[id].disp !== 'none' && st[id].vis === 'visible' && st[id].w > 4 && st[id].h > 4);
  const out = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = st[vis[i]], b = st[vis[j]];
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w > 1 && h > 1) out.push({ a: vis[i], b: vis[j], area: w * h, rect: [w, h] });
  }
  return out;
};
const anyHidden = (st) => IDS.filter((id) => st[id] && st[id].vis !== 'visible').map((id) => id + ':' + st[id].vis);
const anyHidClass = () => page.evaluate(() => [...document.querySelectorAll('.gev-lc-hid')].map((e) => e.id));
/* 占位符必须完全看不见、也点不到（「ghost」只在它是可见块时才算 bug）*/
const phInfo = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.gev-lc-placeholder')].map((p) => {
      const s = getComputedStyle(p);
      return { vis: s.visibility, pe: s.pointerEvents, w: Math.round(p.getBoundingClientRect().width), h: Math.round(p.getBoundingClientRect().height), op: Number(s.opacity) };
    }),
  );
/* 状态自相矛盾（floating 却 collapsed / 没浮却展开 / 浮却不可见）= 双 owner 的症状 */
const consistency = (st) => {
  const bad = [];
  for (const id of IDS) {
    const s = st[id];
    if (!s) continue;
    if (s.floating && s.collapsed) bad.push(id + ':floating+collapsed');
    if (!s.floating && !s.collapsed) bad.push(id + ':open-but-not-floating');
    if (s.floating && s.vis !== 'visible') bad.push(id + ':floating+' + s.vis);
  }
  return bad;
};
/* 静止态：浮层卡不许还是「迷你高度」（说明只改了 .collapsed 没真展开）*/
const tooShort = (st) => IDS.filter((id) => st[id] && st[id].floating && st[id].h < 100).map((id) => id + ':h=' + st[id].h);
const ghost = (ph) => ph.filter((x) => (x.vis !== 'hidden' && x.op > 0.02) || x.pe !== 'none');
/* 滚动条必须隐藏：浮层卡真实占位宽 - 内容宽 = 滚动条槽宽，必须 ≤1px */
const scrollInfo = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.gev-lc-floating')].map((e) => ({
      id: e.id,
      sbw: e.offsetWidth - e.clientWidth,
      sw: getComputedStyle(e).scrollbarWidth,
      scrollable: e.scrollHeight > e.clientHeight + 2,
    })),
  );

// 等所有 WAAPI 动画收尾（morph 350ms / 让位 280ms）——「叠卡」只在静止态判定
const settle = async (maxMs = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => (document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : 0));
    if (!n) { await sleep(50); return true; }
    await sleep(60);
  }
  return false;
};
// 诊断：卡为什么不可见（追祖先链的 visibility 来源 + 可见遮罩）
const diag = () => page.evaluate(() => {
  const chain = [];
  let n = document.getElementById('data-panel');
  while (n && n !== document.documentElement.parentElement) {
    const s = getComputedStyle(n);
    chain.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + '[' + s.visibility + (n.style && n.style.visibility ? ' inline=' + n.style.visibility : '') + ']');
    n = n.parentElement;
  }
  const masks = [...document.querySelectorAll('#hud-loading,.modal,.overlay,[role=dialog],.first-run,.mission')]
    .filter((e) => { const s = getComputedStyle(e); return s.visibility === 'visible' && +s.opacity > 0.2; })
    .slice(0, 7).map((e) => (e.id || e.className) + '[' + getComputedStyle(e).position + ']');
  return { chain, masks };
});
const summary = (st) => IDS.map((id) => `${id}[${st[id].x},${st[id].y},${st[id].w}x${st[id].h}${st[id].floating ? ' F' : ''}${st[id].collapsed ? ' c' : ''}${st[id].vis !== 'visible' ? ' ' + st[id].vis : ''}${st[id].push && (st[id].push.x || st[id].push.y) ? ' push(' + st[id].push.x + ',' + st[id].push.y + ')' : ''}]`).join(' ');

const R = { before: null, steps: [], groups: [], rapid: {}, closing: {}, errors: [] };
const base = await snap();
R.before = { state: base, overlaps: overlaps(base), hidden: anyHidden(base), summary: summary(base) };
console.log('== 初始 ==');
console.log(summary(base), '| overlaps:', JSON.stringify(overlaps(base)));
await page.screenshot({ path: path.join(OUT, '00-initial.png') });

/* ── 0) hover 不应原地展开（掐掉 App 的 850ms hover disclosure，第二 owner）───── */
console.log('\n== 0) hover 不展开 ==');
const hoverBefore = await snap();
const hoverPt = await headPoint('control-panel');
await page.mouse.move(hoverPt.x, hoverPt.y);
await sleep(1500);
const hoverAfter = await snap();
R.hover = {
  id: 'control-panel', point: [hoverPt.x, hoverPt.y],
  before: { collapsed: hoverBefore['control-panel'].collapsed, floating: hoverBefore['control-panel'].floating },
  after: { collapsed: hoverAfter['control-panel'].collapsed, floating: hoverAfter['control-panel'].floating, h: hoverAfter['control-panel'].h },
};
console.log('hover 1.5s -> collapsed:', R.hover.after.collapsed, '(应为 true) floating:', R.hover.after.floating, 'h:', R.hover.after.h);
await page.mouse.move(760, 400);
await sleep(300);

/* ── 1) 依次真实点击 7 张 header ─────────────────────────────────────────── */
console.log('\n== 1) 依次点击 7 张 header ==');
for (const id of IDS) {
  const p = await aimAndClick(id);
  let t0 = Date.now();
  await sleep(520);
  await settle();
  const st = await snap();
  const ok = !!(st[id] && st[id].floating) && st[id].vis === 'visible';
  if (!ok) { // 慢帧兜底：再等 400ms 复核
    await sleep(400);
  }
  const st2 = await snap();
  const rec = {
    id, clickPoint: p, hit: p.hit, hitInCard: p.hitInCard, hitInOther: p.hitInOtherCard,
    aimed: p.aimed, aimTries: p.tries, firstTryOpen: ok,
    open: !!(st2[id] && st2[id].floating), ms: Date.now() - t0,
    state: st2, overlaps: overlaps(st2), hidden: anyHidden(st2),
    consistency: consistency(st2), tooShort: tooShort(st2), ph: await phInfo(),
    ghost: ghost(await phInfo()), scroll: await scrollInfo(),
    hidClass: await anyHidClass(), appHits: (await appHits()).length,
    summary: summary(st2),
  };
  if (rec.hidden.length) rec.diag = await diag();
  R.steps.push(rec);
  console.log(`${id.padEnd(22)} hit=${p.hit.slice(0, 42).padEnd(42)} open=${rec.open ? 'Y' : 'N'} 1st=${rec.firstTryOpen ? 'Y' : 'N'} ovl=${rec.overlaps.length} hidden=[${rec.hidden.join(',')}] bad=${JSON.stringify(rec.consistency)} short=${JSON.stringify(rec.tooShort)} ghost=${rec.ghost.length} appHits=${rec.appHits}`);
  console.log('   ', rec.summary);
}
await page.screenshot({ path: path.join(OUT, '01-after-7-clicks.png') });

/* ── 2) 组内切换 ─────────────────────────────────────────────────────────── */
console.log('\n== 2) 组内切换 ==');
const pairs = [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'], ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles'], ['location-bar', 'control-panel'], ['control-panel', 'location-bar']];
for (const [from, to] of pairs) {
  // 确保 from 打开
  let st = await snap();
  if (!st[from].floating) { await aimAndClick(from); await sleep(600); st = await snap(); }
  const p = await aimAndClick(to);
  // 切换过程逐帧采样（40ms × 14 ≈ 560ms）：不许有卡 hidden、不许出现可见 ghost、不许叠卡
  const trace = [];
  for (let i = 0; i < 14; i++) {
    await sleep(40);
    const s = await snap();
    const ph = await phInfo();
    trace.push({
      t: i * 40,
      hidden: anyHidden(s),
      ovl: overlaps(s).length,
      ovlArea: overlaps(s).reduce((a, x) => a + x.area, 0),
      ovlPairs: overlaps(s).map((o) => o.a + '>' + o.b),
      ghost: ghost(ph).length,
      bad: consistency(s),
      fromF: !!s[from].floating,
      toF: !!s[to].floating,
    });
  }
  const mid = await snap();     // 切换中：不许有卡消失
  await sleep(700);
  await settle();
  const st2 = await snap();
  const midHidden = anyHidden(mid);
  const rec = {
    from, to, hit: p.hit, hitInCard: p.hitInCard, aimed: p.aimed,
    midHidden, midFromFloating: mid[from].floating, midToFloating: mid[to].floating,
    trace, traceBad: trace.filter((x) => x.hidden.length || x.ghost || x.bad.length),
    traceOvlMax: Math.max(0, ...trace.map((x) => x.ovl)),
    fromClosed: !st2[from].floating, toOpen: !!st2[to].floating,
    overlaps: overlaps(st2), hidden: anyHidden(st2), hidClass: await anyHidClass(),
    consistency: consistency(st2), appHits: (await appHits()).length,
    state: st2, summary: summary(st2),
  };
  R.groups.push(rec);
  console.log(`${from} -> ${to} :: hit=${p.hit.slice(0, 34)} toOpen=${rec.toOpen} fromClosed=${rec.fromClosed} ovl=${rec.overlaps.length} midHidden=[${midHidden.join(',')}] hidCls=${rec.hidClass.length} traceBad=${rec.traceBad.length} traceOvlMax=${rec.traceOvlMax} bad=${JSON.stringify(rec.consistency)} appHits=${rec.appHits}`);
  if (rec.traceBad.length) console.log('    traceBad:', JSON.stringify(rec.traceBad.slice(0, 4)));
  console.log('   ', rec.summary);
  if (to === 'scene-panel' || to === 'cctv-panel') await page.screenshot({ path: path.join(OUT, `02-switch-${from}-${to}.png`) });
}

/* ── 3) 快速连点 7 张 ────────────────────────────────────────────────────── */
console.log('\n== 3) 快速连点 7 张（间隔 60ms）==');
// 先全部关掉，回到确定起点
for (const id of IDS) { const s = await snap(); if (s[id].floating) { await aimAndClick(id); await sleep(420); } }
await sleep(400);
const rapid = [];
for (const id of IDS) {
  // 连点时卡片在动：按「按下时刻真正命中的元素」判定。没落在目标 header 上 = 瞄准竞态
  // （真人也会扑空，再补一次），落在 header 上却没反应 = App 吞点击 = 真 bug。
  let aimMiss = 0;
  let before = await snap();
  let n0 = await downsLen();
  let p = await aimAndClick(id);
  let downs = (await downsSince(n0)).filter((d) => d.card === id && d.hdr);
  while (!downs.length && aimMiss < 3) {
    aimMiss++;
    await sleep(80);
    before = await snap();
    n0 = await downsLen();
    p = await aimAndClick(id);
    downs = (await downsSince(n0)).filter((d) => d.card === id && d.hdr);
  }
  await sleep(60);
  const after = await snap();
  const pressHitTarget = downs.length > 0;
  const changed = after[id].floating !== before[id].floating;
  rapid.push({
    id, hit: p.hit, aimed: p.aimed, tries: p.tries,
    press: downs[downs.length - 1] || null, pressHitTarget, aimMiss,
    changed, pressNoEffect: pressHitTarget && !changed,
    open: after[id].floating,
  });
  await sleep(20);
}
await sleep(1200);
await settle();
const stR = await snap();
// 期望的最终展开集合 = 每组里「最后一次真正生效的点击」那张（= 最后一次点击生效）
const GROUPS = [['data-panel', 'scene-panel'], ['pp-toggles', 'cctv-panel', 'global-context-panel'], ['location-bar', 'control-panel', 'gev-voice-control']];
const expectOpen = [];
for (const g of GROUPS) {
  const seqG = rapid.filter((c) => g.includes(c.id) && c.changed);
  if (seqG.length) expectOpen.push(seqG[seqG.length - 1].id);
}
R.rapid = {
  clicks: rapid, state: stR, overlaps: overlaps(stR), hidden: anyHidden(stR), summary: summary(stR),
  lastId: IDS[IDS.length - 1], lastOpen: !!stR[IDS[IDS.length - 1]].floating,
  consistency: consistency(stR), tooShort: tooShort(stR), ghost: ghost(await phInfo()), appHits: (await appHits()).length,
  open: IDS.filter((id) => stR[id].floating), expectOpen,
  aimMiss: rapid.reduce((a, c) => a + c.aimMiss, 0), pressNoEffect: rapid.filter((c) => c.pressNoEffect).map((c) => c.id),
};
console.log('last click =', IDS[IDS.length - 1], 'open =', R.rapid.lastOpen, 'ovl =', R.rapid.overlaps.length, 'hidden =', R.rapid.hidden.length);
console.log('aimMiss =', R.rapid.aimMiss, 'pressNoEffect =', JSON.stringify(R.rapid.pressNoEffect));
console.log('open =', JSON.stringify(R.rapid.open), 'expect =', JSON.stringify(R.rapid.expectOpen));
console.log('   ', R.rapid.summary);
await page.screenshot({ path: path.join(OUT, '03-rapid.png') });

/* ── 4) 全部关闭 ─────────────────────────────────────────────────────────── */
console.log('\n== 4) 全部关闭 ==');
const closeLog = [];
for (const id of IDS) {
  let s = await snap();
  if (!s[id].floating) continue;
  await aimAndClick(id);
  await sleep(420);
  s = await snap();
  let retries = s[id].floating ? 1 : 0;
  if (s[id].floating) { await aimAndClick(id); await sleep(420); s = await snap(); }   // 点了没反应 → 再点一次（必须为 0 次）
  closeLog.push({ id, retries, closed: !s[id].floating });
}
await sleep(600);
await settle();
const stC = await snap();
const drift = IDS.map((id) => {
  const a = R.before.state[id], b = stC[id];
  return { id, d: [b.x - a.x, b.y - a.y, b.w - a.w, b.h - a.h], push: b.push };
});
R.closing = { state: stC, overlaps: overlaps(stC), hidden: anyHidden(stC), drift, summary: summary(stC),
  closeLog, consistency: consistency(stC), ph: await phInfo(), appHits: (await appHits()).length };
console.log('restored drift:', JSON.stringify(drift.filter((d) => d.d.some((v) => Math.abs(v) > 1) || (d.push && (d.push.x || d.push.y)))));
console.log('   ', R.closing.summary);
await page.screenshot({ path: path.join(OUT, '04-all-closed.png') });

R.errors = errs;
fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(R, null, 1));

/* ── 判定 ────────────────────────────────────────────────────────────────── */
const fails = [];
if (!R.hover.after.collapsed || R.hover.after.floating) fails.push('0) hover 1.5s 仍触发原地展开（第二 owner 没掐断）');
R.steps.forEach((s) => {
  if (!s.open) fails.push(`1)${s.id} 点击未打开`);
  if (!s.firstTryOpen) fails.push(`1)${s.id} 第一次点击没反应（要补点）`);
  if (!s.aimed) fails.push(`1)${s.id} 点击没有命中 header（测试无效）`);
  if (s.overlaps.length) fails.push(`1)${s.id} 出现重叠 ${JSON.stringify(s.overlaps)}`);
  if (s.hidden.length) fails.push(`1)${s.id} 有卡被隐藏 ${s.hidden}`);
  if (s.consistency.length) fails.push(`1)${s.id} 状态自相矛盾 ${JSON.stringify(s.consistency)}`);
  if (s.hidClass.length) fails.push(`1)${s.id} 出现 gev-lc-hid ${JSON.stringify(s.hidClass)}`);
  if (s.ghost.length) fails.push(`1)${s.id} 出现可见 ghost 占位 ${JSON.stringify(s.ghost)}`);
  if (s.tooShort.length) fails.push(`1)${s.id} 浮层卡还是迷你高度（只改了 collapsed 没真展开）${JSON.stringify(s.tooShort)}`);
  if (s.scroll.some((x) => x.sbw > 1 || x.sw !== 'none')) fails.push(`1)${s.id} 滚动条没隐藏 ${JSON.stringify(s.scroll)}`);
  if (s.appHits) fails.push(`1)${s.id} App 收到了 header click（第二 owner 还活着，累计 ${s.appHits} 次）`);
});
R.groups.forEach((g) => {
  if (!g.toOpen) fails.push(`2)${g.from}->${g.to} 目标未打开`);
  if (!g.fromClosed) fails.push(`2)${g.from}->${g.to} 原卡未关闭`);
  if (!g.aimed) fails.push(`2)${g.from}->${g.to} 点击没命中目标 header`);
  if (g.overlaps.length) fails.push(`2)${g.from}->${g.to} 重叠 ${JSON.stringify(g.overlaps)}`);
  if (g.midHidden.length) fails.push(`2)${g.from}->${g.to} 切换中卡被隐藏 ${g.midHidden}`);
  if (g.hidClass.length) fails.push(`2)${g.from}->${g.to} 仍有 gev-lc-hid`);
  if (g.traceBad.length) fails.push(`2)${g.from}->${g.to} 切换过程出现 hidden/ghost/叠卡 ${JSON.stringify(g.traceBad.slice(0, 3))}`);
  if (g.consistency.length) fails.push(`2)${g.from}->${g.to} 状态自相矛盾 ${JSON.stringify(g.consistency)}`);
  if (g.appHits) fails.push(`2)${g.from}->${g.to} App 收到了 header click`);
});
R.rapid.clicks.forEach((c) => {
  if (c.pressNoEffect) fails.push(`3)${c.id} 按下命中 header 却没反应（App 吞点击）press=${JSON.stringify(c.press)}`);
  if (!c.pressHitTarget) fails.push(`3)${c.id} 连续 4 次按下都没落在目标 header（瞄准/可达性异常）press=${JSON.stringify(c.press)}`);
});
if (!R.rapid.lastOpen) fails.push('3) 快速连点：最后一次点击未生效');
if (R.rapid.overlaps.length) fails.push('3) 快速连点后重叠 ' + JSON.stringify(R.rapid.overlaps));
if (R.rapid.hidden.length) fails.push('3) 快速连点后有卡隐藏');
if (R.rapid.tooShort.length) fails.push('3) 快速连点后仍有迷你高度浮层卡 ' + JSON.stringify(R.rapid.tooShort));
if (R.rapid.consistency.length) fails.push('3) 快速连点后状态矛盾 ' + JSON.stringify(R.rapid.consistency));
if (R.rapid.ghost.length) fails.push('3) 快速连点后出现可见 ghost');
if (JSON.stringify(R.rapid.open.slice().sort()) !== JSON.stringify(R.rapid.expectOpen.slice().sort()))
  fails.push('3) 快速连点后最终状态不确定：open=' + JSON.stringify(R.rapid.open) + ' 期望=' + JSON.stringify(R.rapid.expectOpen));
if (R.rapid.appHits) fails.push('3) 快速连点后 App 收到 header click');
R.closing.drift.forEach((d) => { if (d.d.some((v) => Math.abs(v) > 1)) fails.push(`4)${d.id} 收起未还原 ${JSON.stringify(d.d)}`); if (d.push && (d.push.x || d.push.y)) fails.push(`4)${d.id} 收起后仍带偏移 ${JSON.stringify(d.push)}`); });
R.closing.closeLog.forEach((c) => { if (!c.closed) fails.push(`4)${c.id} 收起失败`); if (c.retries) fails.push(`4)${c.id} 收起第一次没反应`); });
if (R.closing.overlaps.length) fails.push('4) 全部关闭后仍有重叠');
if (R.closing.hidden.length) fails.push('4) 全部关闭后有卡隐藏 ' + JSON.stringify(R.closing.hidden));
if (R.closing.consistency.length) fails.push('4) 全部关闭后状态矛盾 ' + JSON.stringify(R.closing.consistency));
if (R.closing.appHits) fails.push('4) App 收到 header click');
if (errs.length) fails.push('5) console error: ' + JSON.stringify(errs.slice(0, 4)));

console.log('\n==== 结果 ====');
console.log(fails.length ? 'FAIL\n - ' + fails.join('\n - ') : 'PASS: 5 项验收全过（真实指针点击，console error=0）');
console.log('artifacts:', OUT);
await browser.close();
process.exit(fails.length ? 1 : 0);
