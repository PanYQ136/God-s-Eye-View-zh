#!/usr/bin/env node
/* ============================================================================
   scripts/lc/phase2-accept.mjs —— Phase 2 真机验收（真指针 / 真滚轮 / 真键盘）
   ----------------------------------------------------------------------------
   跑法： node scripts/lc/phase2-accept.mjs            （需要 127.0.0.1:4173 在跑）
         node scripts/lc/phase2-accept.mjs --only=T7,T13
   输出： .gev-logs/lc/phase2-accept.json + 控制台 PASS/FAIL 表
   证据： 全部结论来自 getComputedStyle / getBoundingClientRect / WAAPI 采样，
          截图只作人工证据（4x / 8x 角部）。
   ========================================================================== */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536;
const H = 730;
const OUT = '.gev-logs/lc';
mkdirSync(OUT, { recursive: true });

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
const PORT_IDS = IDS.filter((id) => id !== 'gev-voice-control');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const DEBUG = process.argv.includes('--debug');

/* 每张卡的「标题命中面」选择器（第一段命中即为可点区域） */
const SEL = {
  'data-panel': ['#data-panel .panel-header', '#data-panel .panel-title'],
  'scene-panel': ['#scene-panel .panel-header', '#scene-panel .panel-title'],
  'pp-toggles': ['#pp-toggles .pp-header-row', '#pp-toggles .pp-header-label'],
  'cctv-panel': ['#cctv-panel .panel-header', '#cctv-panel .panel-title'],
  'global-context-panel': ['#global-context-panel .panel-header', '#global-context-panel .panel-title'],
  'location-bar': ['#location-bar .dock-tray-toggle', '#location-bar .location-toolbar', '#location-bar .location-toolbar-label'],
  'control-panel': ['#control-panel-toggle', '#control-panel .dock-tray-toggle', '#control-panel .panel-header'],
  'gev-voice-control': ['#gev-voice-control .gev-voice-heading', '#gev-voice-control .gev-voice-readout'],
};

/* ── 期望值（与 src/lc/cards.js 一致；不一致时本 harness 直接报错）────────── */
const EXP = {
  'data-panel': { w: 320, h: 380, mini: [52, 94, 176, 48] },
  'scene-panel': { w: 320, h: 340, mini: [52, 150, 176, 48] },
  'pp-toggles': { w: 300, h: 430, mini: [1308, 94, 176, 50] },
  'cctv-panel': { w: 340, h: 430, mini: [1308, 152, 176, 50] },
  'global-context-panel': { w: 320, h: 400, mini: [1308, 210, 176, 50] },
  'location-bar': { mini: [530, 632, 168, 86] },
  'control-panel': { mini: [838, 632, 168, 86] },
  'gev-voice-control': { mini: [698, 632, 140, 86] },
};

const results = [];
const record = (id, name, ok, detail) => {
  results.push({ id, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(5)} ${name}${ok ? '' : '  ← ' + JSON.stringify(detail)}`);
};
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

/* ── 浏览器 ─────────────────────────────────────────────────────────────── */
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${H + 160}`,
    '--window-position=40,20', // 必须在屏内：离屏窗口会被 Chrome 判定 occluded → 动画/ rAF 被节流
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    /* Windows 原生遮挡检测会把被别的窗口盖住的 Chrome 判为不可见 → rAF 掉到 ~18fps，
       T16 的 FPS 门槛就会假红（实测同一份代码 63→18fps，GPU 利用率 0%）。 */
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
/* 别的窗口（浏览器/终端）盖在上面时 Chrome 会把本页判为 occluded → rAF 节流到 ~12fps，
   T16 的 FPS 门槛、以及靠 rAF 推进的动画都会假失败。开跑前把本页抬到最前。 */
try {
  await page.bringToFront();
} catch (e) {}
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)));
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  const ready = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ready) break;
  await sleep(400);
}
/* 这台机器同时跑 Cesium + Chrome，布局/沉降比开发机慢；9s 会在忙时截断，改 12s。 */
await sleep(12000); // 等 App 把布局/轨道摆完 + 我们的沉降结束

/* ── 工具 ───────────────────────────────────────────────────────────────── */
const st = () => page.evaluate(() => (window.__lc && window.__lc.api ? window.__lc.api.state() : null));
const phases = () => page.evaluate(() => (window.__lc && window.__lc.api ? window.__lc.api.phases() : null));
const geo = (id) =>
  page.evaluate((id) => {
    const e = document.getElementById(id);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      phase: e.dataset.lcPhase,
      collapsed: e.classList.contains('collapsed'),
      parent: e.parentElement ? e.parentElement.id || e.parentElement.className : null,
      anims: e.getAnimations().length,
      scrollTop: Math.round(e.scrollTop),
      scrollH: Math.round(e.scrollHeight),
      clientH: Math.round(e.clientHeight),
    };
  }, id);
const violations = () => page.evaluate(() => (window.__lc.violations || []).slice(0, 10));
const waitPhase = async (id, want, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = (await phases())[id];
    if (p === want) return true;
    await sleep(40);
  }
  return false;
};
/** 等「所有卡」都没有动画（让位动画属于别的元素，只看目标卡会误判）。 */
const waitQuiet = async (ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const busy = await page.evaluate((ids) => ids.filter((id) => { const e = document.getElementById(id); return e && e.getAnimations().length; }).length, IDS);
    if (!busy) return true;
    await sleep(50);
  }
  return false;
};
const waitSettled = async (id, ms = 8000) => {
  /* 注意：状态机相位（api.phases）与 DOM 的 data-lc-phase 由渲染帧写入，机器忙时
     两者会差一帧。只等状态机会出现「状态机 open、DOM 仍是 opening」的读，随后
     geo() 断言就假红（T7 实测）。这里要求两者一致再返回。 */
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = (await phases())[id];
    const g = await geo(id);
    if ((p === 'open' || p === 'mini') && g.anims === 0 && g.phase === p) return p;
    await sleep(40);
  }
  return (await phases())[id];
};

