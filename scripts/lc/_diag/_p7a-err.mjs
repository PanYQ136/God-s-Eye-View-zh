import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const profile = mkdtempSync(join(tmpdir(), 'gev-err-'));
const b = await puppeteer.launch({ headless:false, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', userDataDir:profile, args:['--no-sandbox','--window-size=1372,934','--ignore-gpu-blocklist','--force_high_performance_gpu','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'], protocolTimeout:300000, defaultViewport:{width:1348,height:774,deviceScaleFactor:1} });
const p = await b.newPage();
p.on('console', m => { const t=m.text(); if (/Init|photoreal|MapStack|error|warn/i.test(t)) console.log('LOG:', m.type(), t.slice(0,300)); });
p.on('pageerror', e => console.log('PAGEERR:', String(e.message).slice(0,300)));
await p.goto('http://127.0.0.1:4173/?welcome=0&err=1', {waitUntil:'domcontentloaded'});
for (let i=0;i<120;i++){
  const st = await p.evaluate(()=>({photo: window.__gevPhotoreal||null, boot: window.__gevBoot? window.__gevBoot.interactive:null, marks:(window.__bootTimeline?.snapshot?.().marks||[]).map(m=>m.name)}));
  if (i%10===0) console.log(i+'s', JSON.stringify(st.photo), 'interactive', st.boot, 'hasPhotoAdded', st.marks.includes('photoreal:added'), 'prims', await p.evaluate(()=>window.__gevViewer?.scene?.primitives?.length));
  if (st.photo && st.photo.ready) { console.log('READY', JSON.stringify(st.photo)); break; }
  await new Promise(r=>setTimeout(r,1000));
}
await b.close();
