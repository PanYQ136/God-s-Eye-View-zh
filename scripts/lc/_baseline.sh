#!/bin/bash
# 重建「分层 + !important 原样」的基线；并把结果快照到 snap2/ 供试删实验反复还原
set -e
FILES="public/gev-fix.css public/gev-cn.css public/gev-responsive.css public/gev-panel-win.css src/ui/styles/mobile-portrait.css src/ui/styles/foundation.css src/ui/styles/layers.css src/ui/styles/cockpit.css src/ui/styles/cyber.css src/ui/styles/command-dock.css src/ui/styles/bhote-koshi.css src/ui/styles/weather.css src/ui/styles/recording.css src/ui/styles/command-dock-sliding.css src/ui/styles/controls.css src/ui/styles/command-dock-compact.css src/ui/styles/scenes.css src/ui/styles/recent-imagery.css src/ui/styles/first-run.css src/ui/styles/command-dock-trays.css"
for f in $FILES; do node scripts/lc/_imp.mjs --restore "$f" >/dev/null; done
node scripts/lc/_imp.mjs --layer public/gev-cn.css components >/dev/null
node scripts/lc/_imp.mjs --layer public/gev-responsive.css components >/dev/null
node scripts/lc/_imp.mjs --layer public/gev-fix.css overrides >/dev/null
node scripts/lc/_imp.mjs --layer public/gev-panel-win.css components >/dev/null
node scripts/lc/_imp.mjs --layer src/ui/styles/mobile-portrait.css components >/dev/null
node scripts/lc/_imp.mjs --layer src/lc/material.css material >/dev/null
mkdir -p .gev-logs/lc/phase8d/snap2
for f in $FILES; do mkdir -p ".gev-logs/lc/phase8d/snap2/$(dirname $f)"; cp "$f" ".gev-logs/lc/phase8d/snap2/$f"; done
node scripts/lc/_imp.mjs --count | tail -1
