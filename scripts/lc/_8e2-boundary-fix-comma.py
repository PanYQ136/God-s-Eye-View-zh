import io
import json
import re

P = r"D:\Hermes\gods-eye-view\scripts\package-boundaries.json"
s = io.open(P, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
lines = s.split(nl)
for i, line in enumerate(lines):
    m = re.match(r'^(\s+)"([^"]+)"$', line)
    if m:
        lines[i] = line + ","
fixed = nl.join(lines)
try:
    json.loads(fixed)
except Exception as exc:  # noqa: BLE001
    print("STILL BROKEN:", exc)
    raise
io.open(P, "w", encoding="utf-8", newline="").write(fixed)
print("fixed ok")
