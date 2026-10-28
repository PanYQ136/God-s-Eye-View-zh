import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for(let i=0;i<120;i++){const r=await p.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready)).catch(()=>false); if(r)break; await sleep(400);}
await sleep(9000);
const prot=await p.evaluate(()=>{
  const ids=['gev-gfx-fab','style-indicator','top-center-actions','gev-perf-wrap','key-setup-chip','gev-lang-toggle','gev-locate-btn'];
  const out={};
  for(const id of ids){const e=document.getElementById(id); if(!e){out[id]=null;continue;} const r=e.getBoundingClientRect(); out[id]=[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];}
  const snap=window.__lc.snapshot; return {out,snap};
});
console.log(JSON.stringify(prot,null,1));
const snap2=await p.evaluate(()=>{const s=window.__lc; return s&&s.snapshot?null:null;});
await b.close();
