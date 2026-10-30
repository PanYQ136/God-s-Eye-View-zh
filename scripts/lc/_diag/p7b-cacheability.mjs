// 只读探针：首屏 A 类网络资源的可缓存性（同源代理路径 vs 直连），决定「提前发起」是否真的能命中缓存。
const targets = [
  'http://127.0.0.1:4174/ArcGIS/rest/services/World_Imagery/MapServer/?f=json',
  'http://127.0.0.1:4174/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/3405/6789',
  'http://127.0.0.1:4174/v1/assets/2275207/endpoint',
];
const keys = ['cache-control', 'expires', 'etag', 'access-control-allow-origin', 'content-type'];
for (const url of targets) {
  console.log(`\n${url}`);
  for (let i = 0; i < 2; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { method: 'GET' });
      const buf = await res.arrayBuffer();
      const ms = (performance.now() - t0).toFixed(1);
      const h = {};
      for (const k of keys) if (res.headers.get(k)) h[k] = res.headers.get(k);
      console.log(`  #${i + 1} status=${res.status} bytes=${buf.byteLength} ms=${ms} ${JSON.stringify(h)}`);
    } catch (e) {
      console.log(`  #${i + 1} ERROR ${e.message}`);
    }
  }
}
