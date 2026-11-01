/**
 * JSON 响应助手：大于 2KB 且客户端支持 gzip 时压缩。
 *
 * 为什么不做成全局中间件：这个服务端有几十个 provider，写法各异
 * （有的先 writeHead 再 end、有的流式输出、有的分块写），
 * 全局劫持 res 很容易撞上 "Cannot set headers after they are sent"。
 * 只在我们自己的代理里显式调用，风险可控。
 *
 * wx.request 默认带 Accept-Encoding: gzip 并自动解压，所以小程序侧无需改动。
 */

import { gzipSync } from 'node:zlib';

const MIN_BYTES = 2048;

export function sendJson(req, res, status, payload, extraHeaders = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const buf = Buffer.from(body, 'utf8');
  const accept = String((req.headers && req.headers['accept-encoding']) || '');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  };

  if (buf.length >= MIN_BYTES && /gzip/i.test(accept)) {
    let gz;
    try {
      gz = gzipSync(buf, { level: 6 });
    } catch (e) {
      gz = null;
    }
    if (gz && gz.length < buf.length) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      headers['Content-Length'] = String(gz.length);
      res.writeHead(status, headers);
      res.end(gz);
      return;
    }
  }

  headers['Content-Length'] = String(buf.length);
  res.writeHead(status, headers);
  res.end(buf);
}

/**
 * 给任意 provider 的响应挂上 gzip。
 *
 * 关键点：这类 provider 的写法是 `res.writeHead(status, headers)` + `res.end(body)`，
 * 而 Node 在 writeHead 时就把头部发出去了 —— 等到 end 再 setHeader 会
 * ERR_HTTP_HEADERS_SENT（实测直接抛错，压缩静默失效）。
 * 所以连 writeHead 一起接管：先把状态码/头部存起来不发，end 时算出压缩后的
 * 长度再一次性发头。
 */
export function gzipRes(req, res) {
  const accept = String((req.headers && req.headers['accept-encoding']) || '');
  if (!/gzip/i.test(accept)) return;
  if (res.__gevGzip) return;
  res.__gevGzip = true;

  const origWriteHead = res.writeHead.bind(res);
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  let pending = null; // { status, reason, headers }

  const flushHead = () => {
    if (!pending) return;
    const { status, reason, headers } = pending;
    pending = null;
    if (reason) origWriteHead(status, reason, headers);
    else origWriteHead(status, headers);
  };

  res.writeHead = function (status, reasonOrHeaders, maybeHeaders) {
    const reason =
      typeof reasonOrHeaders === 'string' ? reasonOrHeaders : undefined;
    const headers = (reason ? maybeHeaders : reasonOrHeaders) || {};
    pending = {
      status: status || 200,
      reason: reason,
      headers: Object.assign({}, headers),
    };
    return res;
  };

  res.write = function (chunk, enc, cb) {
    flushHead(); // 流式写：不压缩，先把头放出去
    return origWrite(chunk, enc, cb);
  };

  res.end = function (chunk, enc, cb) {
    const callback = typeof enc === 'function' ? enc : cb;
    const encStr = typeof enc === 'string' ? enc : undefined;
    const isBody =
      chunk && (Buffer.isBuffer(chunk) || typeof chunk === 'string');
    /*
     * 已经发过头（provider 直接 res.write / 或绕过我们的 writeHead）→ 绝不能再改长度，
     * 否则 Node 会同时带上新旧 Content-Length，浏览器直接 ERR_INVALID_HTTP_RESPONSE。
     */
    if (res.headersSent) return origEnd(chunk, callback);
    if (pending && isBody && chunk.length >= MIN_BYTES) {
      const ct = String(
        pending.headers['Content-Type'] ||
          pending.headers['content-type'] ||
          '',
      );
      const already =
        pending.headers['Content-Encoding'] ||
        pending.headers['content-encoding'];
      if (!already && /json|text\/|xml|csv|javascript/i.test(ct)) {
        try {
          const buf = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk, encStr || 'utf8');
          const gz = gzipSync(buf, { level: 6 });
          if (gz.length < buf.length) {
            // provider 可能用 res.setHeader 预先塞过长度/编码，先清掉，避免重复头
            try {
              res.removeHeader('Content-Length');
              res.removeHeader('Content-Encoding');
              res.removeHeader('Transfer-Encoding');
            } catch (e) {}
            pending.headers['Content-Encoding'] = 'gzip';
            pending.headers['Vary'] = 'Accept-Encoding';
            pending.headers['Content-Length'] = String(gz.length);
            flushHead();
            return origEnd(gz, callback);
          }
        } catch (e) {
          /* 失败就按原样发 */
        }
      }
      try {
        res.removeHeader('Transfer-Encoding');
      } catch (e) {}
      pending.headers['Content-Length'] = String(
        Buffer.byteLength(chunk, encStr || 'utf8'),
      );
    }
    flushHead();
    return origEnd(chunk, callback);
  };
}
