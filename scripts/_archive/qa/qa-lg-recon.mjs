#!/usr/bin/env node
/** Recon: dump DOM/geometry/GL info for the Liquid Glass rebuild (P0 baseline). */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const outDir = process.argv[3] || 'evidence/lg-glass-shots/p0';
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1536,730',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));

const info = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const ids = [
    'data-panel',
    'scene-panel',
    'pp-toggles',
    'cctv-panel',
    'global-context-panel',
    'location-bar',
    'control-panel',
    'gev-voice-control',
    'command-dock',
    'gev-gfx-fab',
    'gev-locate-btn',
    'gev-perf-wrap',
    'gev-lang-toggle',
    'left-panel-stack',
    'right-context-rail',
    'style-indicator',
    'key-setup-chip',
    'gev-gl-glass',
  ];
  const els = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { els[id] = null; continue; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    els[id] = {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cls: el.className,
      bg: cs.backgroundColor,
      bgi: cs.backgroundImage.slice(0, 120),
      border: cs.border,
      radius: cs.borderTopLeftRadius,
      boxShadow: cs.boxShadow.slice(0, 160),
      backdrop: cs.backdropFilter,
      z: cs.zIndex,
      children: [...el.children].slice(0, 8).map((c) => c.tagName + '.' + (c.className || '').toString().split(' ')[0]),
    };
  }
  const childrenWithInnerGlass = [...document.querySelectorAll('[class*="inner"],[class*="-panel-inner"]')]
    .slice(0, 40)
    .map((e) => {
      const cs = getComputedStyle(e);
      return {
        cls: e.className.toString().slice(0, 60),
        bg: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        backdrop: cs.backdropFilter,
        shadow: cs.boxShadow.slice(0, 80),
      };
    });
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'n/a',
    dpr: devicePixelRatio,
    els,
    childrenWithInnerGlass,
    htmlCls: document.documentElement.className,
    glassOn: !!document.getElementById('gev-gl-glass'),
    stats: window.__gevGlStats ? window.__gevGlStats() : null,
    scrollbars: [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible').slice(0, 15).map((e) => (e.id || e.className.toString().slice(0, 40)) + ' ' + e.scrollHeight + '/' + e.clientHeight),
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('ERRORS', JSON.stringify(errors.slice(0, 10), null, 1));
await page.screenshot({ path: `${outDir}/recon-1536.png` });
await browser.close();
