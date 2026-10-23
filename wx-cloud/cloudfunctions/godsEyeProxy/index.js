// 微信云函数：godsEyeProxy
// 作用：把小程序的 wx.cloud.callFunction 请求，反向代理到你家的 gods-eye API（经睿易内网穿透域名）。
// 好处：正式版小程序调用云函数【不走 request 合法域名白名单】，所以不需要备案域名/HTTPS 证书；
//      真正抓上游数据发生在你家里（家宽 IP），OpenSky 之类排斥云 IP 的源也能正常取到。
//
// 部署后，在云开发控制台 → 云函数 → godsEyeProxy → 配置 → 环境变量：
//   GEV_BASE = 睿易内网穿透给你家的地址，例如 http://abcd1234.reyee.xxx:12345
// 并把「超时时间」设为 20~60 秒。
//
// 调用示例（小程序端）：
//   wx.cloud.callFunction({ name:'godsEyeProxy', data:{ path:'/api/cyclones' } })
//   wx.cloud.callFunction({ name:'godsEyeProxy', data:{ path:'/api/cn/quakes' } })
//   wx.cloud.callFunction({ name:'godsEyeProxy', data:{ path:'/api/opensky', query:{ bbox:'110,20,125,35' } } })

const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');

const BASE = process.env.GEV_BASE || '';

function fetchUrl(url, timeout = 25000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('bad url: ' + url)); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'wx-cloud-gods-eye/1.0',
          'Accept': 'application/json, text/plain, */*',
          // 睿易穿透若需要可在这里加鉴权头
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('upstream timeout after ' + timeout + 'ms')));
    req.end();
  });
}

function normalizePath(event) {
  let p = event.path || event.api || event.url || '';
  if (!p) return null;
  // 去掉可能的 scheme/host，只留 path
  p = String(p).replace(/^https?:\/\/[^/]+/i, '');
  if (!p.startsWith('/')) p = '/' + p;
  // 允许传 'cyclones' / 'api/cyclones' / '/api/cyclones'
  if (!p.startsWith('/api/')) p = '/api/' + p.replace(/^\/+/, '').replace(/^api\//, '');
  return p;
}

function buildQuery(event) {
  const q = event.query ?? event.params ?? null;
  if (!q) return '';
  if (typeof q === 'string') return q ? (q.startsWith('?') ? q : '?' + q) : '';
  if (typeof q === 'object') {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v === undefined || v === null) continue;
      sp.append(k, String(v));
    }
    const s = sp.toString();
    return s ? '?' + s : '';
  }
  return '';
}

exports.main = async (event = {}) => {
  if (!BASE) {
    return { ok: false, error: 'GEV_BASE 未配置：请在云函数环境变量里填入睿易穿透域名，例如 http://abc.reyee.xxx:12345' };
  }
  const path = normalizePath(event);
  if (!path) return { ok: false, error: '缺少 path 参数，例如 {path:"/api/cyclones"}' };

  const url = BASE.replace(/\/+$/, '') + path + buildQuery(event);
  try {
    const r = await fetchUrl(url);
    let data = r.body;
    try { data = JSON.parse(r.body); } catch (_) { /* 保留原始文本 */ }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      path,
      url: url.replace(/([?&])(key|token)=[^&]*/gi, '$1$2=***'), // 日志脱敏
      data,
    };
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      path,
      hint: '确认你电脑开着、gods-eye(4173)在跑、睿易穿透已开启且 GEV_BASE 正确',
    };
  }
};
