"""Normalize package-boundaries.json: every `modules` array entry gets a trailing comma."""
import io
import json
import re

P = r"D:\Hermes\gods-eye-view\scripts\package-boundaries.json"
src = io.open(P, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in src else "\n"
lines = src.split(nl)
out = []
in_modules = False
for line in lines:
    if '"modules": [' in line:
        in_modules = True
        out.append(line)
        continue
    if in_modules:
        stripped = line.strip()
        if stripped.startswith(']'):
            in_modules = False
            out.append(line)
            continue
        m = re.match(r'^(\s+)"([^"]+)"(,?)$', line)
        if m:
            out.append('%s"%s",' % (m.group(1), m.group(2)))
            continue
    out.append(line)
fixed = nl.join(out)
json.loads(fixed)  # raises if still broken
io.open(P, "w", encoding="utf-8", newline="").write(fixed)
print("normalized ok")
