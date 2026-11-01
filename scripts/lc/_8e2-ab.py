import json
import glob
import os

for path in sorted(glob.glob(r".gev-logs/lc/phase8e2/*.json")):
    name = os.path.basename(path)
    if not name.startswith(("ab-", "verify-8e", "verify-prod")):
        continue
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception:
        continue
    if "fps" not in d:
        continue
    chunks = d.get("layerChunks") or []
    rest = next((c for c in chunks if "Rest" in c["name"]), None)
    core = next((c for c in chunks if "Core" in c["name"]), None)
    print(
        name,
        "| fcp", d.get("paints", {}).get("first-contentful-paint"),
        "| interactive", d.get("bootInteractiveMs"),
        "| mask", d.get("maskGoneMs"),
        "| fps", d["fps"]["fps"], "p95", d["fps"]["p95"], "long", d["fps"]["long"],
        "| core", core and core["start"], "| rest", rest and rest["start"],
        "| rows", d.get("layerRows"), "| errs", len(d.get("errors") or []),
    )