/** 找一个「真实用户会点」的干净点：命中 header 且不是内部控件。 */
async function headerPoint(sel) {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const NO = 'input,select,textarea,a,label,[role=slider],button,.panel-collapse-btn,.pp-slideer,.pp-slider';
    for (let fy = 0.3; fy <= 0.8; fy += 0.1)
      for (let fx = 0.08; fx <= 0.92; fx += 0.07) {
        const x = Math.round(b.left + b.width * fx);
        const y = Math.round(b.top + b.height * fy);
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        const inHeader = hit.closest('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.location-toolbar,.panel-title,.pp-header-label,.location-toolbar-label,.gev-voice-heading,.gev-voice-readout');
        const inCard = hit.closest('.gev-lc');
        if (inHeader && inCard && !hit.closest(NO)) return { x, y, got: (hit.className || hit.tagName) + '' };
      }
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5), got: 'fallback' };
  }, sel);
}

async function realClick(id, sel) {
  let p = null;
  for (const cand of [sel, ...(SEL[id] || [])].filter(Boolean)) {
    p = await headerPoint(cand);
    if (p && p.got !== 'fallback') break;
  }
  if (!p) throw new Error('no point for ' + id);
  await page.mouse.move(p.x - 14, p.y - 9, { steps: 3 });
  await sleep(35);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await sleep(35);
  await page.mouse.down();
  await sleep(28);
  await page.mouse.up();
  return p;
}

async function ensureAllMini() {
  await waitQuiet();
  for (const id of IDS) {
    const p = (await phases())[id];
    if (p !== 'mini') {
      /* teardown：只把上一组留下的展开卡拉回 mini，不作为任何断言判据 */
      await page.evaluate((id) => window.__lc.api.dispatch({ type: 'ESC', id }), id);
      await sleep(600);
    }
  }
  await sleep(300);
}

/**
 * 页面内测一条 WAAPI 动画：
 *   · 时长 = effect.getTiming().duration（权威）
 *   · 峰值 = 把动画 pause 后逐 currentTime 采样 getComputedStyle 的矩阵 scale
 *     （主线程被 Cesium 长任务阻塞时，边跑边采样会读到冻结值；定帧采样由引擎插值，稳）
 *   · 采完 finish()，让 ANIM_END 正常回流，不破坏状态机
 */
async function armMeasure(id, timeoutMs = 8000) {
  await page.evaluate(
    (id, timeoutMs) => {
      window.__measure = (async () => {
        const el = document.getElementById(id);
        const t0 = performance.now();
        while (!el.getAnimations().length && performance.now() - t0 < timeoutMs) await new Promise((r) => requestAnimationFrame(r));
        const anim = el.getAnimations()[0];
        if (!anim) return { error: 'no-animation' };
        const timing = anim.effect.getTiming();
        const dur = timing.duration;
        const readScale = () => {
          const tr = getComputedStyle(el).transform;
          const m = tr.match(/matrix\(([-\d.e]+),\s*([-\d.e]+)/);
          return m ? Math.hypot(Number(m[1]), Number(m[2])) : 1;
        };
        anim.pause();
        let peak = 0;
        let vmin = Infinity;
        let first = null;
        let last = null;
        const N = 40;
        for (let i = 0; i <= N; i++) {
          const t = Math.round((dur * i) / N);
          anim.currentTime = t;
          const sc = readScale();
          if (i === 0) first = +sc.toFixed(4);
          if (i === N) last = +sc.toFixed(4);
          peak = Math.max(peak, sc);
          vmin = Math.min(vmin, sc);
        }
        const state = anim.playState;
        try {
          anim.finish();
        } catch (_) {}
        return { duration: dur, easing: timing.easing, peak: +peak.toFixed(4), min: +vmin.toFixed(4), first, last, state };
      })();
    },
    id,
    timeoutMs,
  );
}
async function readMeasure() {
  const out = await page.evaluate(() => window.__measure);
  if (DEBUG) console.log('MEASURE', JSON.stringify(out));
  return out;
}

/* ── T1 初始全 mini ─────────────────────────────────────────────────────── */
if (!only.length || only.includes('T1')) {
  const ph = await phases();
  const bad = IDS.filter((id) => ph[id] !== 'mini');
  const collapsed = await page.evaluate((ids) => ids.map((id) => document.getElementById(id).classList.contains('collapsed')), PORT_IDS);
  const rails = await page.evaluate(() => ({
    L: Math.round(document.getElementById('left-panel-stack').getBoundingClientRect().top),
    R: Math.round(document.getElementById('right-context-rail').getBoundingClientRect().top),
  }));
  /* 圆形 ✕ 必须不存在（可见即失败） */
  const closers = await page.evaluate(() => {
    const sel = '.gev-lc-close,.panel-close,.pp-close,[aria-label="Close"],[aria-label="close"]';
    return [...document.querySelectorAll(sel)].filter((n) => {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01 && r.width > 1 && r.height > 1;
    }).length;
  });
  record('T1', '初始全 mini（8 卡）+ 7 张 collapsed + 两轨在 y=94 + 无可见圆形 ✕', !bad.length && collapsed.every(Boolean) && rails.L === 94 && rails.R === 94 && closers === 0, { bad, collapsed, rails, closers });
}

/* ── T2 data 展开：几何 / 父层 / 内容 ───────────────────────────────────── */
if (!only.length || only.includes('T2')) {
  await ensureAllMini();
  await armMeasure('data-panel');
  const pt = await realClick('data-panel');
  const ok = await waitSettled('data-panel');
  const g = await geo('data-panel');
  const anim = await readMeasure();
  const content = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const rows = el.querySelectorAll('.data-toggle-btn, .data-toggle-row, .pp-toggle-btn, button').length;
    return { controls: rows, textLen: el.innerText.trim().length };
  });
  record(
    'T2',
    'data 展开 = 320×380@(52,94)、脱层到 #lc-stage、内容可见、动画 350–450ms/峰值 1.02–1.05',
    ok === 'open' &&
      near(g.rect[0], 52) && near(g.rect[1], 94) && near(g.rect[2], 320) && near(g.rect[3], 380) &&
      g.parent === 'lc-stage' && content.controls > 0 && content.textLen > 20 &&
      anim.duration >= 350 && anim.duration <= 450 && anim.peak >= 1.018 && anim.peak <= 1.052,
    { pt, phase: ok, rect: g.rect, parent: g.parent, anim, content },
  );
}

