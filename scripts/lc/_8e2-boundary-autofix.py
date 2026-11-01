"""Iteratively register unowned modules reported by check-package-boundaries."""
import io
import json
import re
import subprocess

ROOT = r"D:\Hermes\gods-eye-view"
P = ROOT + r"\scripts\package-boundaries.json"


def insert(group, module):
    s = io.open(P, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    start = s.index('"%s": {' % group)
    mod_at = s.index('"modules": [', start)
    close = s.index("]", mod_at)
    body = s[mod_at:close]
    if ('"%s"' % module) in body:
        return False
    body_lines = body.rstrip().split(nl)
    last = body_lines[-1].rstrip()
    if last.endswith(","):
        last = last[:-1]
    indent = re.match(r"(\s*)", body_lines[-1]).group(1)
    body_lines[-1] = last + ","
    body_lines.append(indent + '"%s"' % module)
    s = s[:mod_at] + nl.join(body_lines) + nl + "    " + s[close:]
    json.loads(s)
    io.open(P, "w", encoding="utf-8", newline="").write(s)
    return True


pattern = re.compile(
    r"Package boundary ([\w-]+) (?:imports|requires) an unowned module: (\S+)"
)
for attempt in range(40):
    out = subprocess.run(
        ["node", "scripts/check-package-boundaries.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    text = out.stdout + out.stderr
    match = pattern.search(text)
    if not match:
        print("clean after", attempt, "insertions")
        print(text[-1500:])
        print("exit", out.returncode)
        break
    group, module = match.group(1), match.group(2).replace("\\", "/")
    changed = insert(group, module)
    print("insert", group, module, "changed" if changed else "already")
    if not changed:
        print("stuck:", text[-800:])
        break
