import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for(let i=0;i<120;i++){const r=await p.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready)).catch(()=>false); if(r)break; await sleep(400);}
await sleep(9000);
const click=async(sel)=>{const pt=await p.evaluate(s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width*0.5),y:Math.round(r.y+r.height*0.5)};},sel); await p.mouse.move(pt.x,pt.y,{steps:3}); await sleep(40); await p.mouse.down(); await sleep(30); await p.mouse.up();};
await click('#cctv-panel .panel-title');
await sleep(1500);
const out=await p.evaluate(()=>({prot:window.__lc.snapshot.protected, boxes:window.__lc.result.boxes, viol:window.__lc.result.violations, minis:window.__lc.snapshot.minis}));
console.log(JSON.stringify(out,null,1));
await b.close();
