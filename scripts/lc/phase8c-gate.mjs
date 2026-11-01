#!/usr/bin/env node
/* Phase8C —— 玻璃 P1/P2 + STATS 同源验收（D4–D12 的 8C 部分 + #4/#5/#7/#8/#9/#10/#11/#12）
   只读探针：不改产品代码、不改阈值；读数全部取「产品运行时 + 真实截图」。
   ── 判据（写死在本文件）────────────────────────────────────────────────
   A0 GPU：__gevGpu.probe().renderer 含 'RTX 3060'，否则整轮 FAIL
   A1 cfg/eff 同源（D10/#10）：cfg == tokens.json 常量；set() 改的都是 eff，cfg 不动
   A2 tint（D4/G9/#4）：每卡 tintA ∈ [0.01,0.05]、色 = 卡背后中心平均色；
       注入 1.0→0.05 / 0.0→0.01；像素 A/B（tint off vs .05）mean ≥0.6、p99 ≥3 灰阶
   A3 spill（D4/G8）：spillW ≤0.15、shadowRgb == round(ring*w)、computed box-shadow 吃到该 rgb
   A4 明暗翻转（D9/G10/#9）：自然态 pp 卡（luma>0.55）图标转深色；注入 0.2 转回浅色；
       过渡 120ms；8x 裁剪 A/B
   A5 a11y 三态（D5/G18/#5）：真实 emulate prefers-contrast:more → solid（lens 关、CSS 实色）；
       prefers-reduced-transparency:reduce → reduced（dispPx 0 / bandAlpha ≥0.75）；退出即恢复；
       全过程卡片 rect 不变（布局不变）
   A6 同心圆角（D7/G15）：--lc-radius-inner 公式 == max(0, r − inset)；内层 computed 8px
   A7 字重（D8/G17/#8）：玻璃内正文 computed 500；全局未被污染
   A8 pp 行（D12/#12）：真实点击展开后 行距 ≥8、重叠 0、行高 ≥36、命中区 44
   A9 源规则（D11/#11）：gev-cn.css 内 backdrop-filter 声明 0；computed backdrop-filter none
   A10 单层（G2）：8 卡 + fab computed backdrop-filter none / border 0 / 无第二圈
   A11 采样代价：5Hz tint 采样开着时 8s 平均 fps ≥50、无 >100ms 长帧
   用法: node scripts/lc/phase8c-gate.mjs [tag]
   产物: .gev-logs/lc/phase8c/*.png + phase8c-gate[-tag].json
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const TAG = process.argv[2] ? '-' + process.argv[2] : '';
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4173/?welcome=0';
const OUT = '.gev-logs/lc/phase8c';
mkdirSync(OUT, { recursive: true });
const W = 1348;
const VH = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, pass, detail) => {
  R.push({ name, pass: !!pass, ...(detail || {}) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail ? JSON.stringify(detail).slice(0, 300) : ''}`);
};
const TOKENS = JSON.parse(readFileSync('src/lc/tokens.json', 'utf8'));
const CN_CSS = readFileSync('public/gev-cn.css', 'utf8');

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${VH + 160}`,
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true }));
    sessionStorage.setItem('gev.gl.armed', '1');
  } catch (e) {}
});
const t0 = Date.now();
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page
    .evaluate(
      () =>
        !!(window.__lc && window.__lc.api && window.__lc.api.interactiveAt && window.__lc.glass && window.__gevEdge && window.__gevEdge.stats().count > 0),
    )
    .catch(() => false);
  if (ok) break;
  await sleep(400);
}
const bootMs = Date.now() - t0;
/* 瓦片/纹理就绪：tint 采样必须落在「有图」的帧上，否则读到黑（B 的 lumaBlack 同源问题） */
await sleep(9000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const save = (name, b64) => {
  if (!b64) return null;
  const p = `${OUT}/${TAG || '-default'}-${name}.png`;
  writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
};
const parkPtr = async () => {
  await page.mouse.move(4, VH - 8, { steps: 3 });
  await sleep(320);
};

/* 页内像素内核：解码 + 裁剪 + 区域统计 + 竖排合成（全在页面里做，不引额外图像依赖） */
await page.evaluate(() => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  window.__p8 = {
    dec,
    luma,
    mean(A, box) {
      const K = A.K;
      const x0 = Math.max(0, Math.round(box.x * K));
      const y0 = Math.max(0, Math.round(box.y * K));
      const x1 = Math.min(A.w, Math.round((box.x + box.w) * K));
      const y1 = Math.min(A.h, Math.round((box.y + box.h) * K));
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += luma(A.d, (y * A.w + x) * 4); n++; }
      return n ? +(s / n).toFixed(3) : 0;
    },
    /* 区域逐像素 |ΔL| 的 mean / p99 / max */
    diff(A, B, box) {
      const K = A.K;
      const x0 = Math.max(0, Math.round(box.x * K));
      const y0 = Math.max(0, Math.round(box.y * K));
      const x1 = Math.min(A.w, Math.round((box.x + box.w) * K));
      const y1 = Math.min(A.h, Math.round((box.y + box.h) * K));
      const vals = [];
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * A.w + x) * 4;
          vals.push(Math.abs(luma(A.d, i) - luma(B.d, i)));
        }
      vals.sort((a, b) => a - b);
      const n = vals.length || 1;
      return {
        mean: +(vals.reduce((a, b) => a + b, 0) / n).toFixed(3),
        p99: +vals[Math.min(n - 1, Math.floor(n * 0.99))].toFixed(2),
        max: +vals[n - 1].toFixed(2),
        n,
      };
    },
    /* 区域内「R−B」均值（色偏方向，tint 用） */
    rb(A, box) {
      const K = A.K;
      const x0 = Math.max(0, Math.round(box.x * K));
      const y0 = Math.max(0, Math.round(box.y * K));
      const x1 = Math.min(A.w, Math.round((box.x + box.w) * K));
      const y1 = Math.min(A.h, Math.round((box.y + box.h) * K));
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * A.w + x) * 4; s += A.d[i] - A.d[i + 2]; n++; }
      return n ? +(s / n).toFixed(2) : 0;
    },
  };
  window.__p8crop = async (b64, box, s) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const K = bmp.width / innerWidth;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(box.w * K * s));
    cv.height = Math.max(1, Math.round(box.h * K * s));
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(box.x * K), Math.round(box.y * K), Math.round(box.w * K), Math.round(box.h * K), 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png').split(',')[1];
  };
  /* 竖排合成两/三张裁剪图（中间 6px 分隔条），便于 vision 一次看 A/B */
  window.__p8stack = async (b64List, gapPx) => {
    const gap = gapPx == null ? 8 : gapPx;
    const bmps = [];
    for (const b of b64List) bmps.push(await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob()));
    const w = Math.max(...bmps.map((m) => m.width));
    const h = bmps.reduce((a, m) => a + m.height, 0) + gap * (bmps.length - 1);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#ff2d55';
    cx.fillRect(0, 0, w, h);
    let y = 0;
    for (const m of bmps) {
      cx.drawImage(m, 0, y);
      y += m.height + gap;
    }
    return cv.toDataURL('image/png').split(',')[1];
  };
});