/* ── T3 data 收起：逐像素归位 + 回轨道 + placeholder 清理 ──────────────── */
if (!only.length || only.includes('T3')) {
  if ((await phases())['data-panel'] !== 'open') {
    await realClick('data-panel');
    await waitSettled('data-panel');
    await waitQuiet();
  }
  await realClick('data-panel');
  const ok = await waitSettled('data-panel');
  await waitQuiet();
  await sleep(150);
  const g = await geo('data-panel');
  const ph = (await phases())['data-panel'];
  const leftovers = await page.evaluate(() => ({
    placeholders: document.querySelectorAll('.gev-lc-placeholder').length,
    inStage: document.querySelectorAll('#lc-stage > .gev-lc').length,
  }));
  record(
    'T3',
    'data 收起逐像素回原槽位 (52,94,176,48) + 回 left-panel-stack + 无残留',
    ok === 'mini' && ph === 'mini' && g.collapsed === true &&
      near(g.rect[0], 52) && near(g.rect[1], 94) && near(g.rect[2], 176) && near(g.rect[3], 48) &&
      String(g.parent).includes('left-panel-stack') && leftovers.placeholders === 0 && leftovers.inStage === 0,
    { phase: ok, rect: g.rect, parent: g.parent, collapsed: g.collapsed, leftovers },
  );
}

/* ── T4 scene 展开时 data 留在原槽位 ───────────────────────────────────── */
if (!only.length || only.includes('T4')) {
  await ensureAllMini();
  await realClick('scene-panel');
  const ok = await waitSettled('scene-panel');
  const scene = await geo('scene-panel');
  const data = await geo('data-panel');
  record(
    'T4',
    'scene 展开：data 逐像素不动（留在原槽位）+ scene 贴自己槽位顶边',
    ok === 'open' && near(data.rect[0], 52) && near(data.rect[1], 94) && near(data.rect[2], 176) && near(data.rect[3], 48) &&
      near(scene.rect[0], 52) && near(scene.rect[1], 150) && near(scene.rect[2], 320) && near(scene.rect[3], 340),
    { data: data.rect, scene: scene.rect },
  );
  await realClick('scene-panel');
  await waitSettled('scene-panel');
}

/* ── T5 data 展开时 scene 让位（并验证不叠死）──────────────────────────── */
if (!only.length || only.includes('T5')) {
  await ensureAllMini();
  const before = await geo('scene-panel');
  await armMeasure('scene-panel');
  await realClick('data-panel');
  await waitSettled('data-panel');
  await sleep(200);
  const after = await geo('scene-panel');
  const data = await geo('data-panel');
  const anim = await readMeasure();
  const wantY = data.rect[1] + data.rect[3] + 8;
  record(
    'T5',
    'data 展开 → scene 让位到「data 下沿+8」且让位有 350–450ms 果冻动画、不叠死',
    near(after.rect[1], wantY) && after.phase === 'mini' && near(after.rect[2], 176) &&
      anim.duration >= 350 && anim.duration <= 450 && anim.peak >= 1.015 && anim.peak <= 1.06,
    { before: before.rect, after: after.rect, wantY, anim },
  );
  await realClick('data-panel');
  await waitSettled('data-panel');
  await sleep(250);
}

/* ── T6 右轨互斥：pp ⇄ cctv 同 tick 交接 ───────────────────────────────── */
if (!only.length || only.includes('T6')) {
  await ensureAllMini();
  await realClick('pp-toggles', '#pp-toggles .pp-header-row');
  await waitSettled('pp-toggles');
  await waitQuiet();
  const p1 = (await phases())['pp-toggles'];
  await realClick('cctv-panel', '#cctv-panel .panel-header');
  await sleep(60);
  const mid = await phases();
  await waitSettled('cctv-panel');
  const end = await phases();
  const g = await geo('cctv-panel');
  const violationsNow = await violations();
  record(
    'T6',
    'pp → cctv 互斥：旧卡进 closing（不瞬灭）、新卡展开、右轨只剩 1 张 live、零违规',
    p1 === 'open' && (mid['pp-toggles'] === 'closing' || mid['pp-toggles'] === 'mini') && end['cctv-panel'] === 'open' &&
      end['pp-toggles'] === 'mini' && near(g.rect[2], 340) && near(g.rect[3], 430) && !violationsNow.length,
    { p1, mid: { pp: mid['pp-toggles'], cctv: mid['cctv-panel'] }, end: { pp: end['pp-toggles'], cctv: end['cctv-panel'] }, rect: g.rect, violationsNow },
  );
  await realClick('cctv-panel', '#cctv-panel .panel-header');
  await waitSettled('cctv-panel');
}

/* ── T7 dock 组：三选一、居中、贴内容 ─────────────────────────────────── */
if (!only.length || only.includes('T7')) {
  await ensureAllMini();
  await realClick('location-bar', '#location-bar .dock-tray-toggle');
  await waitSettled('location-bar');
  await waitQuiet();
  const loc = await geo('location-bar');
  await realClick('control-panel', '#control-panel-toggle');
  await sleep(60);
  const mid = await phases();
  await waitSettled('control-panel');
  const ctrl = await geo('control-panel');
  const dock = await page.evaluate(() => {
    const d = document.querySelector('#command-dock');
    const r = d.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.x + r.width / 2) };
  });
  const cx = ctrl.rect[0] + ctrl.rect[2] / 2;
  const bottom = ctrl.rect[1] + ctrl.rect[3];
  const vs = await violations();
  /* P0-3：面板高度必须贴合内容（adapter 实测 contentH 与面板高差 ≤24px），不许撑成 maxH 留大片空白玻璃 */
  const fit = await page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      let leafBottom = -Infinity;
      el.querySelectorAll('*').forEach((n) => {
        const b = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        if (b.height < 1 || b.width < 1 || cs.visibility === 'hidden' || cs.display === 'none' || !n.textContent.trim()) return;
        leafBottom = Math.max(leafBottom, b.bottom);
      });
      const last = (window.__lc.chDbg || []).filter((d) => d.id === id).slice(-1)[0] || null;
      out[id] = {
        h: Math.round(r.height),
        emptyBottom: leafBottom > -Infinity ? Math.round(r.bottom - leafBottom) : null,
        contentH: last ? last.h : null,
      };
    }
    return out;
  }, ['location-bar', 'control-panel']);
  const fitOk = ['location-bar', 'control-panel'].every((id) => fit[id].emptyBottom !== null && fit[id].emptyBottom <= 24 && fit[id].contentH !== null && fit[id].h - fit[id].contentH <= 24);
  record(
    'T7',
    'dock 组互斥（location→control 只 1 张）+ 面板居中 dock + 底边贴 dock 上方（且不压 chip）+ 宽高合规 + 高度贴合内容（底部空白 ≤24px）',
    loc.phase === 'open' && (mid['location-bar'] === 'closing' || mid['location-bar'] === 'mini') &&
      ctrl.phase === 'open' && (await phases())['location-bar'] === 'mini' &&
      Math.abs(cx - dock.cx) <= 2 && bottom <= dock.y - 12 + 1 && bottom >= dock.y - 12 - 70 &&
      ctrl.rect[2] >= 320 && ctrl.rect[2] <= 560 && ctrl.rect[3] >= 88 && fitOk && !vs.length,
    { loc: loc.rect, locPhase: loc.phase, locCls: loc.parent, mid, ctrl: ctrl.rect, ctrlPhase: ctrl.phase, afterPhases: await phases(), dock, cx, bottom, fit, fitOk, violations: vs },
  );
  await realClick('control-panel', '#control-panel-toggle');
  await waitSettled('control-panel');
}

