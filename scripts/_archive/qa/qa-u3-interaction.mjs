#!/usr/bin/env node
/**
 * qa-u3-interaction.mjs —— Phase 1 真实指针验收（U3/U4/U5/U11）
 *
 * 硬性要求：
 *  - 只用真实鼠标（CDP Input.dispatchMouseEvent = 浏览器可信事件），绝不用 __gevLc.open()
 *  - 每步记录：点击坐标 / 命中元素 / 卡片 rect+visibility+collapsed+floating / overlap
 *  - 输出 JSON + 截图，供 lead 复算
 *
 * 用法: node scripts/qa-u3-interaction.mjs [--keep-store] [--headful]
 * 产物: .gev-logs/u3/report.json / *.png
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.gev-logs/u3');
fs.mkdirSync(OUT, { recursive: true });
const KEEP = process.argv.includes('--keep-store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARDS = [
  'data-panel',
  'scene-panel',
  'pp-toggles',
  'cctv-panel',
  'global-context-panel',
  'location-bar',
  'control-panel',
];
const ALL_IDS = CARDS.concat(['gev-voice-control', 'gev-gfx-fab']);

const browser = await puppeteer.launch({
  headless: !process.argv.includes('--headful'),
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--window-size=1560,860',
    '--window-position=1900,40',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });

await page.evaluateOnNewDocument(() => {
  try {
    const keep = (window.name || '').indexOf('keep') >= 0;
    if (!keep) {
      localStorage.removeItem('gev-liquid-cards:v2');
      localStorage.removeItem('gev-liquid-cards:v2:last');
    }
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem(
      'gev.gfx',
      JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }),
    );
    // 指针事件取证器：真实点击会留下 trusted=true 的记录
    window.__ptr = [];
    const rec = (ev) =>
      window.__ptr.push({
        type: ev.type,
        trusted: ev.isTrusted,
        x: ev.clientX,
        y: ev.clientY,
        target: ev.target && ev.target.tagName + '.' + (ev.target.className || '').toString().slice(0, 60),
        t: Math.round(performance.now()),
      });
    for (const t of ['pointerdown', 'pointerup', 'click']) window.addEventListener(t, rec, true);
  } catch (e) {}
});
if (KEEP) await page.evaluate(() => (window.name = 'keep'));

const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300));
});

const report = { startedAt: new Date().toISOString(), steps: [], initial: null, failures: [], layoutChecks: [] };
const fail = (id, msg, detail) => {
  report.failures.push({ id, msg, detail });
  console.log('FAIL', id, msg, detail ? JSON.stringify(detail).slice(0, 300) : '');
};

/** 硬断言（B2）：overlaps 必须为空 + 7/7 主卡 header 必须 elementFromPoint 命中自己。
 *  初始态（首屏自动展开）与 reload-memory（恢复上次卡）两条默认路径都必须过；
 *  历史版本只在 click-open 步骤断言 overlap，初始态只记录不 assert → 7392px² 重叠进了 0 failure。 */
