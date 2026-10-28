#!/usr/bin/env node
/** 汇总报告用数字：从各 json 抽取，输出纯文本表 */
import fs from 'node:fs';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const ab = JSON.parse(fs.readFileSync(`${SCR}/tail3-contrast-ab.json`, 'utf8'));
const dock = JSON.parse(fs.readFileSync(`${SCR}/tail3-dock-titles.json`, 'utf8'));
const tail = JSON.parse(fs.readFileSync(`${SCR}/tail3.json`, 'utf8'));
const P = (r) => r.map((c) => `${c.id}:${c.worstPixel}`).join(' ');
console.log('--- ab dark before:', P(ab.darkBefore.cards));
console.log('--- ab dark after :', P(ab.darkAfter.cards));
console.log('--- ab bright bfr :', P(ab.brightBefore.cards));
console.log('--- ab bright aft :', P(ab.brightAfter.cards));
const all = (scene, state) => ab[`${scene}${state}`].cards.flatMap((c) => c.texts.filter((t) => t.t !== 'radio').map((t) => t.pixel));
for (const [scene, state] of [['dark', 'Before'], ['dark', 'After'], ['bright', 'Before'], ['bright', 'After']]) {
  const v = all(scene, state);
  console.log(`min(title, excl radio) ${scene}${state}: ${Math.min(...v)}  n=${v.length}`);
}
console.log('--- dock dark before:', JSON.stringify(dock.darkBefore));
console.log('--- dock dark after :', JSON.stringify(dock.darkAfter));
console.log('--- dock bright before:', JSON.stringify(dock.brightBefore));
console.log('--- dock bright after :', JSON.stringify(dock.brightAfter));
console.log('--- luma dark:', JSON.stringify(tail.lumaAB.dark));
console.log('--- luma bright:', JSON.stringify(tail.lumaAB.bright));
console.log('--- tray open samples:', JSON.stringify(tail.tray.samples));
console.log('--- tray close samples:', JSON.stringify(tail.trayClose.samples));
console.log('--- collapsed sw/cw:', tail.darkCollapsed.cards.map((c) => `${c.id}:${c.sw}/${c.cw}`).join(' '));
console.log('--- bright collapsed lcBg:', tail.brightCollapsed.cards.map((c) => `${c.id}:${c.lcBg}`).join(' '));
console.log('--- dark collapsed lcBg:', tail.darkCollapsed.cards.map((c) => `${c.id}:${c.lcBg}`).join(' '));
console.log('--- collapsed innerBg:', tail.darkCollapsed.cards.map((c) => `${c.id}:${c.innerBg}`).join(' '));
