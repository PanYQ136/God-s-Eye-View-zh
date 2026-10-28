#!/usr/bin/env node
/** _diag-center.mjs — 导出一张卡的「可见 / 隐藏」两帧，用于核对中心透明差分 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/final2/centerdiag');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = process.argv[2] || 'data-panel';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(3000);
const settle = async () => { for (let i = 0; i < 90; i++) { const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length); if (!n) return; await sleep(35); } };
const sel = { 'data-panel': '#data-panel .panel-header', 'location-bar': '#location-bar .dock-tray-toggle' }[ID];
const pt = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + 26, y: r.y + r.height / 2 }; }, sel);
await page.mouse.click(pt.x, pt.y);
await settle();
await sleep(500);
const box = await page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(r.x + 14), y: Math.round(r.y + 14), width: Math.round(r.width - 28), height: Math.round(r.height - 28) }; }, ID);
await page.screenshot({ path: path.join(OUT, ID + '-visible.png'), clip: box });
await page.evaluate((id) => { document.getElementById(id).style.visibility = 'hidden'; }, ID);
await sleep(300);
await page.screenshot({ path: path.join(OUT, ID + '-hidden.png'), clip: box });
await page.evaluate((id) => { document.getElementById(id).style.visibility = ''; }, ID);
// 也导出一份整页
await page.screenshot({ path: path.join(OUT, ID + '-full.png') });
console.log('OK', OUT, JSON.stringify(box));
await browser.close();
