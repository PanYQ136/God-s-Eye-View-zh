#!/bin/bash
# 用法: bash scripts/lc/_impgroup.sh file1 file2 ...  → 仅这些文件删 !important，其余还原到 snap2 基线
set -e
for f in $(cd .gev-logs/lc/phase8d/snap2 && find . -name '*.css' | sed 's|^\./||'); do cp ".gev-logs/lc/phase8d/snap2/$f" "$f"; done
for f in "$@"; do node scripts/lc/_imp.mjs --strip "$f" >/dev/null; done
sleep 2
FP_SETTLE=6000 node scripts/lc/_cssfp.mjs .gev-logs/lc/phase8d/fp-tmp.json >/dev/null 2>&1
node scripts/lc/_cssfp-diff.mjs .gev-logs/lc/phase8d/fp-L20.json .gev-logs/lc/phase8d/fp-tmp.json 2>/dev/null | python -c "import sys,json; d=json.load(sys.stdin); print('DIFF', d['diffElements'], json.dumps(d['byProp'], ensure_ascii=False)[:160])"
