// 只读：检查 prod(4174)/dev(4173) 静态资源的缓存响应头，用于「二次冷启动」缓存策略判定。
const urls = [
  'http://127.0.0.1:4174/',
  'http://127.0.0.1:4174/assets/index-CjLhObsW.js',
  'http://127.0.0.1:4174/cesium/Cesium.js',
  'http://127.0.0.1:4174/gev-edge-lens.js',
  'http://127.0.0.1:4173/@vite/client',
];
const keys = ['cache-control', 'etag', 'last-modified', 'content-encoding', 'content-length', 'vary'];
for (const url of urls) {
  try {
    const res = await fetch(url, { method: 'GET' });
    const out = {};
    for (const k of keys) out[k] = res.headers.get(k);
    console.log(`${url}\n  status=${res.status} ${JSON.stringify(out)}`);
    await res.body?.cancel?.();
  } catch (e) {
    console.log(`${url}\n  ERROR ${e.message}`);
  }
}
