/**
 * Imagery proxy — NASA Worldview Snapshot（近期影像层）。
 *
 * 为什么要有它：WVS 只能由客户端直连 `wvs.earthdata.nasa.gov`，而
 *   1) 大陆网络直连不稳（实测 devtools 里 `net::ERR_CONNECTION_CLOSED`）；
 *   2) 小程序里 `<image>` 已不再支持 HTTP 协议，需要一个同源的 http(s) 端点。
 * 这里把「探测是否有数据 + 取图」都收到本地服务端（Node fetch 可走本地代理），
 * 客户端只认一个地址。
 *
 * 路由：
 *   GET /api/imagery/available?layer=<id>&days=3&bbox=w,s,e,n
 *       → { layer, days: [{day, present, error}], best: 'YYYY-MM-DD'|null }
 *   GET /api/imagery/snapshot?layer=<id>&day=YYYY-MM-DD&bbox=w,s,e,n&width=&height=
 *       → image/jpeg 原样透传（失败给 JSON + 合适状态码）
 *   GET /api/imagery/layers → 可用图层名
 *
 * 与网页版一致：WVS 的 BBOX 是 **南,西,北,东**，WIDTH/HEIGHT 任意；
 * HLS 的 S30/L30 在 WVS 上只有空图（只存在于 GIBS 瓦片），这里直接标不可用。
 */
const WVS_HOST = 'https://wvs.earthdata.nasa.gov';
const UPSTREAM_TIMEOUT_MS = 25_000;
const PROBE_TIMEOUT_MS = 6_000; // 单天探测超时：NASA 在大陆常连不通，25s×N 天会把首屏拖死
const PROBE_TTL_HIT = 60 * 60_000; // 探测到有观测：缓存 1 小时
const PROBE_TTL_MISS = 10 * 60_000; // 探测不到：缓存 10 分钟，别每次都重试
const probeCache = new Map(); // layer|days|bbox -> { at, ttl, body }

/** 实测可用（GetSnapshot 返回 image/jpeg + Data-Present: true）的真彩层 */
const LAYERS = {
  VIIRS_NOAA21_CorrectedReflectance_TrueColor: 'VIIRS NOAA-21 真彩',
  VIIRS_SNPP_CorrectedReflectance_TrueColor: 'VIIRS SNPP 真彩',
  VIIRS_NOAA20_CorrectedReflectance_TrueColor: 'VIIRS NOAA-20 真彩',
  MODIS_Terra_CorrectedReflectance_TrueColor: 'MODIS Terra 真彩',
  MODIS_Aqua_CorrectedReflectance_TrueColor: 'MODIS Aqua 真彩',
};

/** 实测在 WVS 上拿不到（200 但 Data-Present=false、334 B 空 PNG） */
const TILE_ONLY = {
  MODIS_Terra_CorrectedReflectance_Bands721: 'HLS S30 (Bands721)',
  MODIS_Aqua_CorrectedReflectance_Bands721: 'HLS L30 (Bands721)',
};

function clampNum(v, lo, hi, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(lo, Math.min(hi, n));
}

function normalizeBox(raw) {
  const v = String(raw || '')
    .split(',')
    .map(Number);
  if (v.length < 4 || !v.slice(0, 4).every(Number.isFinite)) return null;
  let [w, s, e, n] = v;
  if (e < w) {
    const t = w;
    w = e;
    e = t;
  }
  if (n < s) {
    const t = s;
    s = n;
    n = t;
  }
  w = Math.max(-180, w);
  e = Math.min(180, e);
  s = Math.max(-85, s);
  n = Math.min(85, n);
  if (!(e > w) || !(n > s)) return null;
  return { w, s, e, n };
}

