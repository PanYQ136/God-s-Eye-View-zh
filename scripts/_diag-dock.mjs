import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);

const dump = async (tag) =>
  page.evaluate((t) => {
    const info = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { r: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], pos: cs.position, disp: cs.display, ai: cs.alignItems, h: cs.height, mt: cs.marginTop, bottom: cs.bottom, top: cs.top, tr: cs.transform };
    };
    const ids = ['command-dock', 'location-bar', 'gev-voice-control', 'control-panel'];
    const out = { tag: t, vh: innerHeight };
    ids.forEach((id) => (out[id] = info(document.getElementById(id))));
    out.dockChildren = [...(document.getElementById('command-dock')?.children || [])].map((n) => ({ id: n.id, cls: (n.className || '').toString().slice(0, 40), ...info(n) }));
    out.ls = Object.keys(localStorage).filter((k) => /panel|dock|win|gev/i.test(k)).map((k) => [k, (localStorage.getItem(k) || '').slice(0, 120)]);
    return out;
  }, tag);

console.log(JSON.stringify(await dump('first-load'), null, 1));

// 复刻 QA 流程：开/关所有卡 → reload
await page.evaluate(() => {
  ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.open(i));
});
await sleep(1500);
await page.evaluate(() => {
  ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i));
});
await sleep(1500);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);
console.log(JSON.stringify(await dump('after-reload'), null, 1));
await page.screenshot({ path: '.gev-logs/final/diag-dock-reload.png' });
await browser.close();
