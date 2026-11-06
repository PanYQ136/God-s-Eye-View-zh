import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectBaseSourceRegion,
  hasChinaLocaleHint,
} from './sourcePreference.js';

const OK = () => Promise.resolve();
const FAIL = () => Promise.reject(new Error('blocked'));

const makeFetch = ({ cn = true, global = true } = {}) => {
  return (url) => {
    if (/autonavi\.com/.test(url)) return cn ? OK() : FAIL();
    if (/gstatic\.com/.test(url)) return global ? OK() : FAIL();
    return FAIL();
  };
};

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    _map: map,
  };
};

test('CN 网络探测（高德通、Google 断）→ cn', async () => {
  const storage = fakeStorage();
  const result = await detectBaseSourceRegion({
    fetchImpl: makeFetch({ cn: true, global: false }),
    sessionStorage: storage,
    timeZone: 'Europe/London',
  });
  assert.equal(result.region, 'cn');
  assert.match(result.reason, /cn reachable/);
});

test('全球网络探测（Google 通、高德断）→ global', async () => {
  const result = await detectBaseSourceRegion({
    fetchImpl: makeFetch({ cn: false, global: true }),
    sessionStorage: fakeStorage(),
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(result.region, 'global');
});

test('双通时以时区/语言倾向破平（海外保持 global）', async () => {
  const result = await detectBaseSourceRegion({
    fetchImpl: makeFetch({ cn: true, global: true }),
    sessionStorage: fakeStorage(),
    timeZone: 'America/New_York',
  });
  assert.equal(result.region, 'global');
});

test('双通且 CN 时区 → cn（VPN 场景尊重倾向）', async () => {
  const result = await detectBaseSourceRegion({
    fetchImpl: makeFetch({ cn: true, global: true }),
    sessionStorage: fakeStorage(),
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(result.region, 'cn');
});

test('双不通按倾向兜底，未知环境保持 global', async () => {
  const result = await detectBaseSourceRegion({
    fetchImpl: makeFetch({ cn: false, global: false }),
    sessionStorage: fakeStorage(),
    timeZone: 'Asia/Tokyo',
  });
  assert.equal(result.region, 'global');
});

test('会话缓存命中后不再探测', async () => {
  const storage = fakeStorage();
  storage.setItem('gev:base-source-preference', 'cn');
  let calls = 0;
  const result = await detectBaseSourceRegion({
    fetchImpl: (url) => {
      calls += 1;
      return OK();
    },
    sessionStorage: storage,
  });
  assert.equal(result.region, 'cn');
  assert.equal(result.reason, 'session-cache');
  assert.equal(calls, 0);
});

test('结论写入会话缓存', async () => {
  const storage = fakeStorage();
  await detectBaseSourceRegion({
    fetchImpl: makeFetch({ cn: true, global: false }),
    sessionStorage: storage,
  });
  assert.equal(storage.getItem('gev:base-source-preference'), 'cn');
});

test('hasChinaLocaleHint 识别 CN 时区', () => {
  assert.equal(hasChinaLocaleHint('Asia/Shanghai'), true);
  assert.equal(hasChinaLocaleHint('Asia/Urumqi'), true);
  assert.equal(hasChinaLocaleHint('America/Los_Angeles'), false);
});
