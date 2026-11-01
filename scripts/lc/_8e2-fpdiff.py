"""Compare two computed-style fingerprints (Phase8D/8E criteria: diffElements must be 0)."""
import json
import sys

a = json.load(open(sys.argv[1], encoding="utf-8"))
b = json.load(open(sys.argv[2], encoding="utf-8"))
els_a, els_b = a["els"], b["els"]
keys = sorted(set(els_a) | set(els_b))
diffs = []
for key in keys:
    ra, rb = els_a.get(key), els_b.get(key)
    if ra is None or rb is None:
        diffs.append((key, "missing-in-" + ("b" if ra else "a")))
        continue
    for prop in sorted(set(ra) | set(rb)):
        if ra.get(prop) != rb.get(prop):
            diffs.append((key, prop, ra.get(prop), rb.get(prop)))
print(
    json.dumps(
        {
            "a": sys.argv[1],
            "b": sys.argv[2],
            "elementsA": len(els_a),
            "elementsB": len(els_b),
            "diffElements": len({d[0] for d in diffs}),
            "diffProps": len(diffs),
            "sample": diffs[:15],
        },
        ensure_ascii=False,
        indent=1,
    )
)