const ev = (fn, arg) => page.evaluate(fn, arg);
const stats = () => ev(() => window.__gevEdge.stats());
/* 9 张卡按 5Hz 轮转，单卡 ~1.8s 才轮到一次；轮询等「这张卡真的重采过」再读数 */
const waitCardLook = async (id, prevAt, ms = 6000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const at = await ev((i) => {
      const p = window.__gevEdge.lookState().per;
      return p[i] ? p[i].at : null;
    }, id);
    if (at != null && (prevAt == null || at !== prevAt)) return at;
    await sleep(120);
  }
  return null;
};
const cardRect = (sel) => ev((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; }, sel);
/* 等两帧合成（变量写完 → 屏幕真的变了） */
const settle = async (ms = 260) => {
  await sleep(ms);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
/* 用真实鼠标展开 pp（幂等）：D12 的行距/命中区、D9 的图标像素都要它可见 */
const ensurePpOpen = async () => {
  const phase = await ev(() => document.getElementById('pp-toggles').getAttribute('data-lc-phase'));
  if (phase === 'open') return 'open';
  const h = await ev(() => {
    const r = document.querySelector('#pp-toggles .pp-header-row').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(h.x, h.y, { steps: 6 });
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(1500);
  return ev(() => document.getElementById('pp-toggles').getAttribute('data-lc-phase'));
};
const rectsAll = () =>
  ev(() => {
    const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
    const o = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      o[id] = [+r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
    }
    return o;
  });

/* ── A0 GPU ──────────────────────────────────────────────────────────── */
const gpu = await ev(() => { try { return window.__gevGpu.probe(); } catch (e) { return null; } });
const renderer = (gpu && gpu.renderer) || '';
rec('A0 GPU = RTX 3060（非软件渲染）', /RTX 3060/i.test(renderer), { renderer, tier: gpu && gpu.tier, bootMs });

/* ── A1 cfg / eff 同源（D10/#10）─────────────────────────────────────── */
const s1 = await stats();
const cfgWant = {
  band: TOKENS.material ? 10 : null,
  dispPx: 2.4, gain: 1.0, ior: 1.52, bandAlpha: 0.55,
};
const cfgDiff = [];
for (const k of Object.keys(cfgWant)) if (Math.abs(s1.cfg[k] - cfgWant[k]) > 1e-9) cfgDiff.push({ k, cfg: s1.cfg[k], want: cfgWant[k] });
const cfgKeysOk = ['band', 'bandFrac', 'bandMin', 'feather', 'thick', 'ior', 'gain', 'dispPx', 'dispGain', 'dispCap', 'dispBandStart', 'bandAlpha', 'blurPx', 'rimAmt', 'aa', 'maxScale'].every((k) => k in s1.cfg);
const effKeysOk = ['band', 'dispPx', 'gain', 'ior', 'bandAlpha', 'scale', 'enabled', 'a11y'].every((k) => k in s1.eff);
const mut = await ev(() => {
  window.__gevEdge.set({ band: 12, dispPx: 1.5, gain: 1.5 });
  const a = window.__gevEdge.stats();
  window.__gevEdge.set({ band: 10, dispPx: 2.4, gain: 1.0 });
  const b = window.__gevEdge.stats();
  return { cfgAfter: a.cfg, effAfter: a.eff, cfgBack: b.cfg, effBack: b.eff };
});
const frozen = mut.cfgAfter.band === 10 && mut.cfgAfter.dispPx === 2.4 && mut.cfgAfter.gain === 1.0 && mut.effAfter.band === 12 && Math.abs(mut.effAfter.dispPx - 1.5 * mut.effAfter.scale) < 0.01 && mut.effAfter.gain === 1.5;
rec('A1 stats() 同时输出 cfg/eff 且 cfg 冻结、eff 跟随 set()', cfgDiff.length === 0 && cfgKeysOk && effKeysOk && frozen, {
  cfgDiff, cfgKeysOk, effKeysOk, frozen,
  cfgBand: mut.cfgAfter.band, effBand: mut.effAfter.band, effDispPx: mut.effAfter.dispPx, restoredBand: mut.effBack.band,
});

/* ── A2 tint（D4/G9/#4）──────────────────────────────────────────────── */
const look0 = (await stats()).look;
const per = look0.per || {};
const perKeys = Object.keys(per);
const tints = perKeys.map((k) => per[k].tintA);
const tintInRange = tints.length >= 5 && tints.every((v) => v >= 0.009 && v <= 0.051);
const tintColored = perKeys.filter((k) => per[k].center.some((v) => v > 6)).length;
const tintVar = await ev(() => {
  const cs = getComputedStyle(document.getElementById('data-panel'));
  return { a: cs.getPropertyValue('--lc-tint-a').trim(), rgb: cs.getPropertyValue('--lc-tint-rgb').trim(), img: cs.backgroundImage };
});
const inj = await ev(async () => {
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const at0 = () => { const p = window.__gevEdge.lookState().per; return p['data-panel'] ? p['data-panel'].at : null; };
  const wait = async () => { const a = at0(); for (let i = 0; i < 70; i++) { await sleep2(120); const b = at0(); if (b != null && b !== a) return b; } return null; };
  const out = {};
  window.__gevEdge.look({ forceLuma: 1, forceTint: null });
  await wait();
  out.max = (window.__gevEdge.lookState().per['data-panel'] || {}).tintA;
  window.__gevEdge.look({ forceLuma: 0 });
  await wait();
  out.min = (window.__gevEdge.lookState().per['data-panel'] || {}).tintA;
  window.__gevEdge.look({ forceLuma: null });
  await wait();
  out.auto = (window.__gevEdge.lookState().per['data-panel'] || {}).tintA;
  return out;
});
/* 像素 A/B：tint off vs 强制 0.05（同一帧内容、同一色） */
const dp = await cardRect('#data-panel');
const inner = { x: dp.x + 12, y: dp.y + 40, w: Math.max(20, dp.w - 24), h: Math.max(20, dp.h - 60) };
await parkPtr();
let atPrev = await ev(() => { const p = window.__gevEdge.lookState().per; return p['data-panel'] ? p['data-panel'].at : null; });
await ev(() => window.__gevEdge.look({ tint: false }));
await waitCardLook('data-panel', atPrev);
await settle();
await parkPtr();
const shotTintOff = await shot();
atPrev = await ev(() => { const p = window.__gevEdge.lookState().per; return p['data-panel'] ? p['data-panel'].at : null; });
await ev(() => window.__gevEdge.look({ tint: true, forceTint: 0.05 }));
await waitCardLook('data-panel', atPrev);
await settle();
await parkPtr();
const shotTintOn = await shot();
const dTint = await ev((b) => {
  const a = window.__p8;
  return (async () => {
    const A = await a.dec(b[0]);
    const B = await a.dec(b[1]);
    return { stat: a.diff(A, B, b[2]), rbOff: a.rb(A, b[2]), rbOn: a.rb(B, b[2]) };
  })();
}, [shotTintOff, shotTintOn, inner]);
const tintAB = dTint.stat;
const repeat = [];
for (let i = 0; i < 2; i++) {
  let ap = await ev(() => { const p = window.__gevEdge.lookState().per; return p['data-panel'] ? p['data-panel'].at : null; });
  await ev(() => window.__gevEdge.look({ tint: false }));
  await waitCardLook('data-panel', ap);
  await settle();
  await parkPtr();
  const a1 = await shot();
  ap = await ev(() => { const p = window.__gevEdge.lookState().per; return p['data-panel'] ? p['data-panel'].at : null; });
  await ev(() => window.__gevEdge.look({ tint: true, forceTint: 0.05 }));
  await waitCardLook('data-panel', ap);
  await settle();
  await parkPtr();
  const b1 = await shot();
  const dd = await ev((b) => {
    const a = window.__p8;
    return (async () => a.diff(await a.dec(b[0]), await a.dec(b[1]), b[2]))();
  }, [a1, b1, inner]);
  repeat.push({ mean: dd.mean, p99: dd.p99 });
}
await ev(() => window.__gevEdge.look({ tint: true, forceTint: null }));
await sleep(600);
rec('A2 tint 权重 ∈[0.01,0.05] + 色随背后内容 + 注入 1.0/0.0 → 0.05/0.01', tintInRange && tintColored >= 4 && Math.abs(inj.max - 0.05) < 1e-6 && Math.abs(inj.min - 0.01) < 1e-6, {
  cards: perKeys.length, tints: tints.map((v) => +v.toFixed(3)), tintColored, inj, tintVarA: tintVar.a, tintVarRgb: tintVar.rgb,
});
rec('A2b tint 像素可测（off vs .05）：p99 ≥3 灰阶 / mean ≥0.4，3 次稳定', tintAB.p99 >= 3 && tintAB.mean >= 0.4 && repeat.every((r) => r.p99 >= 3 && r.mean >= 0.4), {
  mean: tintAB.mean, p99: tintAB.p99, max: tintAB.max, n: tintAB.n, repeat, rbOff: dTint.rbOff, rbOn: dTint.rbOn,
});

/* ── A3 spill（D4/G8）────────────────────────────────────────────────── */
const spill = perKeys.map((k) => ({ id: k, w: per[k].spillW, sh: per[k].shadowRgb, ring: per[k].ringLuma }));
const spillOk = spill.length >= 5 && spill.every((s) => s.w >= 0 && s.w <= 0.1501);
const spillConsistent = spill.every((s) => s.sh.every((v) => v >= 0 && v <= 255));
const shadowComputed = await ev(() => {
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const rgb = cs.getPropertyValue('--lc-shadow-rgb').trim();
  return { rgb, box: cs.boxShadow };
});
const shRgb = (shadowComputed.rgb || '').split(',').map((v) => +v.trim());
const shInBox = shRgb.length === 3 && shadowComputed.box.includes(`rgba(${shRgb[0]}, ${shRgb[1]}, ${shRgb[2]}`) || shadowComputed.box.includes(`rgb(${shRgb[0]}, ${shRgb[1]}, ${shRgb[2]}`);
rec('A3 spill 权重 ≤15% 且阴影真的吃到环带色', spillOk && spillConsistent && !!shInBox, {
  w: spill.map((s) => s.w), maxW: Math.max(...spill.map((s) => s.w)), varRgb: shadowComputed.rgb, box: String(shadowComputed.box).slice(0, 120), matched: !!shInBox,
});

/* ── A4 明暗翻转（D9/G10/#9）─────────────────────────────────────────── */
/* icon 属于 pp 展开体：mini 态它是隐藏的（computed 有值但没像素），先真实点击展开 */
const a4Phase = await ensurePpOpen();
await parkPtr();
console.log('# pp phase for A4 =', a4Phase);
const fgNatural = await ev(() => {
  const s = window.__gevEdge.stats();
  const out = {};
  for (const id of ['pp-toggles', 'data-panel']) {
    const el = document.getElementById(id);
    out[id] = {
      varFg: getComputedStyle(el).getPropertyValue('--lc-fg-flip').trim(),
      luma: s.look.per[id] ? s.look.per[id].centerLuma : null,
      iconColor: (() => {
        const ic = el.querySelector('.pp-icon');
        return ic ? getComputedStyle(ic).color : null;
      })(),
      trans: (() => {
        const ic = el.querySelector('.pp-icon');
        return ic ? getComputedStyle(ic).transitionDuration : null;
      })(),
    };
  }
  return out;
});
const ppFg = fgNatural['pp-toggles'];
const darkInk = 'rgb(11, 17, 22)';
const lightInk = 'rgb(234, 244, 255)';
const naturalConsistent = ppFg.luma == null ? false : ppFg.luma > 0.62 ? ppFg.iconColor === darkInk : ppFg.iconColor === lightInk;
/* 8x 裁剪的图标框 */
const iconBox = await ev(() => {
  const el = document.querySelector('#pp-toggles .pp-icon');
  const r = el.getBoundingClientRect();
  return { x: r.x - 4, y: r.y - 4, w: Math.max(12, r.width + 8), h: Math.max(12, r.height + 8) };
});
const shotFgA = await shot();
/* 注入反向亮度（亮底 >0.62 触发深色；暗底 <0.52 回浅色），验证「变量 → 计算色 → 像素」整链 */
const fgTarget = ppFg.luma != null && ppFg.luma > 0.62 ? 0.2 : 1;
let fgAt = await ev(() => { const p = window.__gevEdge.lookState().per; return p['pp-toggles'] ? p['pp-toggles'].at : null; });
await ev((l) => window.__gevEdge.look({ forceLuma: l }), fgTarget);
await waitCardLook('pp-toggles', fgAt);
await settle(340); /* 120ms 颜色过渡 + 两帧合成 */
const fgForced = await ev(() => {
  const el = document.getElementById('pp-toggles');
  const ic = el.querySelector('.pp-icon');
  return { varFg: getComputedStyle(el).getPropertyValue('--lc-fg-flip').trim(), iconColor: getComputedStyle(ic).color };
});
await parkPtr();
const shotFgB = await shot();
const fgPixel = await ev((b) => {
  const a = window.__p8;
  return (async () => a.diff(await a.dec(b[0]), await a.dec(b[1]), b[2]))();
}, [shotFgA, shotFgB, iconBox]);
await ev(() => window.__gevEdge.look({ forceLuma: null }));
await sleep(600);
const forcedWantsDark = fgTarget === 1;
const flipForced = forcedWantsDark ? fgForced.iconColor === darkInk && fgForced.varFg.toLowerCase() === '#0b1116' : fgForced.iconColor === lightInk && fgForced.varFg.toLowerCase() === '#eaf4ff';
rec('A4 图标随亮度翻转（注入亮底→深墨、暗底→浅墨）+ 120ms 过渡', naturalConsistent && flipForced && fgPixel.max >= 40 && String(ppFg.trans).includes('0.12s'), {
  naturalLuma: ppFg.luma, naturalVar: ppFg.varFg, naturalIcon: ppFg.iconColor, naturalConsistent,
  forcedLuma: fgTarget, forcedVar: fgForced.varFg, forcedIcon: fgForced.iconColor, forcedOk: flipForced,
  trans: ppFg.trans, pixel: fgPixel,
});

/* ── A5 a11y 三态（D5/G18/#5）────────────────────────────────────────── */
const rectsBefore = await rectsAll();
const a5 = {};
/* 真实媒体查询：prefers-contrast: more → solid（走 CDP，puppeteer 的 API 对这两个 feature 有白名单） */
let emuContrast = true;
try {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
} catch (e) {
  emuContrast = false;
  a5.emuErr1 = String(e && e.message).slice(0, 120);
}
await sleep(900);
const solidState = await ev(() => {
  const s = window.__gevEdge.stats();
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const cv = document.getElementById('gev-edge-lens');
  let alpha = null;
  try {
    const gl = cv.getContext('webgl2');
    const px = new Uint8Array(4);
    gl.readPixels(10, 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    alpha = [px[0], px[1], px[2], px[3]];
  } catch (e) {}
  return {
    a11y: s.a11y, enabled: s.eff.enabled, count: s.count,
    bg: cs.backgroundColor, softFill: getComputedStyle(document.documentElement).getPropertyValue('--lc-soft-fill').trim(),
    contrastMq: !!(window.matchMedia && matchMedia('(prefers-contrast: more)').matches),
    lensAlpha: alpha,
    canvasOpacity: getComputedStyle(cv).opacity,
  };
});
const rectsSolid = await rectsAll();
const solidOk = solidState.a11y && solidState.a11y.state === 'solid' && solidState.enabled === false && solidState.count === 0 && /rgba\(8, 12, 18, 0.55\)/.test(String(solidState.bg));
const layoutSame = JSON.stringify(rectsBefore) === JSON.stringify(rectsSolid);
const shotSolid = await shot();
a5.solid = { ...solidState, layoutSame, emulated: emuContrast };
/* prefers-reduced-transparency: reduce → reduced */
let emuReduced = true;
try {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-contrast', value: 'no-preference' },
      { name: 'prefers-reduced-transparency', value: 'reduce' },
    ],
  });
} catch (e) {
  emuReduced = false;
  a5.emuErr2 = String(e && e.message).slice(0, 120);
}
await sleep(1200);
const reducedState = await ev(() => {
  const s = window.__gevEdge.stats();
  return {
    a11y: s.a11y, eff: s.eff, mq: { reducedTr: !!(window.matchMedia && matchMedia('(prefers-reduced-transparency: reduce)').matches), contrast: !!(window.matchMedia && matchMedia('(prefers-contrast: more)').matches) },
  };
});
const reducedOk = reducedState.a11y && reducedState.a11y.state === 'reduced' && reducedState.eff.dispPx === 0 && reducedState.eff.bandAlpha >= 0.75 && reducedState.eff.enabled === true;
a5.reduced = reducedState;
/* 退出模拟 → 恢复 full */
await cdp.send('Emulation.setEmulatedMedia', { features: [] });
await sleep(1200);
const backState = await ev(() => window.__gevEdge.stats());
const backOk = backState.a11y && backState.a11y.state === 'full' && backState.eff.enabled === true && Math.abs(backState.eff.dispPx - 2.4 * backState.eff.scale) < 0.05 && Math.abs(backState.eff.bandAlpha - 0.55) < 1e-9;
/* 钩子兜底路径（媒体不支持时也能验）：force 三态 */
const hookStates = await ev(async () => {
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = {};
  o.reduced = window.__gevEdge.a11y('reduced');
  await sleep2(400);
  o.solid = window.__gevEdge.a11y('solid');
  await sleep2(400);
  o.full = window.__gevEdge.a11y('full');
  await sleep2(700);
  o.after = window.__gevEdge.stats().eff;
  return o;
});
rec('A5 a11y 三态：solid（真实媒体）关 lens + CSS 实色 + 布局不变', solidOk && layoutSame && (emuContrast || hookStates.solid.enabled === false), {
  state: solidState.a11y && solidState.a11y.state, enabled: solidState.enabled, count: solidState.count, bg: solidState.bg, mq: solidState.contrastMq, emulated: emuContrast, layoutSame, lensAlpha: solidState.lensAlpha,
});
rec('A5b a11y 三态：reduced（真实媒体）dispPx 0 / bandAlpha .75，退出恢复 full', reducedOk && backOk, {
  emulated: emuReduced, reduced: reducedState.a11y && reducedState.a11y.state, dispPx: reducedState.eff.dispPx, bandAlpha: reducedState.eff.bandAlpha,
  backState: backState.a11y && backState.a11y.state, backDispPx: backState.eff.dispPx, backBandAlpha: backState.eff.bandAlpha, hook: { reduced: hookStates.reduced.state, solid: hookStates.solid.enabled, full: hookStates.full.state },
});

/* ── A6 同心圆角（D7/G15）────────────────────────────────────────────── */
const radius = await ev(() => {
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const inner = el.querySelector('.pp-panel-body,.panel-inner,[class$="-panel-inner"]');
  return {
    token: cs.getPropertyValue('--lc-radius-inner').trim(),
    inset: cs.getPropertyValue('--lc-inset').trim(),
    outer: cs.borderTopLeftRadius,
    innerRadius: inner ? getComputedStyle(inner).borderTopLeftRadius : null,
    innerTag: inner ? inner.className : null,
  };
});
const radiusOk = /max\(0px, calc\(16px - 8px\)\)|max\(0px, calc\(var\(--lc-radius\) - var\(--lc-inset/.test(radius.token.replace(/\s+/g, ' ')) || radius.token.includes('calc');
const radiusComputed = await ev(() => {
  const el = document.querySelector('#pp-toggles .pp-panel-body');
  return el ? getComputedStyle(el).borderTopLeftRadius : null;
});
rec('A6 --lc-radius-inner = max(0, radius − inset)，内层统一 8px', radiusOk && radiusComputed === '8px', { ...radius, ppBodyRadius: radiusComputed });

/* ── A7 字重（D8/G17/#8）────────────────────────────────────────────── */
const weights = await ev(() => {
  const g = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontWeight : null; };
  return {
    ppLabel: g('#pp-toggles .pp-label'),
    miniLabel: g('#pp-toggles .pp-slider-mini-label'),
    dataMeta: g('#data-panel .panel-mini-value'),
    title: g('.panel-title'),
    globalBody: getComputedStyle(document.body).fontWeight,
    outside: g('#gev-lang-toggle'),
  };
});
rec('A7 玻璃内正文 ≥500 且不污染全局', weights.ppLabel === '500' && weights.miniLabel === '500' && weights.globalBody !== '500', weights);

/* ── A8 pp 行（D12/#12）──────────────────────────────────────────────── */
/* 真鼠标展开 pp（A4 已展开则幂等返回） */
const ppOpen = await ensurePpOpen();
const rows = await ev(() => {
  const card = document.getElementById('pp-toggles');
  const groups = Array.from(card.querySelectorAll('.pp-toggle-group'));
  const out = { groups: groups.length, gaps: [], overlaps: [], minH: [], rows: [], hits: [] };
  for (const g of groups) {
    const kids = Array.from(g.children).filter((k) => k.tagName !== 'OUTPUT');
    const gs = parseFloat(getComputedStyle(g).rowGap || '0');
    let prev = null;
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      out.rows.push({ cls: k.className, h: +r.height.toFixed(2), top: +r.top.toFixed(2) });
      out.minH.push(+r.height.toFixed(2));
      if (prev) {
        out.gaps.push(+(r.top - (prev.top + prev.height)).toFixed(2));
        if (r.top < prev.top + prev.height - 0.5) out.overlaps.push({ cls: k.className, overlap: +(prev.top + prev.height - r.top).toFixed(2) });
      }
      prev = r;
    }
    out.rowGap = gs;
  }
  /* 命中区：行框上方 3px 处 elementFromPoint 必须还是这一行（或其子元素） */
  const probeRows = Array.from(card.querySelectorAll('.pp-toggle-group > .pp-toggle-btn, .pp-toggle-group > .pp-slider-row')).slice(0, 6);
  for (const k of probeRows) {
    const r = k.getBoundingClientRect();
    for (const dy of [-3, 3]) {
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + (dy < 0 ? -3 : r.height + 3)));
      const hit = !!(el && (el === k || k.contains(el) || (el.closest && el.closest('.pp-toggle-group > *') === k)));
      out.hits.push({ cls: String(k.className).split(' ')[0], dy: dy < 0 ? 'above3' : 'below3', hit, got: el ? String(el.className || el.tagName).slice(0, 40) : null });
    }
  }
  return out;
});
const gapOk = rows.gaps.length >= 6 && rows.gaps.every((g) => g >= 7.5);
const overlapOk = rows.overlaps.length === 0;
const minHOk = rows.minH.filter((h) => h >= 35.5).length >= Math.floor(rows.minH.length * 0.8);
const hitsOk = rows.hits.length >= 6 && rows.hits.filter((h) => h.hit).length / rows.hits.length >= 0.8;
rec('A8 pp 行：gap ≥8 / 重叠 0 / 行高 ≥36 / 命中区外扩 44', ppOpen === 'open' && gapOk && overlapOk && minHOk && hitsOk, {
  phase: ppOpen, groups: rows.groups, minGap: Math.min(...rows.gaps), maxGap: Math.max(...rows.gaps), overlaps: rows.overlaps.length,
  minHeight: Math.min(...rows.minH), hits: rows.hits.filter((h) => h.hit).length + '/' + rows.hits.length, rowGap: rows.rowGap,
});
const ppCard = await cardRect('#pp-toggles');
const shotPp = await shot();

