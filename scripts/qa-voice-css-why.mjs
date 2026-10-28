#!/usr/bin/env node
/** 查 #gev-voice-control 为什么没吃到 .gev-lc 的 !important 材质 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820'],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(process.env.GEV_URL || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 120000 });
await sleep(7000);
const out = await page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  const cs = getComputedStyle(el);
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch (e) { continue; }
    const walk = (rules2) => {
      for (const r of rules2) {
        if (r.cssRules) { walk(r.cssRules); continue; }
        if (!r.selectorText) continue;
        try {
          if (el.matches(r.selectorText) && /background|box-shadow/.test(r.style.cssText)) {
            rules.push({ sel: r.selectorText, bg: r.style.getPropertyValue('background') || r.style.getPropertyValue('background-color'), imp: r.style.getPropertyPriority('background') || r.style.getPropertyPriority('background-color'), shadow: (r.style.getPropertyValue('box-shadow') || '').slice(0, 60), impShadow: r.style.getPropertyPriority('box-shadow'), href: (sheet.href || 'inline').split('/').pop() });
          }
        } catch (e) {}
      }
    };
    walk(list);
  }
  return {
    cls: el.className,
    inline: el.getAttribute('style'),
    computedBg: cs.backgroundColor,
    computedShadow: cs.boxShadow.slice(0, 90),
    matched: rules.slice(0, 25),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