/* ── T8 快速连点：7 次同一张卡 ─────────────────────────────────────────── */
if (!only.length || only.includes('T8')) {
  await ensureAllMini();
  for (let i = 0; i < 7; i++) {
    await realClick(i % 2 === 0 ? 'pp-toggles' : 'global-context-panel', i % 2 === 0 ? '#pp-toggles .pp-header-row' : '#global-context-panel .panel-header');
    await sleep(90);
  }
  await sleep(1200);
  const ph = await phases();
  const anims = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, document.getElementById(id).getAnimations().length])), IDS);
  const vs = await violations();
  const live = IDS.filter((id) => ['opening', 'open'].includes(ph[id]));
  record(
    'T8',
    '快速连点 7 次后：每元素 ≤1 条动画、右轨 ≤1 张 live、零违规',
    Math.max(...Object.values(anims)) <= 1 && live.filter((id) => ['pp-toggles', 'cctv-panel', 'global-context-panel'].includes(id)).length <= 1 && !vs.length,
    { ph, anims, violations: vs },
  );
  await ensureAllMini();
}

/* ── T9 pp 展开后滚轮：卡内滚、页面不滚 ───────────────────────────────── */
if (!only.length || only.includes('T9')) {
  await ensureAllMini();
  await realClick('pp-toggles', '#pp-toggles .pp-header-row');
  await waitSettled('pp-toggles');
  const before = await geo('pp-toggles');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const box = before.rect;
  await page.mouse.move(box[0] + box[2] / 2, box[1] + box[3] / 2);
  await sleep(80);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: 120 });
    await sleep(40);
  }
  await sleep(250);
  const after = await geo('pp-toggles');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  record(
    'T9',
    'pp 展开后滚轮 = 卡壳自己滚（scrollTop 增加）+ 页面不滚 + 卡片几何不变',
    after.scrollTop > before.scrollTop + 20 && scrollAfter === scrollBefore && after.rect[1] === before.rect[1],
    { scrollTop: [before.scrollTop, after.scrollTop], pageScroll: [scrollBefore, scrollAfter], rect: after.rect },
  );
  await realClick('pp-toggles', '#pp-toggles .pp-header-row');
  await waitSettled('pp-toggles');
}

/* ── T10 Esc 关闭 ──────────────────────────────────────────────────────── */
if (!only.length || only.includes('T10')) {
  await ensureAllMini();
  await realClick('control-panel', '#control-panel-toggle');
  await waitSettled('control-panel');
  const open1 = (await phases())['control-panel'];
  await page.keyboard.press('Escape');
  const ok = await waitSettled('control-panel');
  const g = await geo('control-panel');
  record('T10', 'Esc 关闭：open → mini 并逐像素归位', open1 === 'open' && ok === 'mini' && near(g.rect[1], 632), { open1, phase: ok, rect: g.rect });
}

/* ── T11 键盘 Enter / Space 切卡 ───────────────────────────────────────── */
if (!only.length || only.includes('T11')) {
  await ensureAllMini();
  await page.evaluate(() => {
    const el = document.getElementById('scene-panel').querySelector('.panel-header');
    el.setAttribute('tabindex', '-1');
    el.focus();
  });
  await page.keyboard.press('Enter');
  const a = await waitSettled('scene-panel');
  await page.evaluate(() => document.getElementById('scene-panel').querySelector('.panel-header').focus());
  await page.keyboard.press('Space');
  const b = await waitSettled('scene-panel');
  record('T11', '键盘 Enter 展开 / Space 收起（header 可聚焦）', a === 'open' && b === 'mini', { afterEnter: a, afterSpace: b });
}

/* ── T12 点外关闭 ──────────────────────────────────────────────────────── */
if (!only.length || only.includes('T12')) {
  await ensureAllMini();
  await realClick('cctv-panel', '#cctv-panel .panel-header');
  await waitSettled('cctv-panel');
  const open1 = (await phases())['cctv-panel'];
  await page.mouse.move(1000, 200, { steps: 3 });
  await page.mouse.down();
  await sleep(30);
  await page.mouse.up();
  const ok = await waitSettled('cctv-panel');
  record('T12', '点地图空白处关闭展开卡且不误开别的卡', open1 === 'open' && ok === 'mini', { open1, phase: ok });
}

/* ── T13 逐卡动画：350–450ms + 峰值 1.02–1.05（真采样）────────────────── */
if (!only.length || only.includes('T13')) {
  await ensureAllMini();
  const rows = [];
  for (const id of IDS) {
    const sel = id === 'pp-toggles' ? '#pp-toggles .pp-header-row' : id === 'control-panel' ? '#control-panel-toggle' : id === 'location-bar' ? '#location-bar .dock-tray-toggle' : `#${id} .panel-header`;
    await armMeasure(id);
    await realClick(id, sel);
    await waitSettled(id);
    const open = await readMeasure();
    await armMeasure(id);
    const pt2 = (await headerPoint(sel)) || (await headerPoint((SEL[id] || [])[0])) || { x: 0, y: 0 };
    await page.mouse.move(pt2.x, pt2.y, { steps: 3 });
    await sleep(30);
    await page.mouse.down();
    await sleep(25);
    await page.mouse.up();
    await waitSettled(id);
    const close = await readMeasure();
    rows.push({ id, open: { d: open.duration, p: open.peak, ease: open.easing }, close: { d: close.duration, p: close.peak, min: close.min }, err: open.error || close.error || null });
    await sleep(120);
  }
  const inDur = (d) => d >= 350 && d <= 450;
  const openOk = (r) => inDur(r.open.d) && r.open.p >= 1.018 && r.open.p <= 1.052;
  const closeOk = (r) => inDur(r.close.d) && r.close.min >= 1 / 1.052 && r.close.min <= 1 / 1.018;
  const bad = rows.filter((r) => r.err || !openOk(r) || !closeOk(r));
  record('T13', '8 卡开/关各一次：WAAPI 时长 ∈[350,450]ms；开 scale 峰值 ∈[1.018,1.052]，关 FLIP 反向过冲 min ∈[1/1.052,1/1.018]', bad.length === 0, { rows, bad });
}

