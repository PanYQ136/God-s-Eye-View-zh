/* 复核 #2：把「命令坞自己的 tray」打开，量它和 credit 的实际间距。
   测试模型（creditAttribution.test.mjs）建模的对象是
   `#command-dock ... #location-bar .dock-popover-content`，即坞内的 tray，
   不是窄屏时被挪到左侧栈里的那个 locale 面板。 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const BASE = process.env.GEV_URL || 'http://127.0.0.1:4181/?welcome=0';
const OUT = process.env.OUT_DIR || '.gev-logs/lc/phase8bcd-tests';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = [[1440, 900], [900, 1000], [800, 1000], [720, 1000]];

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--force-device-scale-factor=1', '--no-sandbox', '--ignore-gpu-blocklist', '--window-size=1520,1040'],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const rows = [];

for (const [w, h] of VPS) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await sleep(15000);
  const toggles = await page.evaluate(() => {
    const dock = document.querySelector('#command-dock');
    return dock ? [...dock.querySelectorAll('.dock-tray-toggle')].map((el, i) => ({
      i, id: el.id || null, cls: String(el.className || '').slice(0, 60), expanded: el.getAttribute('aria-expanded'),
    })) : [];
  });
  let opened = null;
  for (let i = 0; i < toggles.length; i += 1) {
    await page.evaluate((idx) => {
      const dock = document.querySelector('#command-dock');
      const el = dock.querySelectorAll('.dock-tray-toggle')[idx];
      el?.scrollIntoView({ block: 'nearest' });
      el?.click();
    }, i);
    await sleep(900);
    opened = await page.evaluate(() => {
      const dock = document.querySelector('#command-dock');
      if (!dock) return null;
      const trays = [...dock.querySelectorAll('.dock-popover-content')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
            x: r.x, top: r.top, bottom: r.bottom,
            visible: r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
          };
        })
        .filter((t) => t.visible);
      const credit = document.querySelector('#cesium-credits');
      const painted = credit ? [...credit.querySelectorAll('*')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0) : [];
      const unionTop = painted.length ? Math.min(...painted.map((r) => r.top)) : null;
      const unionLeft = painted.length ? Math.min(...painted.map((r) => r.left)) : null;
      const unionBottom = painted.length ? Math.max(...painted.map((r) => r.bottom)) : null;
      const dockRect = dock.getBoundingClientRect();
      return {
        dock: `${Math.round(dockRect.x)},${Math.round(dockRect.y)} ${Math.round(dockRect.width)}x${Math.round(dockRect.height)}`,
        trays,
        creditPainted: unionTop === null ? null : `${Math.round(unionLeft)},${Math.round(unionTop)} h${Math.round(unionBottom - unionTop)}`,
        creditTop: unionTop,
        creditBottom: unionBottom,
      };
    });
    const visible = opened?.trays?.filter((t) => t.y + 1 >= Number(opened.dock.match(/,(\d+) /)[1]));
    if (visible && visible.length) break;
  }
  const dockTop = opened ? Number(opened.dock.match(/,(\d+) /)[1]) : null;
  const nearDock = opened?.trays?.filter((t) => dockTop !== null && Math.abs(t.bottom - dockTop) < 400) ?? [];
  const tray = nearDock.sort((a, b) => a.bottom - b.bottom)[0] ?? null;
  const gap = (tray && opened?.creditTop !== null) ? opened.creditTop - tray.bottom : null;
  rows.push({ viewport: `${w}x${h}`, dock: opened?.dock, trays: opened?.trays, creditPainted: opened?.creditPainted, gapPx: gap, clearancePass: gap === null ? null : gap >= 8, toggles });
  await page.screenshot({ path: `${OUT}/dock-${w}x${h}.png` });
  console.log(`[${w}x${h}] dock=${opened?.dock} trays=${JSON.stringify(opened?.trays)} credit=${opened?.creditPainted} gap=${gap}`);
}

writeFileSync(`${OUT}/dock-credit-probe.json`, JSON.stringify(rows, null, 1));
await browser.close();
