import io
import re
import json

P = r"D:\Hermes\gods-eye-view\scripts\package-boundaries.json"
s = io.open(P, encoding="utf-8", newline="").read()
group = "live-observations"
module = "src/sources/live/resilientFetch.js"
nl = "\r\n" if "\r\n" in s else "\n"
start = s.index('"%s": {' % group)
mod_at = s.index('"modules": [', start)
open_bracket = mod_at + len('"modules": ')
close = s.index("]", open_bracket)
body = s[open_bracket + 1 : close]
paths = re.findall(r'"([^"]+)"', body)
print("group lines:")
print(s[start : close + 1][:1500])
print("n paths", len(paths), paths[:3])
paths.append(module)
rendered = nl + ",\n".join('      "%s"' % p for p in paths) + nl + "    "
cand = s[: open_bracket + 1] + rendered + s[close:]
lines = cand.split(nl)
for i in range(1034, 1042):
    print(i + 1, repr(lines[i]))
