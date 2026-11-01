"""Repair package-boundaries.json after a bad sorted rebuild."""
import io
import json
import re
import subprocess

ROOT = r"D:\Hermes\gods-eye-view"
P = ROOT + r"\scripts\package-boundaries.json"

PHASE8E_MODULES = [
    "src/cesium.js",
    "src/bridge.js",
    "src/app/catalogFactoriesCore.js",
    "src/app/catalogFactoriesRest.js",
    "src/overlays/worldOverlay/primitives.js",
    "src/voice/actions/vocabulary.js",
]

broken = io.open(P, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in broken else "\n"

lines = broken.split(nl)
in_modules = False
for i, line in enumerate(lines):
    if '"modules": [' in line:
        in_modules = True
        continue
    if in_modules:
        stripped = line.strip()
        if stripped.startswith("]"):
            in_modules = False
            continue
        m = re.match(r'^(\s+)"([^"]+)"$', line)
        if m:
            lines[i] = line + ","
tolerant = nl.join(lines)
tolerant = re.sub(r",(\s*[\]\}])", r"\1", tolerant)
data = json.loads(tolerant)
paths_by_group = {
    name: set(group.get("modules", [])) for name, group in data.items()
}

subprocess.run(
    ["git", "checkout", "--", "scripts/package-boundaries.json"],
    cwd=ROOT,
    check=True,
)

s = io.open(P, encoding="utf-8", newline="").read()


def insert(group, module):
    global s
    nl_local = "\r\n" if "\r\n" in s else "\n"
    start = s.index('"%s": {' % group)
    mod_at = s.index('"modules": [', start)
    close = s.index("]", mod_at)
    body = s[mod_at:close]
    if ('"%s"' % module) in body:
        return False
    body_lines = body.rstrip().split(nl_local)
    last = body_lines[-1].rstrip()
    if last.endswith(","):
        last = last[:-1]
    if '"' not in last:
        raise SystemExit("unexpected modules tail: %r" % body_lines[-1])
    indent = re.match(r"(\s*)", body_lines[-1]).group(1)
    body_lines[-1] = last + ","
    body_lines.append(indent + '"%s"' % module)
    new_body = nl_local.join(body_lines) + nl_local + "    "
    s = s[:mod_at] + new_body + s[close:]
    return True


added = 0
for module in PHASE8E_MODULES:
    for group, modules in paths_by_group.items():
        if module in modules and insert(group, module):
            added += 1
json.loads(s)
io.open(P, "w", encoding="utf-8", newline="").write(s)
print("restored + re-registered", added, "entries")
