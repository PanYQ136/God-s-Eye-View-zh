/* Phase8B/C/D 单测修复的真机复核（只读探针，不改产品代码/阈值）
   目的：creditAttribution 的层叠模型被改写成「认识 @layer」之后，要用真浏览器确认
   它预测的 `bottom` 就是浏览器真正画出来的那个值（而不是模型自洽）。
   判据（与 src/creditAttribution.test.mjs 同口径，写死在本文件）：
     CREDIT_HEIGHT_PX = 28 / MIN_CLEARANCE_PX = 8
     每个视口：credit.bottom 必须解析成 px（非 auto）；开 tray 后 credit.top − tray.bottom ≥ 8。
   用法: GEV_URL=http://127.0.0.1:4181/?welcome=0 node scripts/lc/_bcd-credit-probe.mjs
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.GEV_URL || 'http://127.0.0.1:4181/?welcome=0';
const OUT = process.env.OUT_DIR || '.gev-logs/lc/phase8bcd-tests';
mkdirSync(OUT, { recursive: true });
const MIN_CLEARANCE_PX = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  [1440, 900],
  [900, 1000],
  [800, 1000],
  [720, 1000],
];

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--force-device-scale-factor=1', '--no-sandbox', '--ignore-gpu-blocklist', '--window-size=1520,1040'],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await sleep(Number(process.env.BOOT_MS || 14000));
await page.evaluate(() => document.querySelector('#first-run-overlay')?.remove?.());

const read = () => page.evaluate(() => {
  const credit = document.querySelector('#cesium-credits');
  const tray = document.querySelector('#location-bar:not(.collapsed) .dock-popover-content')
    || document.querySelector('#location-bar .dock-popover-content');
  const dock = document.querySelector('#command-dock');
  const cs = credit ? getComputedStyle(credit) : null;
  const cr = credit?.getBoundingClientRect();
  const tr = tray?.getBoundingClientRect();
  const dr = dock?.getBoundingClientRect();
  const bar = document.querySelector('#location-bar');
  /* `#cesium-credits` is a 0×0 fixed shell: the Cesium credit widgets inside it
     are absolutely positioned, so the painted box is the union of its painted
     descendants (logo + text + expand), not the shell's own rect. */
  const painted = credit
    ? [...credit.querySelectorAll('*')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
    : [];
  const union = painted.length
    ? {
      left: Math.min(...painted.map((r) => r.left)),
      top: Math.min(...painted.map((r) => r.top)),
      right: Math.max(...painted.map((r) => r.right)),
      bottom: Math.max(...painted.map((r) => r.bottom)),
    }
    : null;
  return {
    vw: innerWidth,
    vh: innerHeight,
    credit: cs && {
      bottom: cs.bottom,
      position: cs.position,
      display: cs.display,
      visibility: cs.visibility,
      fontSize: cs.fontSize,
      rect: `${Math.round(cr.x)},${Math.round(cr.y)} ${Math.round(cr.width)}x${Math.round(cr.height)}`,
      topFromBottom: Math.round(innerHeight - cr.top),
      painted: union && `${Math.round(union.left)},${Math.round(union.top)} ${Math.round(union.right - union.left)}x${Math.round(union.bottom - union.top)}`,
      paintedTopFromBottom: union ? Math.round(innerHeight - union.top) : null,
      text: (credit.textContent || '').trim().slice(0, 80),
    },
    dock: dr && { rect: `${Math.round(dr.x)},${Math.round(dr.y)} ${Math.round(dr.width)}x${Math.round(dr.height)}` },
    tray: tr && tr.height > 0 && {
      rect: `${Math.round(tr.x)},${Math.round(tr.y)} ${Math.round(tr.width)}x${Math.round(tr.height)}`,
      bottomFromBottom: Math.round(innerHeight - tr.bottom),
      collapsed: bar?.classList.contains('collapsed'),
    },
  };
});

const results = [];
for (const [w, h] of VIEWPORTS) {
  /* 每个视口重新加载：只在 resize 后测量会让 responsive 布局停在中间态
     （dock 卡片被挤到顶部），得到的 credit/tray 几何不可信。 */
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await sleep(Number(process.env.BOOT_MS || 14000));
  await page.evaluate(() => document.querySelector('#first-run-overlay')?.remove?.());
  const closed = await read();
  // 打开 location tray：panelDisclosure 在 collapsed 时 click/pointerenter 都开合。
  await page.click('#location-bar').catch(() => {});
  await sleep(700);
  const open = await read();
  const creditTopY = open.credit?.paintedTopFromBottom !== undefined && open.credit?.painted
    ? Number(open.credit.painted.match(/,(\d+) /)?.[1]) : null;
  const trayBottomY = open.tray ? Number(open.tray.rect.match(/,(\d+) /)?.[1]) + Number(open.tray.rect.match(/x(\d+)$/)?.[1] ?? 0) : null;
  const gap = (creditTopY !== null && trayBottomY !== null) ? creditTopY - trayBottomY : null;
  results.push({ viewport: `${w}x${h}`, closed, open, gapPx: gap, clearancePass: gap === null ? null : gap >= MIN_CLEARANCE_PX });
  const shot = `${OUT}/credit-${w}x${h}.png`;
  await page.screenshot({ path: shot });
  console.log(`[${w}x${h}] bottom=${open.credit?.bottom} painted=${open.credit?.painted} tray=${open.tray?.rect ?? 'n/a'} gap=${gap} ${gap === null ? '' : gap >= MIN_CLEARANCE_PX ? 'PASS' : 'FAIL'}`);
  await page.mouse.move(2, 2);
  await sleep(300);
}

writeFileSync(`${OUT}/credit-probe-after.json`, JSON.stringify({ base: BASE, MIN_CLEARANCE_PX, results }, null, 1));
const hardFails = results.filter((r) => r.open.credit?.bottom === 'auto' || r.open.credit?.display === 'none' || r.clearancePass === false);
console.log('HARD_FAILS', hardFails.length, hardFails.map((r) => r.viewport).join(','));
await browser.close();
process.exit(hardFails.length ? 1 : 0);
