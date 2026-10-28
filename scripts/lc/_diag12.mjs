import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for(let i=0;i<120;i++){const r=await p.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready)).catch(()=>false); if(r)break; await sleep(400);}
await sleep(9000);
const click=async(sel)=>{const pt=await p.evaluate(s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width*0.5),y:Math.round(r.y+r.height*0.5)};},sel); await p.mouse.move(pt.x,pt.y,{steps:3}); await sleep(40); await p.mouse.down(); await sleep(30); await p.mouse.up(); return pt;};
await click('#pp-toggles .pp-header-label'); await sleep(1500);
const info=await p.evaluate(()=>{
  const e=document.querySelector('#cctv-panel .panel-header'); const r=e.getBoundingClientRect();
  const cx=Math.round(r.x+r.width*0.4), cy=Math.round(r.y+r.height*0.5);
  const hit=document.elementFromPoint(cx,cy);
  const chain=[]; let n=hit; while(n&&chain.length<6){chain.push(n.id||n.className||n.tagName); n=n.parentElement;}
  return {hdr:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],pt:[cx,cy],chain};
});
console.log(JSON.stringify(info,null,1));
await p.mouse.move(info.pt[0],info.pt[1],{steps:3}); await sleep(40); await p.mouse.down(); await sleep(30); await p.mouse.up();
await sleep(1200);
console.log(JSON.stringify(await p.evaluate(()=>window.__lc.api.phases()),null,1));
await b.close();
