import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for(let i=0;i<120;i++){const r=await p.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready)).catch(()=>false); if(r)break; await sleep(400);}
await sleep(9000);
const click=async(sel)=>{const pt=await p.evaluate(s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width*0.5),y:Math.round(r.y+r.height*0.5)};},sel); await p.mouse.move(pt.x,pt.y,{steps:3}); await sleep(40); await p.mouse.down(); await sleep(30); await p.mouse.up();};
const dump=async(tag)=>{const o=await p.evaluate(()=>({minis:window.__lc.snapshot.minis,boxes:window.__lc.result.boxes,pushes:window.__lc.result.pushes,viol:window.__lc.result.violations,ph:window.__lc.api.phases(),geo:Object.fromEntries(['pp-toggles','cctv-panel','global-context-panel'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]];}))})); console.log(tag,JSON.stringify(o));};
await click('#pp-toggles .pp-header-label'); await sleep(1400); await dump('pp-open');
await click('#cctv-panel .panel-title'); await sleep(1400); await dump('cctv-open');
await b.close();
