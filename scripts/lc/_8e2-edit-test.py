import io

path = r"D:\Hermes\gods-eye-view\src\app\constructCatalog.test.mjs"
with io.open(path, "r", encoding="utf-8", newline="") as f:
    src = f.read()
nl = "\r\n" if "\r\n" in src else "\n"

pairs = [
    (
        "  assert.equal(services.satellitesLayer.id, 'satellites');",
        "  const satellitesHandle = services.satellitesLayer;" + nl
        + "  assert.equal(satellitesHandle.id, 'satellites');",
    ),
    (
        "    typeof services.satellitesLayer.getDetectableObjects,",
        "    typeof satellitesHandle.getDetectableObjects,",
    ),
    (
        "  assert.equal(typeof services.satellitesLayer.getDetectableObjects, 'function');",
        "  assert.equal(typeof satellitesHandle.getDetectableObjects, 'function');",
    ),
    (
        "  assert.equal(" + nl
        + "    services.satellitesLayer," + nl
        + "    services.satellitesLayer," + nl
        + "    'the handle stays identity-stable after materialization'," + nl
        + "  );",
        "  assert.equal(" + nl
        + "    catalog.resolve('satellites')," + nl
        + "    catalog.get('satellites')," + nl
        + "    'a materialized layer resolves to the real instance'," + nl
        + "  );",
    ),
]
for old, new in pairs:
    assert src.count(old) == 1, (src.count(old), old[:50])
    src = src.replace(old, new, 1)

with io.open(path, "w", encoding="utf-8", newline="") as f:
    f.write(src)
print("ok")
