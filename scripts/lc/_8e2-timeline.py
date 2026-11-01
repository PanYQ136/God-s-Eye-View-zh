import json
import sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
print("paint", d.get("paint"))
print("hydration", json.dumps(d.get("hydration")))
print("bootInteractiveMs", d.get("bootInteractiveMs"), "maskGoneMs", d.get("maskGoneMs"))
print("layerRes", json.dumps(d.get("layerRes")))
for m in d.get("marks", []):
    print(" ", m["t"], m["name"])