const assertLayout = async (tag, s) => {
  const hits = {};
  for (const id of CARDS) hits[id] = await headerHittable(id);
  const bad = Object.entries(hits)
    .filter(([, h]) => !h.ok)
    .map(([k, h]) => ({ id: k, why: h.why, blockedBy: h.blockedBy, rect: h.rect }));
  if (s.overlaps.length) fail('U4', tag + '：存在卡片重叠（overlap 必须为 0）', s.overlaps);
  if (bad.length) fail('U3', tag + '：' + bad.length + '/7 张主卡 header 不可点', bad);
  const row = {
    tag,
    overlaps: s.overlaps,
    overlapsOk: !s.overlaps.length,
    headersOk: 7 - bad.length,
    headerHittable: hits,
    bad,
    floating: s.floating,
  };
  report.layoutChecks.push(row);
  console.log(
    'layout', tag, '| overlaps=', s.overlaps.length,
    '| headerHittable=', 7 - bad.length + '/7',
    '| floating=', (s.floating || []).join(','),
  );
  return row;
};

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
// U5：首次打开必须已经自动展开一张主卡（脚本不再用 Escape 清场，否则等于替用户关掉）
// 注意：prime 现在会等「App 把面板搬回各自轨道 + 布局沉降」（实测 6–9s 才开）才展开，
// 所以这里按条件等（最多 25s），不能再用固定 9/11s 硬睡。
const waitBooted = async (tag) => {
  try {
    await page.waitForFunction(
      (ids) => {
        const got = window.__gevLc && window.__gevLc._ids ? window.__gevLc._ids() : [];
        if (!got.some((id) => ids.indexOf(id) >= 0)) return false;
        // 加载幕还在遮着 → 任何 elementFromPoint 都命中 #loading-screen，不能当最终态
        const ls = document.getElementById('loading-screen');
        const op = ls ? parseFloat(getComputedStyle(ls).opacity) : 0;
        if (ls && Number.isFinite(op) && op >= 0.05) return false;
        // 浮层卡必须真的在 body 顶层（App 右栏 init 会抢回轨道，heal 会还回来）
        for (const id of got) {
          const e = document.getElementById(id);
          if (e && e.parentElement !== document.body) return false;
        }
        return true;
      },
      { timeout: 30000, polling: 200 },
      CARDS,
    );
  } catch (e) {
    fail('U5', tag + '：30s 内没有自动展开主卡 / 加载幕未退 / 浮层未脱层', String(e && e.message).slice(0, 120));
  }
  // 连续两次几何签名一致 = morph/让位补间已落定，再继续量
  const geo = () =>
    page.evaluate((ids) => {
      const out = [];
      for (const id of ids) {
        const e = document.getElementById(id);
        if (!e) { out.push(id + ':-'); continue; }
        const b = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        out.push(id + ':' + [b.left, b.top, b.width, b.height].map((v) => Math.round(v)).join(',') + '|' + s.display + '|' + (e.parentElement === document.body));
      }
      return out.join('|');
    }, CARDS);
  let prev = await geo();
  for (let i = 0; i < 14; i++) {
    await sleep(500);
    const now = await geo();
    if (now === prev) break;
    prev = now;
  }
  await sleep(700);
};
await sleep(4000); // 先给 App 自己的启动动画一点时间，避免把半成品当最终态
await waitBooted('initial');

/* ── 采样器 ───────────────────────────────────────────────────────────── */
const snap = () =>
  page.evaluate((ids) => {
    const rects = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) {
        rects[id] = null;
        continue;
      }
      const b = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      rects[id] = {
        x: Math.round(b.left),
        y: Math.round(b.top),
        w: Math.round(b.width),
        h: Math.round(b.height),
        vis: s.visibility,
        disp: s.display,
        op: +Number(s.opacity).toFixed(2),
        z: s.zIndex,
        collapsed: e.classList.contains('collapsed'),
        floating: e.classList.contains('gev-lc-floating'),
        hid: e.classList.contains('gev-lc-hid'),
        anims: e.getAnimations ? e.getAnimations().length : 0,
      };
    }
    const vis = Object.keys(rects).filter(
      (k) => rects[k] && rects[k].vis !== 'hidden' && rects[k].disp !== 'none' && rects[k].op > 0.05 && rects[k].w > 4 && rects[k].h > 4,
    );
    const ov = [];
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const A = rects[vis[i]],
          B = rects[vis[j]];
        const w = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const h = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        if (w > 0 && h > 0) ov.push({ a: vis[i], b: vis[j], area: Math.round(w * h) });
      }
    return { rects, overlaps: ov, floating: window.__gevLc._ids() };
  }, ALL_IDS);

