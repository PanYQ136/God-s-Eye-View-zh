"""Register one module in one boundary group, normalizing the array formatting."""
import io
import json
import re
import sys

ROOT = r"D:\Hermes\gods-eye-view"
P = ROOT + r"\scripts\package-boundaries.json"


def add(group, module):
    s = io.open(P, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    start = s.index('"%s": {' % group)
    mod_at = s.index('"modules": [', start)
    open_bracket = mod_at + len('"modules": ')
    close = s.index("]", open_bracket)
    body = s[open_bracket + 1 : close]
    paths = re.findall(r'"([^"]+)"', body)
    if module in paths:
        return False
    paths.append(module)
    rendered = nl + ",\n".join('      "%s"' % p for p in paths) + nl + "    "
    s = s[: open_bracket + 1] + rendered + s[close:]
    json.loads(s)
    io.open(P, "w", encoding="utf-8", newline="").write(s)
    return True


if __name__ == "__main__":
    print(add(sys.argv[1], sys.argv[2]))