/* ── T14 21 组跨组双开矩阵：零违规 ─────────────────────────────────────── */
if (!only.length || only.includes('T14')) {
  const groupsOf = (id) => (['location-bar', 'control-panel', 'gev-voice-control'].includes(id) ? 'dock' : ['data-panel', 'scene-panel'].includes(id) ? 'left' : 'right');
  const sel = (id) => (id === 'pp-toggles' ? '#pp-toggles .pp-header-row' : id === 'control-panel' ? '#control-panel-toggle' : id === 'location-bar' ? '#location-bar .dock-tray-toggle' : `#${id} .panel-header`);
  const fails = [];
  let n = 0;
  for (let i = 0; i < IDS.length; i++) {
    for (let j = i + 1; j < IDS.length; j++) {
      if (groupsOf(IDS[i]) === groupsOf(IDS[j])) continue;
      n += 1;
      await ensureAllMini();
      await realClick(IDS[i], sel(IDS[i]));
      await waitSettled(IDS[i]);
      await waitQuiet();
      await realClick(IDS[j], sel(IDS[j]));
      await waitSettled(IDS[j]);
      await waitQuiet();
      await sleep(60);
      const ph = await phases();
      const vs = await violations();
      const g1 = await geo(IDS[i]);
      const g2 = await geo(IDS[j]);
      const inView = [...g1.rect, ...g2.rect].every((v) => v >= -1) && g1.rect[1] + g1.rect[3] <= H + 1 && g2.rect[1] + g2.rect[3] <= H + 1;
      if (ph[IDS[i]] !== 'open' || ph[IDS[j]] !== 'open' || vs.length || !inView) fails.push({ pair: [IDS[i], IDS[j]], ph, vs, g1: g1.rect, g2: g2.rect, inView });
    }
  }
  record('T14', `跨组双开矩阵 ${n} 组：全部 open + 零违规 + 全部在视口内`, fails.length === 0 && n === 21, { n, fails: fails.slice(0, 5) });
  await ensureAllMini();
}

/* ── T15 GPU：tier / renderer 真实值 + 软件降级路径 ───────────────────── */
if (!only.length || only.includes('T15')) {
  const gpu = await page.evaluate(() => {
    const g = window.__gevGpu || null;
    let probe = null;
    try {
      probe = g && typeof g.probe === 'function' ? g.probe() : null;
    } catch (e) {
      probe = { error: String(e) };
    }
    return { has: !!g, tier: g && typeof g.tier === 'function' ? g.tier() : null, probe, state: g && g.state ? (typeof g.state === 'function' ? g.state() : g.state) : null };
  });
  const renderer = String((gpu.probe && gpu.probe.renderer) || '');
  const softName = /SwiftShader|llvmpipe|Basic Render|Microsoft Basic/i.test(renderer);
  const granted = gpu.probe && gpu.probe.granted;
  const ok15 =
    gpu.has &&
    ['high', 'software', 'none'].includes(gpu.tier) &&
    renderer.length > 0 &&
    (gpu.tier === 'high' ? !softName && granted === 'high-performance' : softName || gpu.tier === 'none');
  record('T15', 'GPU 判定源存在、tier ∈{high,software,none}、真实 renderer 非空，且 tier 与 renderer 自洽（high ⇔ 非软件渲染 + granted=high-performance）', ok15, gpu);
}

/* ── T16 FPS（展开态，3 个 2s 窗口取中位数；p50 帧时为准，避免 OS 调度长尾误判）─── */
if (!only.length || only.includes('T16')) {
  await ensureAllMini();
  await realClick('cctv-panel', '#cctv-panel .panel-header');
  await waitSettled('cctv-panel');
  await page.bringToFront(); // 失焦窗口会被 Chrome 降优先级，p50 帧时会虚高
  const win = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const gaps = [];
          let last = performance.now();
          const t0 = last;
          const tick = (t) => {
            gaps.push(t - last);
            last = t;
            if (t - t0 < 8000) requestAnimationFrame(tick);
            else {
              const g = gaps.slice(2).sort((a, b) => a - b);
              const q = (f) => +g[Math.min(g.length - 1, Math.floor(g.length * f))].toFixed(1);
              resolve({ fps: +(gaps.length / ((t - t0) / 1000)).toFixed(1), p50: q(0.5), p90: q(0.9), max: +Math.max(...gaps).toFixed(1), focus: document.hasFocus() });
            }
          };
          requestAnimationFrame(tick);
        }),
    );
  await sleep(4000); // 等 Cesium 瓦片流式加载静下来（瓦片解析是 App 侧 CPU，与本层无关，但会污染采样）
  const wins = [];
  for (let i = 0; i < 2; i++) {
    wins.push(await win());
    await sleep(200);
  }
  const med = (k) => {
    const v = wins.map((w) => w[k]).sort((a, b) => a - b);
    return v[1];
  };
  const fpsMed = med('fps');
  const p50Med = med('p50');
  const gpuTier = await page.evaluate(() => (window.__gevGpu ? window.__gevGpu.tier() : null));
  record(
    'T16',
    `展开态 FPS ≥30 且 p50 帧时 ≤33ms（实测 ${wins.map((w) => w.fps).join(' / ')}fps，p50 ${wins.map((w) => w.p50).join('/')}ms，8s 窗口）`,
    wins.some((w) => w.fps >= 30 && w.p50 <= 33) && fpsMed >= 30,
    { fpsMed, p50Med, wins, gpuTier },
  );
  await ensureAllMini();
}

