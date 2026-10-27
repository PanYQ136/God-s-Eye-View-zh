// PHOTON_URL: unset keeps the public default, empty disables, else a URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultPlaceSearch } from './defaults.js';

async function hosts(endpoints) {
  const asked = [];
  const search = createDefaultPlaceSearch({
    endpoints,
    fetchImpl: async (url) => {
      asked.push(new URL(String(url), 'http://local.test').host);
      return new Response(
        JSON.stringify({ features: [], status: 'ZERO_RESULTS', results: [] }),
        { status: 200 },
      );
    },
  });
  await search.geocode('nowhere-photon-setting');
  return asked;
}

test('place search follows the Photon setting', async () => {
  assert.ok(
    (await hosts({})).includes('photon.komoot.io'),
    'default is public Photon',
  );
  const own = await hosts({ photon: 'https://photon.example.test/api/' });
  assert.ok(own.includes('photon.example.test'));
  assert.ok(!own.includes('photon.komoot.io'));
  const off = await hosts({ photon: null });
  assert.ok(!off.some((host) => host.includes('photon')), off.join(','));
});
