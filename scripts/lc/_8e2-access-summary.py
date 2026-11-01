import json
import collections
import sys

path = sys.argv[1]
d = json.load(open(path, encoding="utf-8"))
print("count", d.get("pendingAccessCount"), "rows", d.get("rows"))
acc = d.get("pendingAccesses") or []
print(collections.Counter((a["id"], a["prop"]) for a in acc).most_common(20))
if acc:
    print("t range", min(a["t"] for a in acc), max(a["t"] for a in acc))
print("hydration", d.get("hydration"))
print("errors", d.get("errors"))