/** 找 header 上真正可点的空白点：命中元素必须落在该卡 header 内，且不是内部控件 */
const headerPoint = (id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const HSEL = '.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.location-toolbar,.panel-title,.pp-header-label';
    const CTRL = 'input,select,textarea,a,label,[role=slider],[contenteditable],.pp-slider,.pp-select,.pp-mode-btn,.gev-lc-edge,.panel-collapse-btn,.pp-collapse-btn,.dock-pin-btn,[data-no-toggle],.style-btn,.pp-toggle-btn,.scene-btn,.context-radio-dock,.context-radio-toggle,.context-radio-mini';
    const heads = ['.panel-header', '.pp-header-row', '.dock-tray-toggle', '.location-toolbar', '.location-bar-toggle'];
    for (const sel of heads) {
      const node = el.querySelector(sel);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 40 || r.height < 12) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      for (let fy = 0.5; fy <= 0.9; fy += 0.2)
        for (let fx = 0.12; fx <= 0.92; fx += 0.08) {
          const x = Math.round(r.left + r.width * fx);
          const y = Math.round(r.top + r.height * fy);
          if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue;
          const hit = document.elementFromPoint(x, y);
          if (!hit) continue;
          if (!el.contains(hit)) continue;
          const head = hit.closest(HSEL);
          if (!head || !el.contains(head)) continue;
          // 命中内部控件（且该控件不是 header 本身）→ 这不算 「点标题条」
          const ctrl = hit.closest(CTRL);
          if (ctrl && !head.contains(ctrl) && ctrl !== head) continue;
          const name = hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + '.' + String(hit.className || '').split(' ')[0];
          return { x, y, hit: name, headerSel: sel, headerRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
        }
    }
    return null;
  }, id);

/** 某卡 header 是否仍可点（U3：不得被 hidden / 被别卡压住） */
const headerHittable = (id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return { ok: false, why: 'missing' };
    const s = getComputedStyle(el);
    if (s.display === 'none') return { ok: false, why: 'display:none' };
    if (s.visibility === 'hidden') return { ok: false, why: 'visibility:hidden' };
    const head = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar,.location-bar-toggle,.panel-title');
    const node = head || el;
    const r = node.getBoundingClientRect();
    if (r.width < 20 || r.height < 8) return { ok: false, why: 'zero-size' };
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
      return { ok: false, why: 'offscreen', rect: { x: r.left, y: r.top } };
    // 在 header 中线取几个点，看命中的是不是它自己（或其后代）
    let hitSelf = 0;
    const pts = [
      [r.left + r.width * 0.5, r.top + r.height * 0.5],
      [r.left + r.width * 0.25, r.top + r.height * 0.5],
      [r.left + r.width * 0.75, r.top + r.height * 0.5],
    ];
    const blockedBy = [];
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) continue;
      const h = document.elementFromPoint(x, y);
      if (h && el.contains(h)) hitSelf++;
      else if (h) blockedBy.push(h.id ? '#' + h.id : h.tagName.toLowerCase() + '.' + String(h.className || '').split(' ')[0]);
    }
    return {
      ok: hitSelf > 0,
      hitSelf,
      blockedBy: [...new Set(blockedBy)],
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }, id);

const click = async (x, y, tag) => {
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(30);
  await page.mouse.down();
  await sleep(45);
  await page.mouse.up();
  await sleep(Number(globalThis.__settle || 620));
};

const NO_SHOTS = process.argv.includes('--no-shots');
const shot = async (name) => {
  const p = path.join(OUT, name + '.png');
  if (NO_SHOTS) return p;
  await page.screenshot({ path: p });
  return p;
};

/** 回到“全迷你”状态：用 Esc（真实键盘）逐张关，最多 8 次 */
const closeAll = async () => {
  for (let i = 0; i < 8; i++) {
    const ids = await page.evaluate(() => window.__gevLc._ids());
    if (!ids.length) break;
    await page.keyboard.press('Escape');
    await sleep(480);
  }
  await sleep(350);
  return page.evaluate(() => window.__gevLc._ids());
};

/* ── 0. 初始态（U5） ─────────────────────────────────────────────────── */
const init = await snap();
report.initial = init;
const floatingInit = init.floating || [];
const halfOpen = Object.entries(init.rects)
  .filter(([k, r]) => r && !r.collapsed && !r.floating && CARDS.includes(k))
  .map(([k]) => k);
report.initialExpanded = Object.entries(init.rects)
  .filter(([, r]) => r && !r.collapsed)
  .map(([k]) => k);
report.initialFloating = floatingInit;
report.initialHalfOpen = halfOpen;
if (!floatingInit.some((id) => CARDS.includes(id)))
  fail('U5', '初始态没有展开任何主卡（浮层）', { floatingInit, expanded: report.initialExpanded });
