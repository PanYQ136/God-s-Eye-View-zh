import io

p = r"D:\Hermes\gods-eye-view\scripts\package-boundaries.json"
s = io.open(p, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
old = '      "src/app/data.js",' + nl
assert s.count(old) == 1, s.count(old)
s = s.replace(old, old + '      "src/app/deferredCatalog.js",' + nl, 1)
old2 = '      "src/app/operations.js",' + nl
assert s.count(old2) >= 1, s.count(old2)
s = s.replace(old2, old2 + '      "src/app/pendingLayer.js",' + nl, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
