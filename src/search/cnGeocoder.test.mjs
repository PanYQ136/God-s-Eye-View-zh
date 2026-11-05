import test from 'node:test';
import assert from 'node:assert/strict';
import { createCnGeocoder, gcj02ToWgs84 } from './cnGeocoder.js';
import { createPlaceSearch } from './placeSearch.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

test('非中文查询直接 decline，且不发任何请求', async () => {
  let calls = 0;
  const provider = createCnGeocoder({
    fetchImpl: async () => {
      calls += 1;
      return json({ results: [] });
    },
  });
  for (const query of ['Hanoi', 'San Francisco', '121.5,31.2', '', '   ']) {
    assert.deepEqual(await provider.geocode(query), {
      place: null,
      answered: true,
    });
  }
  assert.equal(calls, 0);
});

test('crs=gcj02 做逆变换，wgs84 原样透传', async () => {
  const gcj = { lat: 26.07, lon: 119.29 };
  const shifted = createCnGeocoder({
    fetchImpl: async () =>
      json({
        crs: 'gcj02',
        results: [{ name: '福州市', lat: gcj.lat, lon: gcj.lon, kind: 'city' }],
      }),
  });
  const a = await shifted.geocode('福州市');
  const [lng, lat] = gcj02ToWgs84(gcj.lon, gcj.lat);
  assert.equal(a.place.lng, lng);
  assert.equal(a.place.lat, lat);
  assert.ok(Math.abs(a.place.lat - gcj.lat) > 1e-4);
  assert.equal(a.answered, true);
  assert.deepEqual(a.place.types, ['city']);

  const plain = createCnGeocoder({
    fetchImpl: async () =>
      json({
        crs: 'wgs84',
        results: [{ name: '鼓楼区', lat: 26.08, lon: 119.3, kind: 'district' }],
      }),
  });
  const b = await plain.geocode('鼓楼区');
  assert.equal(b.place.lat, 26.08);
  assert.equal(b.place.lng, 119.3);
});

test('每条结果的 crs 也认（顶层缺省时）', async () => {
  const provider = createCnGeocoder({
    fetchImpl: async () =>
      json({
        results: [{ name: '台江区', lat: 26.06, lon: 119.31, crs: 'gcj02' }],
      }),
  });
  const r = await provider.geocode('台江区');
  const [lng, lat] = gcj02ToWgs84(119.31, 26.06);
  assert.equal(r.place.lat, lat);
  assert.equal(r.place.lng, lng);
  assert.equal(r.place.label, '台江区');
});

test('空结果与 502 都算「已答复」，只有请求抛错才算未答复', async () => {
  const empty = createCnGeocoder({
    fetchImpl: async () => json({ results: [] }),
  });
  assert.deepEqual(await empty.geocode('福州市'), {
    place: null,
    answered: true,
  });

  const noResult = createCnGeocoder({
    fetchImpl: async () =>
      json({ error: 'no_result' }, { status: 502, ok: false }),
  });
  assert.deepEqual(await noResult.geocode('福州市'), {
    place: null,
    answered: true,
  });

  const offline = createCnGeocoder({
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.deepEqual(await offline.geocode('福州市'), {
    place: null,
    answered: false,
  });
});

test('取消后不发请求，且取消不会被当成「未答复」', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const provider = createCnGeocoder({
    fetchImpl: async () => {
      calls += 1;
      return json({ results: [] });
    },
  });
  await assert.rejects(
    provider.geocode('福州市', { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
});

test('国内通道无结果时链路继续走到下一个 provider', async () => {
  const order = [];
  const service = createPlaceSearch({
    providers: [
      createCnGeocoder({
        fetchImpl: async (url) => {
          order.push(new URL(url, 'http://local').pathname);
          return json({ results: [] });
        },
      }),
      {
        async geocode() {
          order.push('fallback');
          return { place: { lat: 1, lng: 2 }, answered: true };
        },
      },
    ],
  });
  const result = await service.geocode('福州市');
  assert.equal(result.place.lat, 1);
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(order, ['/api/mini/geocode', 'fallback']);
});
