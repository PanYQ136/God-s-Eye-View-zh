#!/usr/bin/env node
/* Phase8E2 指纹采集：起静态服务器 → 跑 scripts/lc/_cssfp.mjs → 收服务器。
   用法：node scripts/lc/_8e2-fp-run.mjs <dir> <port> <out.json> */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const [dir, portArg, out] = process.argv.slice(2);
const port = Number(portArg || 4190);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojsonl': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(dir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(normalize(dir))) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
console.log(`[serve] ${dir} on ${port}`);

const child = spawn(process.execPath, ['scripts/lc/_cssfp.mjs', out, `http://127.0.0.1:${port}/?welcome=0`], {
  stdio: 'inherit',
  env: { ...process.env, FP_SETTLE: process.env.FP_SETTLE || '9000' },
});
const code = await new Promise((r) => child.on('exit', r));
await new Promise((r) => server.close(r));
console.log(`[cssfp] ${out} exit=${code}`);
process.exit(code ?? 1);
