#!/bin/bash
cd /d/Hermes/gods-eye-view || exit 1
node scripts/_r5-seq.mjs pp-toggles,control-panel,global-context-panel 1200 5
node scripts/_r5-seq.mjs pp-toggles,control-panel,global-context-panel 2500 3
node scripts/_r5-seq.mjs pp-toggles,control-panel,global-context-panel 400 3
node scripts/_r5-seq.mjs control-panel,pp-toggles,global-context-panel 1200 3
node scripts/_r5-seq.mjs pp-toggles,global-context-panel,control-panel 1200 3
echo ALLDONE
