/**
 * 基础设施静态数据代理 — `GET /api/infra/static/{cables|datacenters|dams}`
 *
 * 为什么需要它：这三份数据（海底光缆 326 KB / 数据中心 149 KB / 水坝 26 KB）
 * 原先被打包进微信小程序主包，吃掉 2 MB 上限的四分之一。改为服务端按需下发，
 * 小程序只在开启对应图层时下载一次（端内 storage 缓存 7 天）。
 *
 * 数据源：public/data/gev/*.json（由 mini program 侧 crop 脚本生成，
 * 与网页版 src/data/local_data 同源，已裁剪为紧凑格式 + 质心化）。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSourceRoot } from './common/source-root.js';

const FILES = Object.freeze({
  cables: 'cables.json',
  datacenters: 'datacenters.json',
  dams: 'dams.json',
});

const HOUR = 3600_000;
const MEM_TTL = 24 * HOUR;

export function infraStaticProxy({ sourceRoot = defaultSourceRoot } = {}) {
  const cache = new Map(); // name -> { text, at, mtime }

  function fileFor(name) {
    return path.join(sourceRoot, 'public', 'data', 'gev', FILES[name]);
  }

  async function load(name) {
    const hit = cache.get(name);
    if (hit && Date.now() - hit.at < MEM_TTL) return hit;
    const text = await readFile(fileFor(name), 'utf8');
    const entry = { text, at: Date.now() };
    cache.set(name, entry);
    return entry;
  }

  const handler = async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.end(body);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(405, JSON.stringify({ error: 'method_not_allowed' }), {
        'Cache-Control': 'no-store',
      });
    }

    // 取 path 部分并去掉可选的 .json 后缀
    const raw = String(req.url || '/').split('?')[0];
    const name = raw.replace(/^\/+/, '').replace(/\.json$/i, '');
    if (!Object.hasOwn(FILES, name)) {
      return send(
        404,
        JSON.stringify({ error: 'unknown_dataset', dataset: name || null }),
        {
          'Cache-Control': 'no-store',
        },
      );
    }

    try {
      const entry = await load(name);
      const etag = `W/"static-${name}-${entry.text.length}"`;
      if (req.headers['if-none-match'] === etag) {
        res.statusCode = 304;
        res.setHeader('ETag', etag);
        res.end();
        return;
      }
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        res.setHeader('Content-Length', String(Buffer.byteLength(entry.text)));
        res.setHeader('ETag', etag);
        res.end();
        return;
      }
      send(200, entry.text, { ETag: etag });
    } catch (error) {
      // 文件缺失属部署问题：如实报错，不返回空数据冒充成功
      send(
        500,
        JSON.stringify({
          error: 'static_dataset_unavailable',
          dataset: name,
          detail: String((error && error.message) || error).slice(0, 200),
        }),
        { 'Cache-Control': 'no-store' },
      );
    }
  };

  return {
    name: 'infra-static',
    configureServer({ middlewares }) {
      middlewares.use('/api/infra/static', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/infra/static', handler);
    },
  };
}
