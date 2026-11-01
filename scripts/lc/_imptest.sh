#!/bin/bash
# 用法: bash scripts/lc/_imptest.sh file1 file2 ...  → 只删这些文件的 !important，其余还原，报告指纹差异数
set -e
ALL="public/gev-fix.css public/gev-cn.css public/gev-responsive.css public/gev-panel-win.css src/ui/styles/mobile-portrait.css src/ui/styles/foundation.css src/ui/styles/layers.css src/ui/styles/cockpit.css src/ui/styles/cyber.css src/ui/styles/command-dock.css src/ui/styles/bhote-koshi.css src/ui/styles/weather.css src/ui/styles/recording.css src/ui/styles/command-dock-sliding.css src/ui/styles/controls.css src/ui/styles/command-dock-compact.css src/ui/styles/scenes.css src/ui/styles/recent-imagery.css src/ui/styles/first-run.css src/ui/styles/command-dock-trays.css"
for f in $ALL; do node scripts/lc/_imp.mjs --restore "$f" >/dev/null; done
for f in "$@"; do node scripts/lc/_imp.mjs --strip "$f" >/dev/null; done
sleep 2
node scripts/lc/_cssfp.mjs .gev-logs/lc/phase8d/fp-tmp.json >/dev/null 2>&1
node scripts/lc/_cssfp-diff.mjs .gev-logs/lc/phase8d/fp-L19.json .gev-logs/lc/phase8d/fp-tmp.json 2>/dev/null | python -c "import sys,json; d=json.load(sys.stdin); print('DIFF', d['diffElements'], json.dumps(d['byProp'], ensure_ascii=False)[:180])"
