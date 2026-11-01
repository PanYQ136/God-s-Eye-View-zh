import io
import re
import json

P = r"D:\Hermes\gods-eye-view\scripts\package-boundaries.json"
s = io.open(P, encoding="utf-8", newline="").read()
print("has CRLF:", "\r\n" in s, "has lone LF:", s.count("\n") - s.count("\r\n"))
group = "live-observations"
module = "src/sources/live/resilientFetch.js"
nl = "\r\n" if "\r\n" in s else "\n"
start = s.index('"%s": {' % group)
mod_at = s.index('"modules": [', start)
open_bracket = mod_at + len('"modules": ')
close = s.index("]", open_bracket)
body = s[open_bracket + 1 : close]
paths = re.findall(r'"([^"]+)"', body)
paths.append(module)
rendered = nl + ",\n".join('      "%s"' % p for p in paths) + nl + "    "
cand = s[: open_bracket + 1] + rendered + s[close:]
try:
    json.loads(cand)
    print("candidate ok")
except Exception as exc:
    print("error:", exc)
    idx = 32525
    print("around idx:", repr(cand[idx - 120 : idx + 120]))
