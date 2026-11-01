import io

path = r"D:\Hermes\gods-eye-view\src\data\layerState.test.mjs"
with io.open(path, "r", encoding="utf-8", newline="") as f:
    src = f.read()
nl = "\r\n" if "\r\n" in src else "\n"

block = """
test('a deferred layer applies its stored visibility the moment its instance registers', async () => {
  const pendingId = 'satellites';
  const manager = new DataLayerManager({});
  for (const id of REGISTERED_LAYER_IDS) {
    if (id === pendingId) continue;
    manager.register(fakeLayer(id));
  }
  manager.finalizeRegistrations(LAYER_STATE_REGISTRY, { allowPending: true });
  assert.deepEqual(manager.pendingLayerIds, [pendingId]);

  const stored = createDefaultLayerState();
  stored.enabledLayerIds = [pendingId];
  const coordinator = new LayerStateCoordinator(manager, shareSink(), {
    storage: memoryStorage(serializeStoredLayerState(stored)),
  });
  const results = await coordinator.start();
  const deferredResult = results.find((entry) => entry.layerId === pendingId);
  assert.equal(deferredResult.phase, 'deferred');
  assert.equal(deferredResult.succeeded, true);
  assert.equal(manager.layers.has(pendingId), false);

  // The factory chunk arrives after startup: registration must apply the
  // visibility the restore was never allowed to drop.
  manager.registerDeferred(fakeLayer(pendingId));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manager.isEnabled(pendingId), true);
  assert.deepEqual(manager.pendingLayerIds, []);
  assert.equal(coordinator.getDurableState().enabledLayerIds.includes(pendingId), true);
  coordinator.destroy();
});
""".replace("\n", nl)

if not src.endswith(nl):
    src += nl
src += block
with io.open(path, "w", encoding="utf-8", newline="") as f:
    f.write(src)
print("ok", len(src))