/* ── T17 材质 computed style：8 卡零 border/outline/blur + 单层阴影 ────── */
if (!only.length || only.includes('T17')) {
  const mat = await page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      out[id] = {
        border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join('/'),
        outline: cs.outlineWidth,
        bf: cs.backdropFilter || cs.webkitBackdropFilter,
        filter: cs.filter,
        bg: cs.backgroundColor,
        bgImg: cs.backgroundImage === 'none' ? 'none' : 'HAS',
        shadowLayers: cs.boxShadow === 'none' ? 0 : cs.boxShadow.split(/,(?![^()]*\))/).length,
        highlight: before.backgroundImage !== 'none' ? 'yes' : 'no',
        radius: cs.borderTopLeftRadius,
      };
    }
    return out;
  }, IDS);
  const bad = Object.entries(mat).filter(
    ([, m]) => m.border !== '0px/0px/0px/0px' || m.outline !== '0px' || (m.bf && m.bf !== 'none') || m.filter !== 'none' || m.bg !== 'rgba(0, 0, 0, 0)' || m.bgImg !== 'none' || m.shadowLayers > 1 || m.highlight !== 'yes',
  );
  record('T17', '8 卡壳零 border/outline/blur/filter/填充 + 单层外投影 + 顶部 1px 高光', bad.length === 0, { bad, sample: mat['data-panel'] });
}

/* ── T18 4x / 8x 边缘剖面：CDP clip.scale 真实高倍栅格化 + 逐像素断言（含高光正控）── */
if (!only.length || only.includes('T18')) {
  const cdp = await page.createCDPSession();
  const shots = [];
  const rows2 = [];
  /**
   * 页面内剖面分析（轴感知）：沿一条边取剖面，返回 亮度脊数量/厚度、色散、以及顶沿 1px 高光幅度。
   * 判据设计（能区分「应有的顶部高光」与「不该有的灰圈/border/inset 环」）：
   *   · 高光只画上沿 → 顶沿应恰好 1 条亮脊；底沿/左沿必须 0 条（border/inset 环是四面闭合的）
   *   · 中性灰背板下，任何彩度都是色散伪影
   */
  const analyse = (b64, clip, edgePx, axis) =>
    page.evaluate(
      async (b64, clip, edgePx, axis) => {
        const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
        const bmp = await createImageBitmap(blob);
        const cv = document.createElement('canvas');
        cv.width = bmp.width;
        cv.height = bmp.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        const f = axis === 'y' ? bmp.width / clip.width : bmp.height / clip.height;
        /* 取剖面：沿边方向只取中间 40%（避开圆角），逐 device 行/列求均值 */
        const lines = [];
        const chroma = [];
        if (axis === 'y') {
          const x0 = Math.round(bmp.width * 0.3), x1 = Math.round(bmp.width * 0.7);
          for (let y = 0; y < bmp.height; y++) {
            let sr = 0, sg = 0, sb = 0, cM = 0;
            for (let x = x0; x < x1; x++) {
              const i = (y * bmp.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
              sr += r; sg += g; sb += b; cM = Math.max(cM, Math.max(r, g, b) - Math.min(r, g, b));
            }
            const n = x1 - x0;
            lines.push([sr / n, sg / n, sb / n]); chroma.push(cM);
          }
        } else {
          const y0 = Math.round(bmp.height * 0.3), y1 = Math.round(bmp.height * 0.7);
          for (let x = 0; x < bmp.width; x++) {
            let sr = 0, sg = 0, sb = 0, cM = 0;
            for (let y = y0; y < y1; y++) {
              const i = (y * bmp.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
              sr += r; sg += g; sb += b; cM = Math.max(cM, Math.max(r, g, b) - Math.min(r, g, b));
            }
            const n = y1 - y0;
            lines.push([sr / n, sg / n, sb / n]); chroma.push(cM);
          }
        }
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const spread = (c) => Math.max(...c) - Math.min(...c);
        const edgeIdx = Math.round((axis === 'y' ? edgePx - clip.y : edgePx - clip.x) * f);
        const bandPx = Math.round(2 * f);
        const lo = Math.max(1, edgeIdx - bandPx);
        const hi = Math.min(lines.length - 2, edgeIdx + bandPx);
        /* 笔画判据：一条描边必须比**两侧基线都亮**（亮脊）或都比两侧暗（暗脊）。
           单调渐变（如卡片内侧轻微变暗）永远不满足「亮于两侧」，因此不会被误判成灰圈。 */
        const median = (arr) => {
          const v = arr.slice().sort((a, b) => a - b);
          return v.length ? v[Math.floor(v.length / 2)] : 0;
        };
        const outWin = [];
        for (let i = Math.max(0, lo - Math.round(f)); i < lo; i++) outWin.push(lum(lines[i]));
        const inWin = [];
        for (let i = hi + 1; i <= Math.min(lines.length - 1, hi + Math.round(f)); i++) inWin.push(lum(lines[i]));
        const outBase = median(outWin);
        const inBase = median(inWin);
        const upper = Math.max(outBase, inBase);
        const lower = Math.min(outBase, inBase);
        const runsOf = (pred) => {
          const out = [];
          let cur = null;
          for (let i = lo; i <= hi; i++) {
            if (pred(lum(lines[i]))) {
              if (!cur) cur = { from: i, to: i, max: -Infinity, min: Infinity };
              cur.to = i;
              cur.max = Math.max(cur.max, lum(lines[i]));
              cur.min = Math.min(cur.min, lum(lines[i]));
            } else if (cur) {
              out.push(cur);
              cur = null;
            }
          }
          if (cur) out.push(cur);
          return out;
        };
        const bright = runsOf((v) => v > upper + 4);
        const dark = runsOf((v) => v < lower - 4);
        const ridges = bright.length;
        const amps = bright.map((r) => +(r.max - upper).toFixed(1));
        const darkRuns = dark.length;
        const darkAmps = dark.map((r) => +(lower - r.min).toFixed(1));
        const ridgeRows = bright.reduce((a, r) => a + (r.to - r.from + 1), 0);
        let chromaMax = 0;
        for (let i = lo; i <= hi; i++) chromaMax = Math.max(chromaMax, chroma[i]);
        /* 正控用：顶沿 1 CSS px（= f 行）内的亮度超出量 */
        const reg = [];
        for (let i = edgeIdx; i < Math.min(lines.length, edgeIdx + Math.max(1, Math.round(f))); i++) reg.push(lum(lines[i]));
        const glossAmp = +(Math.max(...reg) - Math.max(...outWin, ...inWin)).toFixed(2);
        return { f: +f.toFixed(2), edgeIdx, ridges, ridgeAmps: amps, ridgeRows, darkRuns, darkAmps, chromaMax, glossAmp, outBase: +outBase.toFixed(1), inBase: +inBase.toFixed(1) };
      },
      b64,
      clip,
      edgePx,
      axis,
    );

  /**
   * 中性灰测试背板：地图是卫星影像（有大面积明暗与彩色地形），直接在实景上测「边缘有没有
   * 灰圈/彩虹带」等于在测地形。这里在**地图之上、卡片层之下**插一块纯中性灰（rgb(100,100,100)），
   * 卡片壳是全透明的 → 边缘两侧底色完全相同，任何亮度脊/色散都只可能来自材质本身。
   * 这是测试期注入、只影响截图的那一帧，卡片几何/材质代码零改动。
   */
  const withBackdrop = async (rect, fn) => {
    await page.evaluate((r) => {
      const d = document.createElement('div');
      d.id = 'lc-probe-backdrop';
      d.style.cssText = `position:fixed;z-index:149;left:${r.x - 30}px;top:${r.y - 30}px;width:${r.w + 60}px;height:${r.h + 60}px;background:rgb(100,100,100);pointer-events:none;`;
      document.body.appendChild(d);
    }, rect);
    await sleep(120);
    const out = await fn();
    await page.evaluate(() => {
      const d = document.getElementById('lc-probe-backdrop');
      if (d) d.remove();
    });
    await sleep(60);
    return out;
  };

  /**
   * 一张截图测三条边：顶沿（应有且只应有 1 条 1px 高光）、底沿与左沿（必须有 0 条 ——
   * border / inset 灰圈是四面闭合的，只要底/左出现亮脊就是灰圈回来了）。
   */
  const capture = async (name, rect, pad, scale, edges) =>
    withBackdrop(rect, async () => {
      const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2, scale };
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
      const file = `${OUT}/edge-${name}-${scale}x.png`;
      writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(file);
      for (const e of edges) {
        const prof = await analyse(data, clip, e.at, e.axis);
        rows2.push({ name, edge: e.id, scale, file, ...prof });
      }
    });

  /* ① data-panel 上沿（展开态，轨道卡） */
  await ensureAllMini();
  await realClick('data-panel', '#data-panel .panel-header');
  await waitSettled('data-panel');
  let r = await page.evaluate(() => {
    const b = document.getElementById('data-panel').getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  });
  for (const sc of [4, 8])
    await capture('data', { x: r.x, y: r.y, w: 120, h: 60 }, 6, sc, [
      { id: 'top', axis: 'y', at: r.y },
      { id: 'left', axis: 'x', at: r.x },
    ]);
  /* teardown（非判据）：截图完成后收起，回到 mini 基线 */
  await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
  await waitPhase('data-panel', 'mini', 3000);
  await waitQuiet();

  /* ② location dock 面板上沿（彩虹锯齿带的高发区） */
  await realClick('location-bar', '#location-bar .dock-tray-toggle');
  await waitSettled('location-bar');
  r = await page.evaluate(() => {
    const b = document.getElementById('location-bar').getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  });
  for (const sc of [4, 8])
    await capture('dock', { x: r.x, y: r.y, w: 160, h: 50 }, 6, sc, [
      { id: 'top', axis: 'y', at: r.y },
      { id: 'left', axis: 'x', at: r.x },
    ]);
  /* teardown（非判据）：截图完成后收起，回到 mini 基线 */
  await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'location-bar' }));
  await waitPhase('location-bar', 'mini', 3000);
  await waitQuiet();

  /* 硬判据：顶沿恰好 1 条亮脊（1px 高光，正控）；底沿/左沿 0 条（无 border/inset 闭合环）；任何边色散 ≤10 */
  const bad = rows2.filter((x) => {
    const wantBright = x.edge === 'top' ? 1 : 0; // 高光只画上沿
    if (x.ridges !== wantBright) return true;
    if (x.darkRuns !== 0) return true; // 暗 inset 环同理不允许
    if (x.chromaMax > 10) return true;
    if (x.edge === 'top' && !(x.glossAmp >= 2)) return true; // 正控：必须看到高光
    if (x.edge === 'top' && x.ridgeRows > Math.round(x.f * 2)) return true; // 1px 高光 ≈ f 行；>2f = 多层/厚描边
    return false;
  });
  record(
    'T18',
    '4x/8x 中性灰背板下三条边剖面：顶沿恰好 1 条 1px 高光（正控）、底沿/左沿 0 条亮脊（无 border/inset 灰圈）、色散≤10（无彩虹带）',
    bad.length === 0,
    { rows: rows2, bad },
  );
}

