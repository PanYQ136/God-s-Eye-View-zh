#!/usr/bin/env node
/* Phase7A · 「≤5s interactive」判据探针（只观测，不改产品代码）
 * ---------------------------------------------------------------------------
 * 判据（与本轮架构审查报告 §6 一致）：
 *   t_interactive = navigationStart → 「遮罩不遮挡 ∧ 8 张卡已绑交互 ∧ 真实鼠标点击生效」
 * 三条件同时成立的那一刻才算 interactive；任一不成立就继续等，等不到记 FAIL。
 *
 * 与既有 phase7a-cold.mjs 的差别：
 *   - 不只信 `__gevBoot.interactive` / 遮罩 opacity（那是代理量）；
 *   - 追加「卡片已绑 lc 交互」与「真鼠标点击真的把卡从 mini 打开」两条硬断言；
 *   - 用 CDP Input.dispatchMouseEvent（真鼠标事件），不用 element.click()。
 *
 * 用法：node scripts/lc/_diag/phase7a-interactive-probe.mjs [url] [runs]
 */
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const RUNS = Number(process.argv[3] || 2);
const OUT = 'D:/Hermes/gods-eye-view/.gev-logs/lc/phase7a';
mkdirSync(OUT, { recursive: true });

const CARD_IDS = [
  'data-panel',
  'scene-panel',
  'pp-toggles',
  'cctv-panel',
  'global-context-panel',
  'location-bar',
  'control-panel',
  'gev-voice-control',
];
const CLICK_TARGET = 'data-panel'; // 左轨第一张，点击 = 展开（与 scene-panel 互斥）
const HEAD_SEL =
  '.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.location-toolbar,.panel-title,.pp-header-label,.location-toolbar-label,.gev-voice-heading,.gev-voice-readout';
