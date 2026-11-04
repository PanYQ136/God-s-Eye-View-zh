#!/usr/bin/env node
/**
 * rebuild-lens-filter.mjs —— 用干净的方式重建 public/gev-lg-filter.js
 * 滤镜图（rdev v1.1.1 standard：位移图 + R/G/B -24/-26.4/-28.8 + EDGE_MASK + CENTER_CLEAN）
 * 从旧文件里原样取出，只把位移图来源换成外链静态图片 /gev-lg-dispmap.jpg（浏览器只解码一次）。
 */
import fs from 'node:fs';

const BACKUP = 'evidence/_collab/t_8cf06356/before/gev-lg-filter.OLD.js';
const old = fs.readFileSync(BACKUP, 'utf8');

// 取出 innerHTML 模板：从 "<svg" 到 "</svg>"
const s = old.indexOf('<svg ');
const e = old.indexOf('</svg>', s);
if (s < 0 || e < 0) { console.error('svg template not found'); process.exit(1); }
let markup = old.slice(s, e + 6);
// JS 字符串里的转义引号 → 真引号
markup = markup.split('\\"').join('"');
markup = markup.split('\\\\').join('\\');
// 位移图：data URI → 外链静态图
markup = markup.replace(/href="data:image\/[a-z]+;base64,[^"]+"/, 'href="/gev-lg-dispmap.jpg"');

if (!markup.includes('href="/gev-lg-dispmap.jpg"')) { console.error('href replace failed'); process.exit(1); }
if (markup.includes('data:image')) { console.error('data uri still present'); process.exit(1); }

const out = `/* 自动生成（重建）：移植 rdev/liquid-glass-react v1.1.1 的折射滤镜
   (standard, displacementScale=70, aberration=2)——
   feImage 位移图 = /gev-lg-dispmap.jpg（静态外链，浏览器只解码一次；用 data: URI 时实测每帧重解码，
   9 卡 warp 会掉到 ≈9fps）。滤镜图本身与原版一致：R/G/B 三个 feDisplacementMap（-24 / -26.4 / -28.8）
   → feComposite in EDGE_MASK 只保留边缘色散 → feComposite over CENTER_CLEAN（中心用原图，不位移）。
   改工具/参数请同时更新本文件与 public/gev-lg-dispmap.jpg。 */
(function () {
  if (document.getElementById('gev-lg-svg')) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = '${markup.replace(/'/g, "\\'")}';
  var svg = wrap.firstElementChild;
  if (svg) (document.body || document.documentElement).appendChild(svg);
})();
`;
fs.writeFileSync('public/gev-lg-filter.js', out);
console.log('rebuilt public/gev-lg-filter.js', out.length, 'bytes');
console.log(markup.slice(0, 320));