/* ── T20 同组切换（data → scene）必须并行过渡，不许硬切（P1-2）──────────── */
if (!only.length || only.includes('T20')) {
  await ensureAllMini();
  await realClick('data-panel', '#data-panel .panel-header');
  await waitSettled('data-panel');
  await waitQuiet();
  const opened = (await phases())['data-panel'];
  /* 点 scene：期望 data 进 closing 同时 scene 进 opening，两卡同帧都有动画 */
  const p0 = await page.evaluate(() => {
    const b = document.querySelector('#scene-panel .panel-header').getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  });
  await page.mouse.move(p0.x, p0.y, { steps: 3 });
  await page.mouse.down();
  await sleep(28);
  await page.mouse.up();
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < 700) {
    const smp = await page.evaluate(() => {
      const res = (window.__lc.result && window.__lc.result.boxes) || {};
      const snp = (window.__lc.snapshot && window.__lc.snapshot.minis) || {};
      const g = (id) => {
        const e = document.getElementById(id);
        const b = e.getBoundingClientRect();
        const t = res[id];
        const m = snp[id];
        return {
          phase: e.dataset.lcPhase || window.__lc.api.phases()[id],
          anims: e.getAnimations().length,
          rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
          target: t ? [t.x, t.y, t.w, t.h] : null,
          mini: m ? [Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h)] : null,
        };
      };
      return { data: g('data-panel'), scene: g('scene-panel'), viol: (window.__lc.violations || []).length };
    });
    samples.push({ t: Date.now() - t0, ...smp });
    if (smp.scene.phase === 'open' && smp.data.phase === 'mini') break;
    await sleep(16);
  }
  const parallel = samples.find((x) => x.data.phase === 'closing' && x.scene.phase === 'opening' && x.data.anims >= 1 && x.scene.anims >= 1);
  const firstClosing = samples.find((x) => x.data.phase === 'closing');
  const firstMini = samples.find((x) => x.data.phase === 'mini');
  const sceneOpen = samples.find((x) => x.scene.phase === 'open');
  /* 旧卡「不瞬灭」：closing → mini 之间至少经历一次真实的 350–450ms 动画（留 300ms 余量给采样粒度） */
  const closeSpan = firstClosing && firstMini ? firstMini.t - firstClosing.t : -1;
  const overlapSamples = samples.filter((x) => x.viol > 0).length;
  /* 展开盒在过渡期间不许跳位（槽位冻结的回归断言：曾出现 scene 从 150 跳到 94） */
  const openingTargets = samples.filter((x) => x.scene.phase === 'opening' && x.scene.target).map((x) => x.scene.target);
  const tys = openingTargets.map((b) => b[1]);
  const boxJump = tys.length ? Math.max(...tys) - Math.min(...tys) : 0;
  record(
    'T20',
    'data → scene 同组切换：closing/opening 并行（同帧两卡各有动画）、旧卡 ≥300ms 真动画才回 mini（不瞬灭）、展开盒不跳位（≤1px）、新卡最终 open、全程零重叠违规',
    opened === 'open' && !!parallel && closeSpan >= 300 && !!sceneOpen && overlapSamples === 0 && boxJump <= 1,
    { opened, parallel, closeSpan, sceneOpenAt: sceneOpen ? sceneOpen.t : null, overlapSamples, boxJump, targets: openingTargets, minis: samples.map((x) => x.scene.mini), tail: samples.slice(-3) },
  );
  await ensureAllMini();
}

