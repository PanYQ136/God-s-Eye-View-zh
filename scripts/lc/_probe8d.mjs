// Phase8D #15 自检：总线就位、槽位清单、兼容面、页面错误
import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'http://127.0.0.1:4173/?welcome=0';
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage();
const errs = [];
p.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
p.on('pageerror', (e) => errs.push(`PAGEERR ${e.message.slice(0, 140)} @ ${(e.stack || '').split('\n')[1] || ''}`));
await p.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await p.evaluate(() => new Promise((r) => setTimeout(r, 8000)));

const out = await p.evaluate(() => {
  const B = globalThis.__gevBridge;
  return {
    bridge: typeof B,
    slots: B ? B.list().map((s) => `${s.name}${s.global ? '→' + s.global : ''}`).join(', ') : null,
    lcApi: !!(window.__lc && window.__lc.api && window.__lc.api.mounted !== undefined),
    lcMorph: !!(window.__lc && window.__lc.morph),
    edgeStats: typeof (window.__gevEdge || {}).stats,
    edgeState: (window.__gevEdgeLens || {}).mode,
    bootState: (window.__gevBoot || {}).state,
    gpuTier: window.__gevGpu && window.__gevGpu.state ? window.__gevGpu.state().tier : null,
    panelApi: typeof (window.__lcPanelApi || {}).setPanelCollapsed,
    disclosure: typeof (window.__lcExternalDisclosure || {}).has,
    lcBooted: window.__lcBooted === true,
    renderer: (() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'none';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })(),
  };
});
console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errs.length ? JSON.stringify(errs, null, 1) : 'none');
await b.close();
