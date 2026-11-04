// PROVIDER WARMUP — when background upstream probing is allowed to start.
//
// The /api/sources/health warmup used to be scheduled inside the plugin
// factory. Any import of the provider list (a unit test, a route-capture
// script, a build step) then fired 40+ real requests 1.5 s later into whatever
// fetch the caller had installed, and held one-shot processes open. Warmup is a
// server lifecycle concern: it belongs in configureServer / configurePreviewServer.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { localProviderPlugins } from '../../server/providers/local.js';
import { miniSourcesProxy } from '../../server/providers/mini-sources.js';

const WARMUP_DELAY_MS = 1500;
const SETTLE_MS = WARMUP_DELAY_MS + 800;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stand in for the process-wide fetch and record every upstream URL. */
async function withFetchProbe(run) {
  const previous = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    return await run(urls);
  } finally {
    globalThis.fetch = previous;
  }
}

test('constructing the provider list schedules no upstream traffic', async () => {
  await withFetchProbe(async (urls) => {
    const plugins = localProviderPlugins();
    assert.ok(plugins.some((plugin) => plugin?.name === 'mini-sources'));
    await wait(SETTLE_MS);
    assert.deepEqual(
      urls,
      [],
      'constructing plugins is not a server start; it must not probe upstreams',
    );
  });
});

test('mounting the health plugin still schedules the background warmup', async () => {
  await withFetchProbe(async (urls) => {
    const plugin = miniSourcesProxy();
    plugin.configureServer({ middlewares: { use() {} } });
    // Poll instead of assuming the timer lands on time on a loaded runner.
    const deadline = Date.now() + SETTLE_MS + 2000;
    while (!urls.length && Date.now() < deadline) await wait(50);
    assert.ok(urls.length > 0, 'a mounted server still warms the health cache');
    assert.ok(
      urls.some((url) => url.includes('pocketworld.org/api/flights')),
      'the warmup probes the configured health channels',
    );
  });
});
