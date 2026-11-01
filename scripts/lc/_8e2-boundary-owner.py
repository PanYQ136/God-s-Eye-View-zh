"""Add a module path to a boundary group's `modules` list, keeping it sorted.

Usage: python scripts/lc/_8e2-boundary-owner.py <group> <repo/relative/path.js>
Runs the boundary checker afterwards; repeat with the reported group until clean.
"""
import io
import re
import subprocess
import sys

P = r"D:\Hermes\gods-eye-view\scripts\package-boundaries.json"


def add(group, module):
    s = io.open(P, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    marker = '"%s": {' % group
    start = s.index(marker)
    mod_at = s.index('"modules": [', start)
    close = s.index("]", mod_at)
    head = s[:mod_at]
    body = s[mod_at:close]
    lines = body.split(nl)
    entries = []
    order = []
    for line in lines:
        m = re.match(r'\s+"([^"]+)",?$', line)
        if m:
            entries.append((m.group(1), line))
    if any(path == module for path, _ in entries):
        print("already present")
        return
    entries.append((module, '      "%s",' % module))
    entries.sort(key=lambda pair: pair[0])
    rebuilt = ['  "modules": ['] + [line for _, line in entries] + ["    "]
    new_body = nl.join(rebuilt)
    s = head + new_body + s[close:]
    io.open(P, "w", encoding="utf-8", newline="").write(s)
    print("added %s to %s" % (module, group))


if __name__ == "__main__":
    add(sys.argv[1], sys.argv[2])
    out = subprocess.run(
        ["node", "scripts/check-package-boundaries.mjs"],
        cwd=r"D:\Hermes\gods-eye-view",
        capture_output=True,
        text=True,
    )
    sys.stdout.write(out.stdout[-2000:])
    sys.stderr.write(out.stderr[-2000:])
    print("exit", out.returncode)
