#!/usr/bin/env node
import puppeteer from 'puppeteer';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape').catch(() => {});

const rules = await page.evaluate(() => {
  const t = document.querySelector('#gev-voice-control .gev-voice-help-tray');
  const out = [];
  const visit = (ruleList, ctx) => {
    for (const r of ruleList) {
      if (r.cssRules && !r.selectorText) { visit(r.cssRules, ctx + ' @' + (r.conditionText || r.media?.mediaText || r.name || '')); continue; }
      if (!r.selectorText) continue;
      if (!/max-width|display|white-space/.test(r.style?.cssText || '')) continue;
      let hit = false;
      try { hit = t.matches(r.selectorText); } catch { hit = false; }
      if (hit) out.push({ ctx, sel: r.selectorText, css: r.style.cssText.slice(0, 220) });
    }
  };
  for (const ss of document.styleSheets) {
    let list; try { list = ss.cssRules; } catch { continue; }
    visit(list, (ss.href || 'inline').split('/').pop());
  }
  return out;
});
console.log(JSON.stringify(rules, null, 1));
await browser.close();
