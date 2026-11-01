import json, sys
path = sys.argv[1] if len(sys.argv) > 1 else r".gev-logs\lc\phase8e2\probe.json"
d = json.load(open(path, encoding="utf-8"))
acc = d["accesses"]
seen = set()
for a in acc:
    key = (a["id"], a["prop"])
    if key in seen or a["prop"] == "getDetectableObjects":
        continue
    seen.add(key)
    print(a["t"], a["id"], a["prop"])
    print("   ", a["stack"].replace("http://127.0.0.1:4183/", ""))
print("min t per prop:", sorted((min(x["t"] for x in acc if x["prop"] == p), p) for p in {x["prop"] for x in acc}))