if (halfOpen.length) fail('U5', '初始态存在「半开卡」（collapsed=false 但非浮层）', halfOpen);
// B1 回归门：首屏 = 用户默认路径，必须 0 overlap 且 7/7 header 命中自己（真实点击前置条件）
report.initialLayout = await assertLayout('initial', init);
console.log('U5 初始 floating:', floatingInit.join(','), '| expanded:', report.initialExpanded.join(','), '| halfOpen:', halfOpen.join(',') || 'none');
await shot('00-initial');

/* ── 1. 7 个 header 真实点击开/关（U3） ──────────────────────────────── */
for (const id of CARDS) {
  // 初始态可能已经有一张主卡是开着的（U5 默认展开）→ 先关掉，保证从迷你态开始测
  if ((await snap()).rects[id] && (await snap()).rects[id].floating) {
    const hpc = await headerPoint(id);
    if (hpc) await click(hpc.x, hpc.y, id);
    await sleep(700);
  }
  const hp = await headerPoint(id);
  if (!hp) {
    fail('U3', id + ' 找不到可点的 header 空白点');
    continue;
  }
  const before = await snap();
  const hittableBefore = await headerHittable(id);
  await click(hp.x, hp.y, id);
  const mid = await snap();
  await sleep(500);
  const after = await snap();
  const hittableAfter = await headerHittable(id);
  const isOpen = after.rects[id] && after.rects[id].floating;
  const step = {
    card: id,
    point: hp,
    hittableBefore,
    before: before.rects[id],
    mid: mid.rects[id],
    after: after.rects[id],
    openedAsFloating: !!isOpen,
    overlaps: after.overlaps,
    hittableAfter,
    otherHeaders: Object.fromEntries(
      await Promise.all(CARDS.filter((x) => x !== id).map(async (x) => [x, await headerHittable(x)])),
    ),
    floating: after.floating,
  };
  report.steps.push({ kind: 'click-open', ...step });
  await shot('01-open-' + id);
  if (!isOpen) fail('U3', id + ' 真实点击 header 没有展开为浮层', step.after);
  if (!hittableAfter.ok) fail('U3', id + ' 展开后自身 header 不可点', hittableAfter);
  for (const [k, v] of Object.entries(step.otherHeaders))
    if (!v.ok) fail('U3', id + ' 展开后把 ' + k + ' 的 header 变得不可点（' + v.why + '）', v);
  if (after.overlaps.length) fail('U4', id + ' 展开后存在重叠', after.overlaps);

  // 再点一次 → 收起回原位
  const hp2 = await headerPoint(id);
  if (hp2) {
    await click(hp2.x, hp2.y, id);
    await sleep(700);
    const closed = await snap();
    const back = closed.rects[id];
    const orig = before.rects[id];
    report.steps.push({ kind: 'click-close', card: id, point: hp2, after: back, overlaps: closed.overlaps });
    if (back && back.floating) fail('U3', id + ' 二次点击没有收起', back);
    if (back && orig && (Math.abs(back.x - orig.x) > 2 || Math.abs(back.y - orig.y) > 2 || Math.abs(back.h - orig.h) > 2))
      fail('U3', id + ' 收起后未回原位', { orig, back });
    if (closed.overlaps.length) fail('U4', id + ' 收起后存在重叠', closed.overlaps);
  } else fail('U3', id + ' 收起阶段找不到 header 点');
}