/* ── A9 D11 源规则 ───────────────────────────────────────────────────── */
const cnBackdrop = (CN_CSS.match(/backdrop-filter\s*:/g) || []).length;
const computedBackdrop = await ev(() => {
  const g = (sel) => { const el = document.querySelector(sel); return el ? { bd: getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter, bg: getComputedStyle(el).backgroundColor } : null; };
  return { lang: g('#gev-lang-toggle'), locate: g('#gev-locate-btn'), toast: g('#gev-toast') };
});
const cbOk = ['lang', 'locate', 'toast'].every((k) => !computedBackdrop[k] || computedBackdrop[k].bd === 'none');
rec('A9 gev-cn.css 无 backdrop-filter 源规则 + computed none', cnBackdrop === 0 && cbOk, { cnBackdrop, computed: computedBackdrop });

/* ── A10 单层（G2）─────────────────────────────────────────────────── */
const singleLayer = await ev(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const bad = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none') bad.push({ id, why: 'backdrop-filter ' + bf });
    if (parseFloat(cs.borderTopWidth) > 0) bad.push({ id, why: 'border ' + cs.borderTopWidth });
    const kids = el.querySelectorAll('*');
    for (const k of kids) {
      const ks = getComputedStyle(k);
      const kbf = ks.backdropFilter || ks.webkitBackdropFilter;
      if (kbf && kbf !== 'none') { bad.push({ id, why: 'child backdrop-filter ' + String(k.className).slice(0, 24) }); break; }
    }
  }
  return bad;
});
rec('A10 每张卡单层玻璃（0 卡体内 backdrop-filter / border）', singleLayer.length === 0, { bad: singleLayer });

