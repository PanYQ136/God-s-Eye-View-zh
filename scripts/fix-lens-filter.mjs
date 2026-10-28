#!/usr/bin/env node
/**
 * fix-lens-filter.mjs —— 把 public/gev-lg-filter.js 的位移图从「feImage href=data: URI」
 * 改成「defs 里一个 <image id="gev-lg-dispmap"> + feImage href=#gev-lg-dispmap」。
 * 原因（实测 scripts/dbg-filtercost.mjs）：data: URI 的 feImage 每帧重新解码，
 *   9 卡 warp 上 median 帧时长 103.6ms（≈9fps）；改成引用 <image> 后 18.3ms（≈55fps），
 *   图形等价（同一张位移图 + 同一个 EDGE_MASK 滤镜图）。
 */
import fs from 'node:fs';

const P = 'public/gev-lg-filter.js';
let src = fs.readFileSync(P, 'utf8');
if (src.includes('gev-lg-dispmap')) { console.log('already patched'); process.exit(0); }

const KEY = 'href=\\"data:image';
const at = src.indexOf(KEY);
if (at < 0) { console.error('data URI href not found'); process.exit(1); }
const endQuote = src.indexOf('\\"', at + KEY.length);
if (endQuote < 0) { console.error('closing quote not found'); process.exit(1); }
const uri = src.slice(at + 'href=\\"'.length, endQuote);

// ① defs 里插入 <image id="gev-lg-dispmap">（放在 <filter ... 之前）
const MARK = '<defs><filter id=\\"gev-lg-filter\\"';
const mi = src.indexOf(MARK);
if (mi < 0) { console.error('<defs><filter not found'); process.exit(1); }
const imgEl = '<defs><image id=\\"gev-lg-dispmap\\" x=\\"0\\" y=\\"0\\" width=\\"256\\" height=\\"256\\" preserveAspectRatio=\\"xMidYMid slice\\" href=\\"' + uri + '\\"/><filter id=\\"gev-lg-filter\\"';
src = src.slice(0, mi) + imgEl + src.slice(mi + MARK.length);

// ② feImage 的 href 改成引用（只改 <feImage ... 之后那一处，别动 <image> 自己的 href）
const fi = src.indexOf('<feImage');
const at2 = src.indexOf(KEY, fi);
if (fi < 0 || at2 < 0) { console.error('feImage href not found'); process.exit(1); }
const end2 = src.indexOf('\\"', at2 + KEY.length);
src = src.slice(0, at2) + 'href=\\"#gev-lg-dispmap\\"' + src.slice(end2 + 2);

if (!src.includes('href=\\"#gev-lg-dispmap\\"')) { console.error('rewrite failed'); process.exit(1); }
fs.writeFileSync(P, src);
console.log('patched ok, bytes', src.length, '| dispmap bytes', uri.length);