/* ── 2. 组内切换（U3：先关旧再开新，不隐藏可点目标） ──────────────────── */
const groups = [
  ['data-panel', 'scene-panel'],
  ['pp-toggles', 'cctv-panel'],
  ['pp-toggles', 'global-context-panel'],
  ['location-bar', 'control-panel'],
];
for (const [a, b] of groups) {
  await closeAll();
  const hpA = await headerPoint(a);
  const hpB = await headerPoint(b);
  if (!hpA || !hpB) {
    fail('U3', 'group 切换找不到 header 点', { a, b, hpA: !!hpA, hpB: !!hpB });
    continue;
  }
  await click(hpA.x, hpA.y, a);
  await sleep(500);
  const midHpB = await headerPoint(b);
  const stateOpenA = await snap();
  // A 展开状态下，直接点 B 的 header（真实点击，必须有效）
  await click((midHpB || hpB).x, (midHpB || hpB).y, b);
  await sleep(700);
  const after = await snap();
  const step = {
    kind: 'group-switch',
    a,
    b,
    bPointWhileAOpen: midHpB,
    aOpenFloating: stateOpenA.rects[a] && stateOpenA.rects[a].floating,
    aAfterFloating: after.rects[a] && after.rects[a].floating,
    bAfterFloating: after.rects[b] && after.rects[b].floating,
    overlaps: after.overlaps,
  };
  report.steps.push(step);
  await shot('02-switch-' + a + '__' + b);
  if (!step.bAfterFloating) fail('U3', '组内切换到 ' + b + ' 失败（点不到/被隐藏）', tstep(step));
  if (step.aAfterFloating) fail('U3', '组内切换后旧卡 ' + a + ' 仍展开（应互斥）', tstep(step));
  if (after.overlaps.length) fail('U4', '组内切换后重叠', after.overlaps);
}

/* ── 3. 全部展开 / 快速连点（U4） ──────────────────────────────────────
   A) 真实点击节奏 420ms（人手连续点 7 个 header 的正常速度）→ 每一下都必须被
      目标卡接住，且两轮终态逐像素一致（状态确定）。
   B) 压力连点 110ms（远小于 350ms 弹簧）→ 只验不变量：0 overlap / 0 卡片消失
      / 0 console error。此节奏下兄弟 header 本身在补间途中移动，落点误差属物理
      现象（人手也追不上），单独统计为 movingTarget 不计失败。 */
const seq = async (opts) => {
  const cadence = typeof opts === 'number' ? opts : opts.cadence || 420;
  const settle = typeof opts === 'number' ? false : !!opts.settle;
  const log = [];
  for (const id of CARDS) {
    if (settle) await waitSettled();
    const hp = await headerPoint(id);
    if (!hp) {
      log.push({ id, miss: true });
      continue;
    }
    await page.mouse.move(hp.x, hp.y);
    await page.mouse.down();
    await page.mouse.up();
    const rec = await page.evaluate(
      ([id, x, y]) => {
        const el = document.elementFromPoint(x, y);
        const card = el && el.closest ? el.closest('.gev-lc') : null;
        const i = window.__gevLc.info(id);
        return {
          hitCard: card ? card.id : null,
          hitEl: el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className || '').split(' ')[0] : null,
          open: !!(i && i.floating),
        };
      },
      [id, hp.x, hp.y],
    );
    log.push({ id, x: hp.x, y: hp.y, sampledHit: hp.hit, ...rec });
    await sleep(cadence);
  }
  return log;
};

/** 等所有 WAAPI 动画落地（最多 1s）：真实用户点下一个 header 时，前一张卡其实已经站稳 */
const waitSettled = async (max = 1200) => {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const running = await page.evaluate(() => {
      try {
        return document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : 0;
      } catch (e) {
        return 0;
      }
    });
    if (!running) return Date.now() - t0;
    await sleep(40);
  }
  return -1;
};

/** 展开某张卡（真实点击 header）：等落定 → 采样 → 点击 → 校验；必要时光标重采样重试 */
const openCard = async (id) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await waitSettled();
    const hp = await headerPoint(id);
    if (!hp) return { ok: false, why: 'no-header-point', attempt };
    await click(hp.x, hp.y, id);
    await sleep(300);
    const st = await page.evaluate((id) => window.__gevLc.info(id), id);
    if (st && st.floating) return { ok: true, attempt, point: hp, info: st };
    if (attempt < 3) await sleep(200);
  }
  return { ok: false, why: 'click-did-not-open', attempt: 3 };
};

await closeAll();
const logA = await seq({ cadence: 260, settle: true });
await sleep(900);
const afterA = await snap();
report.steps.push({
  kind: 'rapid',
  mode: 'realistic-420ms',
  clicks: logA,
  overlaps: afterA.overlaps,
  floating: afterA.floating,
  rects: afterA.rects,
});
await shot('03-expand-all');
for (const c of logA) {
  if (c.miss) fail('U3', c.id + ' 找不到可点的 header 点');
  else if (c.hitCard !== c.id) fail('U3', c.id + ' 的点击落到了别的卡上', c);
  else if (!c.open) fail('U3', c.id + ' 真实点击后没有展开', c);
}
if (afterA.overlaps.length) fail('U4', '全部展开后存在重叠', afterA.overlaps);

