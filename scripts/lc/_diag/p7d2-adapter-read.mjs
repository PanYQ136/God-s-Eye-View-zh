#!/usr/bin/env node
/* 读取指定 Chromium 的 WebGL 适配器（默认 Chrome，可传 msedge） */
import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'gev-adapter-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: exe,
  userDataDir: profile,
  args: ['--no-sandbox', '--window-size=900,700', '--window-position=40,20',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 90000,
  defaultViewport: { width: 860, height: 640, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto('about:blank');
const out = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { renderer: 'NO-WEBGL' };
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
});
console.log(exe.split('\\').pop() + ' => ' + out.renderer);
await browser.close();
