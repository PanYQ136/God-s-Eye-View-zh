import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../app/startupChrome.js', import.meta.url),
  'utf8',
)
  .replace(/^import .*;\n/gm, '')
  .replace('export function', 'function');

function fixture() {
  const timers = new Map();
  const listeners = new Map();
  const events = [];
  const bridgeCalls = [];
  const refining = [];
  let restored;
  let nextTimer = 0;
  const controller = new AbortController();
  const context = {
    console,
    /* Phase7A-D added the veil removal (`#cesiumContainer` loses
       `boot-refining` on the frame the map is actually sharp) next to the
       cover hide. The sandbox models the one element that call touches so the
       sequence stays observable instead of throwing ReferenceError. */
    document: {
      getElementById(id) {
        if (id !== 'cesiumContainer') return null;
        return { classList: { remove: (name) => refining.push(name) } };
      },
    },
    /* Phase8D #15: the boot gate is reached through the explicit module bus
       (`import * as bridge` + `bridge.get('boot')`), not through a `window.*`
       global. The sandbox has to model that dependency like it already models
       initFirstRunExperience: a bus with no `boot` slot is the old "no gate →
       reveal as soon as restoration settles" behaviour, and the call itself is
       recorded so the wiring stays pinned. */
    bridge: {
      get(name) {
        bridgeCalls.push(name);
        return undefined;
      },
    },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    initFirstRunExperience() {
      events.push('welcome');
      return { destroy: () => events.push('welcome:destroy') };
    },
    async initKeySetup() {
      return { destroy: () => events.push('settings:destroy') };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const stop = context.startApplicationChrome({
    initializeSettings: context.initKeySetup,
    loadingScreen: {
      classList: { add: (value) => events.push(value) },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
    styleManager: {
      initialRestorePromise: new Promise((resolve) => {
        restored = resolve;
      }),
    },
    dataManager: {},
    signal: controller.signal,
  });
  return {
    events,
    listeners,
    bridgeCalls,
    refining,
    stop,
    restored,
    controller,
    fire(delay) {
      for (const [id, task] of timers) {
        if (task.delay === delay) {
          timers.delete(id);
          task.fn();
        }
      }
    },
    timers,
  };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test('welcome waits for restoration, minimum delay, and the cover transition', async () => {
  const f = fixture();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, []);
  assert.ok(f.bridgeCalls.includes('boot'), 'the cover must consult the boot gate before it hides');
  f.restored();
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  assert.deepEqual(f.refining, ['boot-refining'], 'the map veil comes off on the same frame the cover hides');
  f.listeners.get('transitionend')();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'welcome']);
  await f.stop();
  assert.deepEqual(f.events.slice(-2), ['welcome:destroy', 'settings:destroy']);
  assert.equal(f.timers.size, 0);
});

test('reduced motion uses the bounded fallback after the cover hides', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'welcome']);
  await f.stop();
});

test('shutdown while restore is pending never reveals late welcome UI', async () => {
  const f = fixture();
  f.controller.abort();
  await f.stop();
  f.restored();
  await flush();
  f.fire(1000);
  f.fire(900);
  assert.deepEqual(f.events, ['settings:destroy']);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});

test('shutdown during the cover transition cancels the listener and fallback', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  const transition = f.listeners.get('transitionend');
  f.controller.abort();
  await f.stop();
  transition();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'settings:destroy']);
});
