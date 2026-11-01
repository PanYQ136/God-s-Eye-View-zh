"""Iteratively register unowned modules reported by check-package-boundaries."""
import re
import subprocess
import sys

sys.path.insert(0, r"D:\Hermes\gods-eye-view\scripts\lc")
from importlib import import_module

ROOT = r"D:\Hermes\gods-eye-view"
add_module = import_module("_8e2-boundary-add")

pattern = re.compile(
    r"Package boundary ([\w-]+) (?:imports|requires) an unowned module: (\S+)"
)
for attempt in range(10):
    out = subprocess.run(
        ["node", "scripts/check-package-boundaries.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    text = out.stdout + out.stderr
    match = pattern.search(text)
    if not match:
        print("clean after", attempt, "insertions; exit", out.returncode)
        print(text[-1000:])
        break
    group, module = match.group(1), match.group(2).replace("\\", "/").strip()
    print("about to insert", repr(group), repr(module), flush=True)
    changed = add_module.add(group, module)
    print("insert", group, module, changed, flush=True)
    if not changed:
        print("stuck:", text[-600:])
        break