// 确定性：同节奏再点一遍，终态必须逐像素一致
await closeAll();
const logA2 = await seq({ cadence: 260, settle: true });
await sleep(900);
const afterA2 = await snap();
const key = (s) => s.floating.slice().sort().join('|') + ' :: ' + s.floating.slice().sort().map((id) => {
  const r = s.rects[id];
  return id + '@' + r.x + ',' + r.y + ',' + r.w + ',' + r.h;
}).join(' ; ');
report.steps.push({
  kind: 'rapid-determinism',
  mode: 'realistic-420ms',
  run1: key(afterA),
  run2: key(afterA2),
  same: key(afterA) === key(afterA2),
  overlaps: afterA2.overlaps,
});
if (key(afterA) !== key(afterA2))
  fail('U4', '同样点击序列两轮终态不一致（状态不确定）', { run1: key(afterA), run2: key(afterA2) });
for (const c of logA2)
  if (!c.miss && (c.hitCard !== c.id || !c.open)) fail('U3', '第二轮 ' + c.id + ' 点击未生效', c);
if (afterA2.overlaps.length) fail('U4', '第二轮全部展开后存在重叠', afterA2.overlaps);

// B) 压力连点 110ms —— 只验不变量
await closeAll();
const logB = await seq({ cadence: 110, settle: false });
const stressMid = await snap();
await sleep(1200);
const afterB = await snap();
const moving = logB.filter((c) => !c.miss && (c.hitCard !== c.id || !c.open));
report.steps.push({
  kind: 'rapid-stress',
  mode: 'stress-110ms',
  clicks: logB,
  movingTarget: moving.length,
  midOverlaps: stressMid.overlaps,
  afterOverlaps: afterB.overlaps,
  floating: afterB.floating,
  rects: afterB.rects,
});
await shot('03-rapid-stress');
if (afterB.overlaps.length) fail('U4', '压力连点后存在重叠', afterB.overlaps);
const gone = Object.entries(afterB.rects).filter(
  ([k, r]) => CARDS.includes(k) && (!r || r.vis === 'hidden' || r.disp === 'none' || r.op < 0.05 || r.w < 4),
);
if (gone.length) fail('U4', '压力连点后卡片消失/不可见', gone.map(([k]) => k));
const off = Object.entries(afterB.rects).filter(([k, r]) => CARDS.includes(k) && r && (r.x < -2 || r.y < -2 || r.x + r.w > 1538 || r.y + r.h > 732));
if (off.length) fail('U4', '压力连点后卡片跑出视口', off.map(([k, v]) => [k, v.x, v.y, v.w, v.h]));

