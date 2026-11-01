"""Repair package-boundaries.json after a bad sorted rebuild.

1. Read the (broken) file leniently to recover group -> module memberships.
2. Restore the HEAD version with `git checkout`.
3. Re-insert the Phase8E registrations (which existed only in the broken file).
"""
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
tolerant = re.sub(r",(\s*[\]\}])", r"\1", broken)
data = json.loads(tolerant)
paths_by_group = {
    name: set(group.get("modules", [])) for name, group in data.items()
}

subprocess.run(["git", "checkout", "--", "scripts/package-boundaries.json"], cwd=ROOT, check=True)

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
    lines = body.rstrip().split(nl_local)
    # The last module line carries no trailing comma (JSON); keep that invariant.
    last = lines[-1]
    stripped = last.rstrip()
    if stripped.endswith(","):
        stripped = stripped[:-1]
    if stripped.count('"') == 0:
        raise SystemExit("unexpected modules tail: %r" % last)
    indent = re.match(r"(\s*)", last).group(1)
    lines[-1] = stripped + ","
    lines.append(indent + '"%s"' % module)
    new_body = nl_local.join(lines) + nl_local + "    "
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