const OP_MAX = 0.05; // 遮罩 opacity 门槛
const CLICK_GRACE_MS = 900; // 状态就绪 → 点击生效的最大延迟
const POLL_MS = 50;
const WATCH_MS = 40000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oneRun(i) {
  const profile = mkdtempSync(join(tmpdir(), 'gev-i7a-'));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile,
    args: [
      '--no-sandbox',
      '--window-size=1372,934',
      '--hide-scrollbars',
      '--ignore-gpu-blocklist',
      '--force_high_performance_gpu',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
    protocolTimeout: 300000,
    defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    await page.bringToFront().catch(() => {});
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable').catch(() => {});
    await cdp.send('Network.clearBrowserCache').catch(() => {});
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
    const t0 = Date.now();
    await page.goto(`${BASE}&p7aprobe=${Date.now()}`, { waitUntil: 'domcontentloaded' });

    /* ── 1) 轮询三条件（cardBound + maskGone）── */
    let stateAt = null;
    let last = null;
    const deadlines = Date.now() + WATCH_MS;
    while (Date.now() < deadlines) {
      const st = await page
        .evaluate((ids, headSel) => {
          const el = document.getElementById('loading-screen');
          const op = el
            ? el.classList.contains('hidden')
              ? 0
              : parseFloat(getComputedStyle(el).opacity) || 0
            : 0;
          const cards = {};
          for (const id of ids) {
            const n = document.getElementById(id);
            cards[id] = n
              ? {
                  lc: n.classList.contains('gev-lc'),
                  phase: n.dataset.lcPhase || null,
                  box: (() => {
                    const r = n.getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height };
                  })(),
                }
              : null;
          }
          const lc = window.__lc && window.__lc.api;
          const g = window.__gevBoot;
          return {
            now: +performance.now().toFixed(1),
            op,
            cards,
            mounted: !!(lc && lc.mounted),
            lastFrameAt: (window.__lc && window.__lc.lastFrameAt) || null,
            phases: lc && typeof lc.phases === 'function' ? lc.phases() : null,
            gateInteractive: !!(g && g.interactive),
            navStart: +performance.now().toFixed(1),
          };
        }, CARD_IDS, HEAD_SEL)
        .catch(() => null);
      if (st) {
        last = st;
        const cardsBound = CARD_IDS.every((id) => st.cards[id] && st.cards[id].lc && st.cards[id].phase);
        const frameFresh =
          st.lastFrameAt != null && Math.abs(st.now - st.lastFrameAt) < 1500;
        if (st.op < OP_MAX && cardsBound && st.mounted && frameFresh) {
          stateAt = st.now;
          break;
        }
      }
      await sleep(POLL_MS);
    }

    /* ── 2) 真鼠标点击（CDP Input.dispatchMouseEvent）── */
    let clickResult = { attempted: false, opened: null, dt: null, at: null };
    if (stateAt != null) {
      const box = await page
        .evaluate(
          (id, headSel) => {
            const card = document.getElementById(id);
            if (!card) return null;
            const head = card.querySelector(headSel) || card;
            const r = head.getBoundingClientRect();
            return r.width > 0 && r.height > 0
              ? { x: r.x + r.width / 2, y: r.y + r.height / 2 }
              : null;
          },
          CLICK_TARGET,
          HEAD_SEL,
        )
        .catch(() => null);
      if (box) {
        clickResult.attempted = true;
        clickResult.at = +(await page.evaluate(() => performance.now()).catch(() => 0)).toFixed(1);
        const base = { x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 };
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
        const tClick = Date.now();
        while (Date.now() - tClick < CLICK_GRACE_MS) {
          const ph = await page
            .evaluate((id) => {
              const lc = window.__lc && window.__lc.api;
              return lc && typeof lc.phases === 'function' ? lc.phases()[id] : null;
            }, CLICK_TARGET)
            .catch(() => null);
          if (ph && ph !== 'mini') {
            clickResult.opened = ph;
            clickResult.dt = Date.now() - tClick;
            break;
          }
          await sleep(40);
        }
      }
    }

    /* ── 3) 收证 ── */
    const evid = await page
      .evaluate(() => {
        const g = window.__gevBoot;
        const tl = window.__bootTimeline;
        const renderer = (() => {
          try {
            const gl = window.__gevViewer?.scene?.context?._gl;
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
          } catch (_) {
            return null;
          }
        })();
        return {
          gate: g && typeof g.snapshot === 'function' ? g.snapshot() : null,
          timelineMarks: tl && tl.snapshot ? tl.snapshot().marks : null,
          photoreal: window.__gevPhotoreal || null,
          renderer,
          lcReady: !!(window.__lc && window.__lc.api && window.__lc.api.ready),
          lcReadyAt: (window.__lc && window.__lc.api && window.__lc.api.readyAt) || null,
          baseTiles: (() => {
            try {
              return globalThis.__gevBaseTiles?.stats?.() || null;
            } catch (_) {
              return null;
            }
          })(),
        };
      })
      .catch(() => null);

    return {
      run: i,
      wallMs: Date.now() - t0,
      tStateMs: stateAt,
      interactiveMs: stateAt != null && clickResult.opened ? stateAt : null,
      click: clickResult,
      clickToEffectMs: clickResult.dt,
      lcApiReadyAt: evid?.lcReadyAt ?? null,
      gateInteractiveAt: evid?.gate?.state?.interactiveAt ?? null,
      photoreal: evid?.photoreal ?? null,
      renderer: evid?.renderer ?? null,
      baseTiles: evid?.baseTiles
        ? { req: evid.baseTiles.req, ok: evid.baseTiles.ok, ms: evid.baseTiles.ms }
        : null,
      gateMarks: (evid?.gate?.marks || []).map((m) => `${m.name}@${m.t}`),
      lastSeen: last
        ? { op: last.op, mounted: last.mounted, gateInteractive: last.gateInteractive }
        : null,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

const rows = [];
for (let i = 1; i <= RUNS; i++) {
  const r = await oneRun(i);
  rows.push(r);
  const ok = r.interactiveMs != null && r.interactiveMs <= 5000;
  console.log(
    `run${i} interactive=${r.interactiveMs ?? 'FAIL'}ms (state=${r.tStateMs} click=${r.click.opened || 'no'} +${r.click.dt ?? '-'}ms) ` +
      `lcReadyAt=${r.lcApiReadyAt} <=5s:${ok ? 'PASS' : 'FAIL'} photoreal=${r.photoreal && r.photoreal.ready}`,
  );
}
const val = rows.map((r) => r.interactiveMs).filter((v) => v != null);
const median = val.length ? [...val].sort((a, b) => a - b)[Math.floor(val.length / 2)] : null;
const out = {
  at: new Date().toISOString(),
  base: BASE,
  criterion:
    'interactive = maskOpacity<0.05 ∧ 8 cards bound(gev-lc+lcPhase) ∧ __lc.api.mounted ∧ 真鼠标点 #data-panel 头部在 900ms 内出 mini→opening',
  runs: rows,
  summary: {
    n: rows.length,
    passed: rows.filter((r) => r.interactiveMs != null && r.interactiveMs <= 5000).length,
    medianInteractiveMs: median,
    maxInteractiveMs: val.length ? Math.max(...val) : null,
    anyFail: rows.filter((r) => r.interactiveMs == null).length,
  },
};
writeFileSync(join(OUT, 'p7a-interactive.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary));