/* ── 4. 快速双击同一张（U4：不叠、不跳） ─────────────────────────────── */
await closeAll();
{
  const id = 'data-panel';
  await waitSettled();
  const hp = await headerPoint(id);
  if (!hp) { fail('U4', 'double-click: 找不到 data-panel header 点'); }
  else {
  const s0 = await snap();
  await page.mouse.move(hp.x, hp.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.up();
  await sleep(60);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(900);
  const s1 = await snap();
  report.steps.push({ kind: 'double-click', card: id, before: s0.rects[id], after: s1.rects[id], overlaps: s1.overlaps });
  if (s1.overlaps.length) fail('U4', '双击同一卡后重叠', s1.overlaps);
  if (!s1.rects[id].floating && !s1.rects[id].collapsed && s1.rects[id].h > 200)
    fail('U4', '双击后卡处于半开状态', s1.rects[id]);
  }
}

/* ── 5. U11 键盘 / 关闭路径 ─────────────────────────────────────────── */
await closeAll();
if (await headerPoint('control-panel')) {
  const id = 'control-panel';
  const beforeEsc = await snap();
  const o = await openCard(id);
  if (!o.ok) fail('U11', 'control-panel 展开失败，无法验证 Esc', o);
  await sleep(500);
  const opened = await snap();
  await page.keyboard.press('Escape');
  await sleep(800);
  const escClosed = await snap();
  const focusAfterEsc = await page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    return { tag: a.tagName, id: a.id, cls: String(a.className || '').slice(0, 40), inCard: !!a.closest('.gev-lc') };
  });
  report.steps.push({
    kind: 'keyboard-esc',
    opened: opened.rects[id],
    after: escClosed.rects[id],
    before: beforeEsc.rects[id],
    focusAfterEsc,
    overlaps: escClosed.overlaps,
  });
  if (escClosed.rects[id] && escClosed.rects[id].floating) fail('U11', 'Esc 没有关闭浮层', escClosed.rects[id]);
  if (escClosed.rects[id] && beforeEsc.rects[id] &&
      (Math.abs(escClosed.rects[id].x - beforeEsc.rects[id].x) > 2 ||
       Math.abs(escClosed.rects[id].y - beforeEsc.rects[id].y) > 2))
    fail('U11', 'Esc 关闭后未回原位', { before: beforeEsc.rects[id], after: escClosed.rects[id] });

  // 用户 2026-10-27 16:18 硬性要求：9 张卡右上角的圆形 ✕ 关闭钮全部删除（DOM + 视觉都不保留）。
  // 逐卡：真实点击展开 → 断言全页 .gev-lc-close / aria=收起卡片 数量为 0、无可视圈叉 →
  //       关闭路径改验 Esc（保留「再点标题条 / Esc」，不再有按钮）。
  for (const id2 of CARDS) {
    await closeAll();
    const opened2 = await openCard(id2);
    if (!opened2.ok) {
      fail('U11', id2 + ' 展开失败，无法验证关闭路径', opened2);
      continue;
    }
    await sleep(400);
    const xAudit = await page.evaluate((ids) => {
      const sel = '.gev-lc-close, [aria-label="收起卡片"], [title="收起卡片（Esc）"]';
      const all = [...document.querySelectorAll(sel)];
      const visible = [];
      for (const b of all) {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const shown =
          cs.display !== 'none' &&
          cs.visibility !== 'hidden' &&
          parseFloat(cs.opacity || '1') > 0.05 &&
          r.width > 2 &&
          r.height > 2;
        if (shown)
          visible.push({
            cls: String(b.className || '').slice(0, 40),
            text: (b.textContent || '').trim().slice(0, 6),
            rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
            inCard: b.closest('.gev-lc') ? b.closest('.gev-lc').id : null,
          });
      }
      // 视觉兜底：所有卡内绝对定位、右上角、圆形、内容是 ✕/× 的可见元素也不能有
      const suspects = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const cr = el.getBoundingClientRect();
        for (const b of el.querySelectorAll('button,span,div,i')) {
          const cs = getComputedStyle(b);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = b.getBoundingClientRect();
          if (r.width < 8 || r.height < 8 || r.width > 40 || r.height > 40) continue;
          const txt = (b.textContent || '').trim();
          if (!/^[✕✖×xX]$/.test(txt)) continue;
          if (Math.abs(r.width - r.height) > 6) continue;
          if (parseFloat(cs.borderTopLeftRadius || '0') < r.width * 0.3) continue;
          if (!(r.left + r.width > cr.right - 60 && r.top < cr.top + 60)) continue;
          suspects.push({ id, text: txt, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
        }
      }
      return { domCount: all.length, visible, suspects };
    }, ALL_IDS);
    await page.keyboard.press('Escape');
    await sleep(800);
    const afterEsc2 = await snap();
    report.steps.push({
      kind: 'no-close-btn',
      card: id2,
      xAudit,
      after: afterEsc2.rects[id2],
      overlaps: afterEsc2.overlaps,
    });
    if (xAudit.domCount !== 0) fail('U11', id2 + ' 展开后页面仍存在 .gev-lc-close/收起卡片 DOM 元素', xAudit);
    if (xAudit.visible.length) fail('U11', id2 + ' 右上角仍有可见的 ✕ 关闭钮', xAudit.visible);
    if (xAudit.suspects.length) fail('U11', id2 + ' 卡内仍有右上角圆形 ✕ 视觉残留', xAudit.suspects);
    if (afterEsc2.rects[id2] && afterEsc2.rects[id2].floating) fail('U11', id2 + ' Esc 未关闭浮层（关闭路径失效）', afterEsc2.rects[id2]);
  }

  // Tab 焦点可见性
  await closeAll();
  const focusTrail = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    await sleep(80);
    focusTrail.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return null;
        const s = getComputedStyle(a);
        const r = a.getBoundingClientRect();
        return {
          t: a.tagName + (a.id ? '#' + a.id : ''),
          cls: String(a.className || '').slice(0, 40),
          outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor,
          boxShadow: s.boxShadow.slice(0, 40),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        };
      }),
    );
  }
  report.steps.push({ kind: 'tab-focus', trail: focusTrail });
  // U12 硬化：可见焦点从「只记录」改为硬断言
  const focusChecked = focusTrail.filter((f) => f && f.t && !/^BODY/.test(f.t));
  const noRing = focusChecked.filter((f) => {
    const w = parseFloat(String(f.outline).split(' ')[1]) || 0;
    const hasOutline = !/none/.test(f.outline) && w >= 1;
    const hasShadow = f.boxShadow && f.boxShadow !== 'none';
    return !hasOutline && !hasShadow;
  });
  report.steps.at(-1).focusAssert = {
    checked: focusChecked.length,
    noVisibleRing: noRing.length,
    minRequired: 8,
  };
  if (focusChecked.length < 8) fail('U11', 'Tab 焦点覆盖不足（<8 个可聚焦元素）', focusChecked.map((f) => f.t));
  if (noRing.length) fail('U11', 'Tab 焦点不可见（无 outline/box-shadow）', noRing.map((f) => f.t));
}