function isoDay(offset) {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function snapshotUrl(layer, day, box, width, height) {
  return (
    `${WVS_HOST}/api/v1/snapshot?REQUEST=GetSnapshot` +
    `&LAYERS=${encodeURIComponent(layer)}&CRS=EPSG:4326` +
    `&TIME=${day}&BBOX=${box.s},${box.w},${box.n},${box.e}` +
    `&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/jpeg`
  );
}

export function imageryProxy() {
  const installMiddleware = (server) => {
    server.middlewares.use('/api/imagery', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const layer = String(url.searchParams.get('layer') || '');

        if (url.pathname === '/layers') {
          sendJson(200, {
            available: Object.keys(LAYERS).map((id) => ({
              id,
              label: LAYERS[id],
            })),
            tileOnly: Object.keys(TILE_ONLY).map((id) => ({
              id,
              label: TILE_ONLY[id],
              reason: 'WVS 快照返回空图（仅存在于 GIBS WMTS 瓦片）',
            })),
            source: 'NASA GIBS / Worldview Snapshot',
          });
          return;
        }

        if (!layer) {
          sendJson(400, { error: 'missing layer' });
          return;
        }
        if (TILE_ONLY[layer]) {
          sendJson(409, {
            error: 'layer_tile_only',
            layer,
            note:
              TILE_ONLY[layer] +
              ' 在 WVS 上只有空图（200 但 Data-Present=false / 334 B PNG），请改用真彩层',
          });
          return;
        }
        if (!LAYERS[layer]) {
          sendJson(400, {
            error: 'unknown_layer',
            layer,
            known: Object.keys(LAYERS),
          });
          return;
        }

        const box = normalizeBox(url.searchParams.get('bbox'));
        if (!box) {
          sendJson(400, { error: 'invalid_bbox', note: '需要 bbox=w,s,e,n' });
          return;
        }
        const width = Math.round(
          clampNum(url.searchParams.get('width'), 128, 2048, 1024),
        );
        const height = Math.round(
          clampNum(url.searchParams.get('height'), 128, 2048, 512),
        );

        // 探测模式：最近 N 天哪天有有效观测
        if (url.pathname === '/available') {
          const days = Math.round(
            clampNum(url.searchParams.get('days'), 1, 7, 3),
          );
          const ck =
            layer + '|' + days + '|' + [box.w, box.s, box.e, box.n].join(',');
          const hit = probeCache.get(ck);
          if (hit && Date.now() - hit.at < hit.ttl) {
            sendJson(200, { ...hit.body, cached: true });
            return;
          }
          // 并行探测：每天一个 HEAD，6s 超时。串行时「25s × 3 天」= 首屏等 75s，
          // 并行后最坏 6s，且结果缓存，第二次进来是 0ms。
          const list = [];
          for (let i = 0; i <= days; i += 1) list.push(isoDay(-i));
          const probes = await Promise.all(
            list.map((day) =>
              fetch(snapshotUrl(layer, day, box, 256, 256), {
                method: 'HEAD',
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
              })
                .then((r) => ({
                  day,
                  present:
                    String(
                      r.headers.get('data-present') || '',
                    ).toLowerCase() === 'true',
                  status: r.status,
                }))
                .catch((err) => ({
                  day,
                  present: false,
                  error: (err && err.message) || String(err),
                })),
            ),
          );
          const best = (probes.find((d) => d.present) || {}).day || null;
          const body = {
            layer,
            bbox: box,
            days: probes,
            best,
            dataPresent: !!best,
            note: best ? null : `最近 ${probes.length} 天该视口无有效卫星成像`,
            source: 'NASA Worldview Snapshot',
          };
          if (probeCache.size > 60)
            probeCache.delete(probeCache.keys().next().value);
          probeCache.set(ck, {
            at: Date.now(),
            ttl: best ? PROBE_TTL_HIT : PROBE_TTL_MISS,
            body,
          });
          sendJson(200, body);
          return;
        }

        if (url.pathname === '/snapshot') {
          const day = /^\d{4}-\d{2}-\d{2}$/.test(
            String(url.searchParams.get('day') || ''),
          )
            ? String(url.searchParams.get('day'))
            : isoDay(0);
          const upstream = await fetch(
            snapshotUrl(layer, day, box, width, height),
            {
              signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            },
          );
          if (!upstream.ok) {
            sendJson(502, { error: 'wvs_' + upstream.status, layer, day });
            return;
          }
          const present = String(
            upstream.headers.get('data-present') || '',
          ).toLowerCase();
          if (present === 'false') {
            sendJson(404, {
              error: 'no_observation',
              layer,
              day,
              note: '该日该视口无有效观测（Data-Present=false），未返回图片',
            });
            return;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          if (buf.length < 512) {
            // 空图哨兵（实测 334 B）
            sendJson(404, {
              error: 'empty_image',
              layer,
              day,
              bytes: buf.length,
            });
            return;
          }
          res.writeHead(200, {
            'Content-Type':
              upstream.headers.get('content-type') || 'image/jpeg',
            'Cache-Control': 'public, max-age=1800',
            'X-Imagery-Day': day,
            'X-Imagery-Layer': layer,
            'X-Imagery-Bytes': String(buf.length),
          });
          res.end(buf);
          return;
        }

        sendJson(404, { error: 'not_found', path: url.pathname });
      } catch (err) {
        console.warn('[imagery-proxy] error:', err?.message || err);
        sendJson(500, {
          error: 'imagery proxy error',
          detail: err?.message || String(err),
        });
      }
    });
  };

  return {
    name: 'imagery-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