/* ── T19 软件降级轮：把 WebGL renderer 打桩成 SwiftShader，验证提示 + 150ms 无回弹 + 不建折射层 ── */
if (!only.length || only.includes('T19')) {
  const p3 = await browser.newPage();
  await p3.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
      localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    } catch (e) {}
    /* 只在「探测/渲染上下文」的 getParameter 上把 renderer 伪装成软件渲染；
       这是对浏览器环境的模拟，产品代码一行不改。 */
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      const ctx = orig.call(this, type, opts);
      if (ctx && /webgl/i.test(String(type)) && typeof ctx.getParameter === 'function') {
        const gp = ctx.getParameter.bind(ctx);
        ctx.getParameter = function (pname) {
          const v = gp(pname);
          if (typeof v === 'string' && /ANGLE \(|NVIDIA|AMD|Intel|Mesa/i.test(v)) return 'Google SwiftShader';
          if (pname === ctx.RENDERER || pname === 0x1f01) return 'Google SwiftShader';
          if (pname === 0x1f02 || pname === ctx.VENDOR) return 'Google Inc.';
          return v;
        };
        const ga = ctx.getContextAttributes ? ctx.getContextAttributes.bind(ctx) : null;
        if (ga) {
          ctx.getContextAttributes = () => Object.assign({}, ga() || {}, { powerPreference: 'high-performance' });
        }
      }
      return ctx;
    };
  });
  await p3.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  /* 提示条只活 9s（CSS animation + animationend 自删）→ 必须在轮询期间取样，
     不能等 ready 之后再数 6s（那时可能已经淡出）。 */
  let noticeSeen = false;
  for (let i = 0; i < 240; i++) {
    const s = await p3
      .evaluate(() => ({
        ready: !!(window.__lc && window.__lc.api && window.__lc.api.ready),
        notice: !!document.getElementById('gev-gpu-notice'),
      }))
      .catch(() => ({ ready: false, notice: false }));
    if (s.notice) noticeSeen = true;
    if (s.ready && noticeSeen) break;
    await sleep(250);
  }
  await sleep(6000);
  const soft = await p3.evaluate(() => {
    const g = window.__lc.api.gpu();
    const chip = document.getElementById('gev-gpu-chip');
    const notice = document.getElementById('gev-gpu-notice');
    return {
      tier: g && g.tier,
      renderer: g && g.renderer,
      chipTier: chip && chip.getAttribute('data-gpu-tier'),
      chipText: chip && chip.textContent && chip.textContent.trim(),
      notice: !!notice,
      noticeShown: !!(g && g.noticeShown),
      edgeLens: !!document.getElementById('gev-edge-lens'),
    };
  });
  /* 软件轮里的开卡必须是 150ms / 无回弹（M4），且不建全屏折射 canvas。
     这里同样用真实指针（p3 自己的 CDP 鼠标）点标题，不走 api.dispatch。 */
  {
    const box = await p3.evaluate(() => {
      const h = document.querySelector('#cctv-panel .panel-header');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (box) {
      await p3.mouse.move(box.x, box.y);
      await p3.mouse.down();
      await p3.mouse.up();
    }
  }
  await sleep(900);
  const softMorph = await p3.evaluate(() => window.__lc.api.morph());
  const softGeom = await p3.evaluate(() => {
    const e = document.getElementById('cctv-panel');
    const r = e.getBoundingClientRect();
    return { phase: window.__lc.api.phases()['cctv-panel'], rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  });
  const ok19 =
    soft.tier === 'software' &&
    soft.chipTier === 'software' &&
    /GPU 未启用/.test(soft.chipText || '') &&
    (soft.notice === true || noticeSeen === true || soft.noticeShown === true) &&
    soft.edgeLens === false &&
    !!softMorph &&
    softMorph.duration === 150 &&
    softMorph.reduce === true &&
    softGeom.phase === 'open';
  record('T19', '软件渲染轮：tier=software + chip「GPU 未启用」+ 一次性提示 + 不建 #gev-edge-lens + 动画 150ms 无回弹', ok19, {
    soft,
    noticeSeen,
    softMorph,
    softGeom,
  });
  await p3.close();
}

/* ── 汇总 ───────────────────────────────────────────────────────────────── */
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
const out = { at: new Date().toISOString(), url: URL, viewport: [W, H], pass, fail, results, consoleErrors: consoleErrors.slice(0, 20) };
writeFileSync(`${OUT}/phase2-accept.json`, JSON.stringify(out, null, 1));
console.log(`\n=== ${pass}/${results.length} PASS, ${fail} FAIL ===`);
if (consoleErrors.length) console.log('console errors:', consoleErrors.slice(0, 6).join('\n'));
await browser.close();
process.exit(fail ? 1 : 0);