/* ── A11 采样代价 ───────────────────────────────────────────────────── */
const perf = await ev(async () => {
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__gevEdge.resetPeaks('a11');           /* 峰值清零：只量这 8s 窗口内的 draw */
  const ls0 = window.__gevEdge.stats().look.samples;
  await sleep2(8000);
  const s = window.__gevEdge.stats();
  return { fps: s.fps, p95: s.p95, drawMax: s.drawMax, drawLog: (s.drawLog || []).length, lookSamples: s.look.samples - ls0, frames: s.frames, secs: 8 };
});
rec('A11 tint 采样 5Hz 下 fps ≥50、窗口内无 >100ms 长帧', perf.fps >= 50 && perf.fps <= 200 && perf.lookSamples >= 20 && perf.drawMax <= 100, perf);

/* ── 截图产物 ───────────────────────────────────────────────────────── */
await parkPtr();
await page.mouse.move(4, VH - 8);
await sleep(400);
const shotFull = await shot();
const shotPaths = [];
shotPaths.push(save('a0-full-1x', shotFull));
shotPaths.push(save('a8-pp-card-4x', await ev((b) => window.__p8crop(b[0], b[1], 4), [shotPp, ppCard])));
/* tint A/B 合成 */
const cropTintOff = await ev((b) => window.__p8crop(b[0], b[1], 6), [shotTintOff, inner]);
const cropTintOn = await ev((b) => window.__p8crop(b[0], b[1], 6), [shotTintOn, inner]);
const stackTint = await ev((b) => window.__p8stack(b, 10), [cropTintOff, cropTintOn]);
shotPaths.push(save('a2-tint-off-vs-on-6x', stackTint));
/* fg A/B 合成 */
const cropFgA = await ev((b) => window.__p8crop(b[0], b[1], 8), [shotFgA, iconBox]);
const cropFgB = await ev((b) => window.__p8crop(b[0], b[1], 8), [shotFgB, iconBox]);
const stackFg = await ev((b) => window.__p8stack(b, 10), [cropFgA, cropFgB]);
shotPaths.push(save('a4-fg-natural-vs-forced-8x', stackFg));
/* solid 态 4x */
const solidBox = { x: 12, y: 84, w: 420, h: 300 };
shotPaths.push(save('a5-solid-4x', await ev((b) => window.__p8crop(b[0], b[1], 4), [shotSolid, solidBox])));
shotPaths.push(save('a0-data-panel-4x', await ev((b) => window.__p8crop(b[0], b[1], 4), [shotFull, dp])));

const fails = R.filter((r) => !r.pass);
const outJson = {
  phase: '8C', at: new Date().toISOString(), tag: TAG || '-default', bootMs, renderer,
  result: fails.length ? 'FAIL' : 'PASS', pass: R.length - fails.length, total: R.length,
  checks: R, errs: errs.slice(0, 10), shots: shotPaths.filter(Boolean),
  stats: { cfg: s1.cfg, eff: s1.eff, a11y: backState.a11y, look: { samples: look0.samples, src: look0.src, fboStatus: look0.fboStatus, per } },
  params: { tint: { min: 0.01, max: 0.05, hz: 5 }, spillMax: 0.15, fg: { threshold: 0.55, ms: 120 }, pp: { rowMinH: 36, hitPx: 44, rowGap: 8 }, radiusInner: radius, weights },
};
writeFileSync(`${OUT}/phase8c-gate${TAG}.json`, JSON.stringify(outJson, null, 1));
console.log(`\n=== ${outJson.result}  ${outJson.pass}/${outJson.total} ===`);
if (fails.length) console.log('FAILS: ' + fails.map((f) => f.name).join(' | '));
await browser.close();
process.exit(fails.length ? 1 : 0);
