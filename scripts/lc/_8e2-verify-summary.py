import json
import sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
keys = [
    "url", "dsf", "dpr", "bootInteractiveMs", "lcMountedMs", "maskGoneMs",
    "click", "fps", "errors", "paints", "domContentLoaded", "loadEnd",
    "cards", "innerBackdrop", "layerRows", "layerChunks", "lc", "edgeCfg",
]
for k in keys:
    if k in d:
        print(k, "=", json.dumps(d[k], ensure_ascii=False))
res = d.get("resources") or []
print("total js assets:", len(res))
print("layer chunks:", json.dumps(d.get("layerChunks"), ensure_ascii=False))
