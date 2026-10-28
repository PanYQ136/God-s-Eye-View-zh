#!/usr/bin/env node
/** _webgl-probe.mjs —— 检查当前环境 WebGL/GPU 是否可用（Cesium 依赖 WebGL2） */
import puppeteer from 'puppeteer';

const variants = [
  { name: 'default', args: [] },
  { name: 'angle-d3d11', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] },
  { name: 'swiftshader', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
];

for (const v of variants) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--no-sandbox', ...v.args],
      protocolTimeout: 120000,
    });
    const page = await browser.newPage();
    const r = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl2 = c.getContext('webgl2');
      const gl1 = c.getContext('webgl');
      const gl = gl2 || gl1;
      let renderer = null, vendor = null;
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) { renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); }
        renderer = renderer || gl.getParameter(gl.RENDERER);
        vendor = vendor || gl.getParameter(gl.VENDOR);
      }
      let progErr = null;
      if (gl2) {
        const vs = gl2.createShader(gl2.VERTEX_SHADER);
        gl2.shaderSource(vs, '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }');
        gl2.compileShader(vs);
        if (!gl2.getShaderParameter(vs, gl2.COMPILE_STATUS)) progErr = gl2.getShaderInfoLog(vs);
        const fs = gl2.createShader(gl2.FRAGMENT_SHADER);
        gl2.shaderSource(fs, '#version 300 es\nprecision highp float; precision highp sampler3D; out vec4 o; void main(){ o = vec4(1.); }');
        gl2.compileShader(fs);
        if (!gl2.getShaderParameter(fs, gl2.COMPILE_STATUS)) progErr = (progErr || '') + ' | fs: ' + gl2.getShaderInfoLog(fs);
      }
      return { webgl2: !!gl2, webgl1: !!gl1, renderer, vendor, progErr };
    });
    console.log(v.name, JSON.stringify(r));
  } catch (e) {
    console.log(v.name, 'ERR', String(e).slice(0, 200));
  } finally {
    if (browser) await browser.close();
  }
}
