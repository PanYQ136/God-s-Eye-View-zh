import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars','--disable-backgrounding-occluded-windows'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}
  window.__cancels=[];
  const orig=Animation.prototype.cancel;
  Animation.prototype.cancel=function(){ try{ window.__cancels.push({t:performance.now(),stack:(new Error()).stack.split('\n').slice(1,6).join(' | ')}); }catch(e){} return orig.call(this); };
});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for(let i=0;i<120;i++){const r=await p.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready)).catch(()=>false); if(r)break; await sleep(400);}
await sleep(9000);
const pt=await p.evaluate(()=>{const e=document.querySelector('#data-panel .panel-title');const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};});
await p.mouse.move(pt.x,pt.y,{steps:3}); await p.mouse.down(); await sleep(30); await p.mouse.up();
await sleep(1200);
const out=await p.evaluate(()=>({cancels:window.__cancels.slice(0,6),morph:window.__lc.morph,anims:document.getElementById('data-panel').getAnimations().map(a=>({state:a.playState,d:a.effect.getTiming().duration,ct:a.currentTime}))}));
console.log(JSON.stringify(out,null,1));
await b.close();
