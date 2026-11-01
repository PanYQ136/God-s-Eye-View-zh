import json, collections, sys

path = sys.argv[1] if len(sys.argv) > 1 else r".gev-logs\lc\phase8e2\probe.json"
d = json.load(open(path, encoding="utf-8"))
print({k: d.get(k) for k in ("bootInteractiveMs", "maskGoneMs", "paint", "rows", "accessCount", "errors")})
print("marks:", [(m["name"], m["t"]) for m in d.get("marks", [])])
print("layerRes:", d.get("layerRes"))
acc = d.get("accesses", [])
print("n accesses:", len(acc))
ts = sorted(a["t"] for a in acc)
if ts:
    print("first t:", ts[:5], "last t:", ts[-3:])
c = collections.Counter((a["id"], a["prop"]) for a in acc)
for k, v in c.most_common(50):
    print(v, k)