/* ── 6. U5 刷新后记忆 ───────────────────────────────────────────────── */
await closeAll();
{
  const id = 'cctv-panel';
  const hp = await headerPoint(id);
  if (hp) {
    await click(hp.x, hp.y, id);
    await sleep(800);
  }
  const beforeReload = await snap();
  report.ptrBeforeReload = await page.evaluate(() => window.__ptr);
  await page.evaluate(() => (window.name = 'keep')); // 让下一次 load 保留 localStorage
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
  await waitBooted('reload-memory');
  const afterReload = await snap();
  const halfOpen2 = Object.entries(afterReload.rects)
    .filter(([k, r]) => r && !r.collapsed && !r.floating && CARDS.includes(k))
    .map(([k]) => k);
  report.steps.push({
    kind: 'reload-memory',
    openedBefore: beforeReload.floating,
    floatingAfterReload: afterReload.floating,
    expandedAfterReload: Object.entries(afterReload.rects).filter(([, r]) => r && !r.collapsed).map(([k]) => k),
    halfOpenAfterReload: halfOpen2,
    overlaps: afterReload.overlaps,
  });
  if (!afterReload.floating.some((x) => CARDS.includes(x)))
    fail('U5', '刷新后没有任何主卡展开（记忆失效）', afterReload.floating);
  if (halfOpen2.length) fail('U5', '刷新后出现半开卡', halfOpen2);
  // B1 回归门：恢复上次卡 = 另一条自动展开路径，同样必须 0 overlap + 7/7 header 命中自己
  await assertLayout('reload-memory', afterReload);
  await shot('06-after-reload');
}

report.errors = errs;
const ptrAfterReload = await page.evaluate(() => window.__ptr || []);
report.ptr = (report.ptrBeforeReload || []).concat(ptrAfterReload);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log('\n=== RESULT ===');
console.log('initialFloating:', report.initialFloating);
console.log('initialHalfOpen:', report.initialHalfOpen);
console.log('failures:', report.failures.length);
for (const f of report.failures) console.log(' -', f.id, f.msg);
console.log('errors:', errs.length, errs.slice(0, 3));
console.log('report:', path.join(OUT, 'report.json'));
await browser.close();
function tstep(s) {
  return { aAfter: s.aAfterFloating, bAfter: s.bAfterFloating, pt: s.bPointWhileAOpen };
}
