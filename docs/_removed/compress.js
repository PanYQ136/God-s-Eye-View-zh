/**
 * /api 响应 gzip 压缩（开发/内网服务端）
 *
 * 为什么需要：航班一次 300 架 ≈ 73 KB、数据源健康 10 KB、舰船更大，
 * 而 wx.request 默认带 Accept-Encoding: gzip 并自动解压。
 * 不压缩 = 小程序在 4G 上白等几十 KB 的传输时间。
 *
 * 实现方式：先注册、就地劫持 res.write/res.end，把响应体攒起来再决定压缩。
 * 只处理 /api 下的普通 JSON/文本，流式（视频、HLS、SSE）一律放行不缓冲。
 */

import { gzipSync } from 'node:zlib';

const MIN_BYTES = 1024;
// 这些路径是流式/二进制，缓冲了会直接坏掉
const SKIP_PATHS = [
  '/api/cctv/media',
  '/api/ais-live/stream',
  '/api/ais-live/ws',
  '/api/radio/stream',
  '/api/realtime',
  '/api/imagery',
  '/api/terrain',
];
const TEXTY = /json|text|javascript|xml|csv|plain/i;

function shouldSkip(req, res) {
  if (req.method === 'HEAD') return true;
  const url = String(req.url || '');
  if (!url.startsWith('/api')) return true;
  for (const p of SKIP_PATHS) if (url.startsWith(p)) return true;
  const accept = String(req.headers['accept-encoding'] || '');
  if (!/gzip/i.test(accept)) return true;
  return false;
}

export function compressPlugin() {
  function install(server) {
    server.middlewares.use((req, res, next) => {
      if (shouldSkip(req, res)) { next(); return; }

      const chunks = [];
      let length = 0;
      let aborted = false;

      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);
      const origWriteHead = res.writeHead.bind(res);

      // 头里如果要写 content-length，先扣下（压缩后长度会变）。
      // 注意 writeHead 有两种签名：(status, headers) 和 (status, statusMessage, headers)，
      // 只处理前者会把 statusMessage 当 headers 用，接着就是
      // "Cannot set headers after they are sent to the client"。
      const dropLen = (h) => {
        if (!h || typeof h !== 'object') return h;
        try {
          delete h['content-length'];
          delete h['Content-Length'];
          delete h['content-encoding'];
          delete h['Content-Encoding'];
        } catch (e) { /* 只读对象就算了，后面靠 setHeader 兜底 */ }
        return h;
      };
      res.writeHead = function patchedWriteHead(status, a, b) {
        try {
          if (typeof a === 'string') return origWriteHead(status, a, dropLen(b));
          return origWriteHead(status, dropLen(a));
        } catch (e) {
          return origWriteHead(status, a, b);
        }
      };

      res.write = function patchedWrite(chunk, encoding, cb) {
        if (aborted) return origWrite(chunk, encoding, cb);
        if (chunk) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
          chunks.push(buf);
          length += buf.length;
        }
        if (typeof encoding === 'function') cb = encoding;
        if (cb) cb();
        return true;
      };

      res.end = function patchedEnd(chunk, encoding, cb) {
        if (aborted) return origEnd(chunk, encoding, cb);
        if (typeof chunk === 'function') { cb = chunk; chunk = null; }
        if (chunk) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
          chunks.push(buf);
          length += buf.length;
        }
        const type = String(res.getHeader('content-type') || '');
        const already = String(res.getHeader('content-encoding') || '');
        const body = Buffer.concat(chunks, length);

        if (!body.length || already || !TEXTY.test(type) || body.length < MIN_BYTES) {
          res.setHeader('content-length', body.length);
          return origEnd(body, cb);
        }
        let out;
        try { out = gzipSync(body, { level: 6 }); } catch (e) { out = body; }
        if (out.length >= body.length) {
          res.setHeader('content-length', body.length);
          return origEnd(body, cb);
        }
        res.setHeader('content-encoding', 'gzip');
        res.setHeader('vary', 'Accept-Encoding');
        res.setHeader('content-length', out.length);
        return origEnd(out, cb);
      };

      // 客户端提前断开：别再攒内存
      res.on('close', () => { aborted = true; chunks.length = 0; });
      next();
    });
  }
  return {
    name: 'api-gzip',
    configureServer: install,
    configurePreviewServer: install,
  };
}
