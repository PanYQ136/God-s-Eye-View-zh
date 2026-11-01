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
# A project module imported by app code without ownership is a real finding;
# iterate until the checker stops reporting them.
for attempt in range(60):
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
        print(text[-1200:])
        break
    group, module = match.group(1), match.group(2).replace("\\", "/")
    changed = add_module.add(group, module)
    print("insert", group, module, changed)
    if not changed:
        print("stuck:", text[-600:])
        break
