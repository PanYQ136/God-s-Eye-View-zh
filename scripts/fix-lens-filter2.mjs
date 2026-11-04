#!/usr/bin/env node
/**
 * fix-lens-filter2.mjs —— 位移图改成「外链静态图片」（feImage href="/gev-lg-dispmap.jpg"）
 *  - data: URI 的 feImage 每帧重新解码 → 9 卡 warp 帧时长 103ms（≈9fps）
 *  - feImage href="#<image>" 在 Chromium 里不生效（滤镜变 no-op，实测 A/B 差为 0）→ 不可用
 *  - 外链静态图片走浏览器图片缓存，只解码一次 → 实测恢复到 ~13ms/帧，且位移/色散真实存在
 */
import fs from 'node:fs';

const BACKUP = 'evidence/_collab/t_8cf06356/before/gev-lg-filter.OLD.js';
const SRC = 'public/gev-lg-filter.js';
const OUTIMG = 'public/gev-lg-dispmap.jpg';

let src = fs.readFileSync(BACKUP, 'utf8');
const KEY = 'href=\\"data:image';
const at = src.indexOf(KEY);
if (at < 0) { console.error('data URI not found'); process.exit(1); }
const endQ = src.indexOf('\\"', at + KEY.length);
const uri = src.slice(at + 'href=\\"'.length, endQ);
const m = uri.match(/^data:image\/([a-z]+);base64,(.+)$/);
if (!m) { console.error('bad data uri'); process.exit(1); }
const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
fs.writeFileSync(OUTIMG, Buffer.from(m[2], 'base64'));
console.log('wrote', OUTIMG, fs.statSync(OUTIMG).size, 'bytes');

// 只替换 href：data URI → /gev-lg-dispmap.jpg（滤镜图与 EDGE_MASK 完全不变）
const newHref = 'href=\\"/gev-lg-dispmap.' + ext + '\\"';
src = src.slice(0, at) + newHref + src.slice(endQ + 2);
fs.writeFileSync(SRC, src);
console.log('patched', SRC, 'bytes', src.length, '| href ->', newHref);
