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
  localStorage.removeItem('gev-liquid-cards:v2');
  localStorage.removeItem('gev-liquid-cards:v2:last');
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);

const out = await page.evaluate(() => {
  const chain = (el) => {
    const a = [];
    let n = el;
    while (n && n !== document.body && a.length < 12) {
      a.push((n.id ? '#' + n.id : '') + (n.classList?.length ? '.' + [...n.classList].slice(0, 3).join('.') : ''));
      n = n.parentElement;
    }
    return a;
  };
  const pp = document.getElementById('pp-toggles');
  const res = { chain: chain(pp), panels: {} };
  // 所有 panel 的宿主
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control']) {
    const el = document.getElementById(id);
    res.panels[id] = el ? { chain: chain(el).slice(0, 5), collapsed: el.classList.contains('collapsed') } : null;
  }
  // pp 内部结构
  const body = pp.querySelector('.pp-panel-body') || pp;
  res.ppBody = { cls: body.className, rect: body.getBoundingClientRect().toJSON(), scrollH: body.scrollHeight, clientH: body.clientHeight, display: getComputedStyle(body).display, overflow: getComputedStyle(body).overflow };
  res.ppChildren = [...pp.querySelectorAll('*')].slice(0, 60).map((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      tag: n.tagName,
      cls: (n.className || '').toString().slice(0, 44),
      id: n.id || '',
      r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      pos: cs.position,
      disp: cs.display,
      mt: cs.marginTop,
      bg: cs.backgroundColor,
      bf: cs.backdropFilter,
      txt: (n.children.length === 0 ? (n.textContent || '').trim().slice(0, 18) : ''),
    };
  });
  // 关闭钮 ✕ 来源
  res.xEls = [...document.querySelectorAll('*')]
    .filter((n) => {
      const cs = getComputedStyle(n);
      const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0;
      return vis && /^[✕✖✗×x]$/i.test((n.textContent || '').trim()) && n.children.length === 0;
    })
    .map((n) => ({ tag: n.tagName, cls: (n.className || '').toString(), chain: chain(n).slice(0, 6), r: n.getBoundingClientRect().toJSON() }));
  return res;
});
console.log(JSON.stringify(out, null, 1));
await page.evaluate(() => window.__gevLc.open('pp-toggles'));
await sleep(1200);
await page.screenshot({ path: '.gev-logs/final/diag-pp.png' });
const out2 = await page.evaluate(() => {
  const pp = document.getElementById('pp-toggles');
  const rows = [...pp.querySelectorAll('.pp-toggle-group, .pp-slider-row, .pp-header-row, .pp-toggle-btn, .pp-mode-btn, .pp-panel-body')].map((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { cls: (n.className || '').toString().slice(0, 40), r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], pos: cs.position, disp: cs.display, mt: cs.marginTop, mb: cs.marginBottom };
  });
  const b = pp.getBoundingClientRect();
  return { card: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], scrollH: pp.scrollHeight, clientH: pp.clientHeight, rows };
});
console.log('--- EXPANDED ---');
console.log(JSON.stringify(out2, null, 1));
await browser.close();
