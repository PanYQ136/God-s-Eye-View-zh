import io

path = r"D:\Hermes\gods-eye-view\src\data\manager.test.mjs"
with io.open(path, "r", encoding="utf-8", newline="") as f:
    src = f.read()
nl = "\r\n" if "\r\n" in src else "\n"

block = """
test('deferred registration is gated by the sealed registry', async () => {
  const manager = new DataLayerManager({});
  assert.throws(
    () => manager.registerDeferred({ id: 'flights' }),
    /finalized/,
  );
  manager.register(makeSlowLayer('flights').module);
  manager.finalizeRegistrations(
    [
      { id: 'flights', disposition: 'enabled-only' },
      { id: 'satellites', disposition: 'enabled-only' },
    ],
    { allowPending: true },
  );
  assert.deepEqual(manager.pendingLayerIds, ['satellites']);
  assert.equal(manager.pendingRegistrationComplete, false);
  assert.throws(
    () => manager.registerDeferred({ id: 'other' }),
    /not pending/,
  );
  const events = [];
  const stop = manager.subscribeActivity((change) => events.push(change));
  manager.registerDeferred(makeSlowLayer('satellites').module);
  stop();
  assert.deepEqual(manager.pendingLayerIds, []);
  assert.equal(manager.pendingRegistrationComplete, true);
  assert.deepEqual(
    events
      .filter((change) => change.type === 'layer-registered')
      .map((change) => change.layerId),
    ['satellites'],
  );
  assert.deepEqual(
    manager.getAll().map(({ id }) => id),
    ['flights', 'satellites'],
  );
  // A second registration of the same id stays refused.
  assert.throws(
    () => manager.registerDeferred(makeSlowLayer('satellites').module),
    /not pending/,
  );

  // The default (strict) seal keeps rejecting an incomplete registry.
  const strict = new DataLayerManager({});
  strict.register(makeSlowLayer('flights').module);
  assert.throws(
    () =>
      strict.finalizeRegistrations([
        { id: 'flights', disposition: 'enabled-only' },
        { id: 'satellites', disposition: 'enabled-only' },
      ]),
    /mismatch/,
  );
});
""".replace("\n", nl)

if not src.endswith(nl):
    src += nl
src += block
with io.open(path, "w", encoding="utf-8", newline="") as f:
    f.write(src)
print("ok", len(src))
