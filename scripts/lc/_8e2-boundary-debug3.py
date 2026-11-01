import io
import re
import json

P = r"D:\Hermes\gods-eye-view\scripts\package-boundaries.json"
s = io.open(P, encoding="utf-8", newline="").read()
group = "application-components"
module = "src/maps/baseTilePrefetch.js"
nl = "\r\n" if "\r\n" in s else "\n"
start = s.index('"%s": {' % group)
mod_at = s.index('"modules": [', start)
open_bracket = mod_at + len('"modules": ')
close = s.index("]", open_bracket)
print(repr(s[mod_at : close + 1][:400]))
body = s[open_bracket + 1 : close]
paths = re.findall(r'"([^"]+)"', body)
print("paths", len(paths), paths[-3:])
paths.append(module)
rendered = nl + ",\n".join('      "%s"' % p for p in paths) + nl + "    "
cand = s[: open_bracket + 1] + rendered + s[close:]
try:
    json.loads(cand)
    print("ok")
except Exception as exc:
    print("err", exc)
    idx = 81488
    print(repr(cand[idx - 150 : idx + 80]))
