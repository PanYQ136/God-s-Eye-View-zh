import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAdsbLolAircraftState,
  normalizeAdsbLolPointResponse,
} from './adsbLolFallback.js';

test('normalizes adsb.lol units into an OpenSky-compatible state vector', () => {
  const state = normalizeAdsbLolAircraftState({
    hex: 'A1B2C3',
    flight: 'UAL123 ',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    alt_geom: 10200,
    gs: 200,
    track: 90,
    baro_rate: 600,
    seen_pos: 2,
    seen: 1,
    category: 'A3',
  }, 1000);

  assert.equal(state[0], 'a1b2c3');
  assert.equal(state[1], 'UAL123');
  assert.equal(state[2], null);
  assert.equal(state[3], 998);
  assert.equal(state[5], -97);
  assert.equal(state[6], 30);
  assert.equal(state[7], 3048);
  assert.ok(Math.abs(state[9] - 102.8888) < 0.001);
  assert.equal(state[10], 90);
  assert.ok(Math.abs(state[11] - 3.048) < 0.001);
  assert.equal(state[13], 3108.96);
  assert.equal(state[17], 4);
});

test('keeps grounded fallback contacts and rejects rows without positions', () => {
  const normalized = normalizeAdsbLolPointResponse({
    now: 1_700_000_000_000,
    ac: [
      { hex: 'abc123', lat: 0, lon: 0, alt_baro: 'ground', gs: 8 },
      { hex: 'def456', lat: null, lon: 10, alt_baro: 5000 },
    ],
  });

  assert.equal(normalized.time, 1_700_000_000);
  assert.equal(normalized.states.length, 1);
  assert.equal(normalized.states[0][7], null);
  assert.equal(normalized.states[0][8], true);
});


// 2026-11-10: adsb.fi's /api/v2/lat/... returns `aircraft`, adsb.lol returns
// `ac`. Both must feed the same OpenSky-shaped normalizer.
test('normalizeAdsbLolPointResponse accepts adsb.fi aircraft[] as well as ac[]', () => {
  const row = {
    hex: '7817ff',
    flight: 'CXA8704 ',
    lat: 26.1,
    lon: 119.2,
    alt_baro: 32000,
    gs: 487.3,
    track: 46.08,
    seen: 1.2,
    seen_pos: 0.8,
  };
  const fromFi = normalizeAdsbLolPointResponse({ now: 1794308594, aircraft: [row] });
  const fromLol = normalizeAdsbLolPointResponse({ now: 1794308594, ac: [row] });
  assert.equal(fromFi.states.length, 1);
  assert.deepEqual(fromFi.states, fromLol.states);
  assert.equal(fromFi.states[0][0], '7817ff');
  assert.equal(normalizeAdsbLolPointResponse({ now: 1, ac: 'bad' }).states.length, 0);
});
