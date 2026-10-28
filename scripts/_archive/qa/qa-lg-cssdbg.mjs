#!/usr/bin/env node
/** qa-lg-cssdbg.mjs —— 检查 gev-liquid-cards.css 是否被解析、语音卡 shadow 来源 */
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(process.argv[2] || 'http://localhost:5183/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
const out = await page.evaluate(() => {
  const sheets = [...document.styleSheets].map((s) => {
    let n = 0, err = null;
    try { n = s.cssRules.length; } catch (e) { err = String(e); }
    return { href: s.href, rules: n, err };
  });
  const vc = document.getElementById('gev-voice-control');
  const cs = vc ? getComputedStyle(vc) : null;
  const inline = vc ? vc.getAttribute('style') : null;
  // 找到声明 box-shadow 且匹配 voice 的规则
  const hits = [];
  [...document.styleSheets].forEach((s) => {
    let rules = [];
    try { rules = [...s.cssRules]; } catch (e) { return; }
    rules.forEach((r) => {
      if (r.cssText && /gev-voice-control/.test(r.selectorText || '') && /box-shadow/.test(r.style ? r.style.cssText : '')) {
        hits.push({ sheet: (s.href || '').split('/').pop(), sel: r.selectorText, shadow: r.style.getPropertyValue('box-shadow'), prio: r.style.getPropertyPriority('box-shadow') });
      }
    });
  });
  const pp = document.querySelector('#pp-toggles .pp-label');
  return {
    sheets, hits,
    voiceShadow: cs ? cs.boxShadow : null, voiceInline: inline,
    ppLabelColor: pp ? getComputedStyle(pp).color : null,
    ppBool: document.documentElement.className,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
