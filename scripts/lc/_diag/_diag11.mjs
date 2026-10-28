import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for(let i=0;i<120;i++){const r=await p.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready)).catch(()=>false); if(r)break; await sleep(400);}
await sleep(9000);
const click=async(sel)=>{const pt=await p.evaluate(s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width*0.5),y:Math.round(r.y+r.height*0.5)};},sel); await p.mouse.move(pt.x,pt.y,{steps:3}); await sleep(40); await p.mouse.down(); await sleep(30); await p.mouse.up();};
await click('#pp-toggles .pp-header-label'); await sleep(1500);
await p.evaluate(()=>{ window.__trace=[]; const push=()=>{ const s=window.__lc.snapshot; if(!s) return; window.__trace.push({t:Math.round(performance.now()), mini:s.minis['cctv-panel'], push:(window.__lc.result&&window.__lc.result.pushes&&window.__lc.result.pushes['cctv-panel'])||null, box:window.__lc.result&&window.__lc.result.boxes['cctv-panel'], ph:window.__lc.api.phases()['cctv-panel']}); }; window.__ti=setInterval(push,50); });
await click('#cctv-panel .panel-title');
await sleep(900);
const tr=await p.evaluate(()=>{clearInterval(window.__ti);const el=document.getElementById('cctv-panel');const r=el.getBoundingClientRect();return {last:window.__trace.slice(-2), rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], css:el.style.cssText.slice(0,400), parent:el.parentElement.id, box:window.__lc.result.boxes['cctv-panel']};});
console.log(JSON.stringify(tr,null,1));
await b.close();
