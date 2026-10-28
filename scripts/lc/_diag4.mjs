import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=1980,20'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
await sleep(12000);
const out=await p.evaluate(()=>{
  const rect=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];};
  return {
    rails:{L:rect('#left-panel-stack'),R:rect('#right-context-rail'),Ltr:getComputedStyle(document.querySelector('#left-panel-stack')).translate,Rtr:getComputedStyle(document.querySelector('#right-context-rail')).translate},
    mini: Object.fromEntries(['data-panel','scene-panel','pp-toggles','cctv-panel','global-context-panel','location-bar','control-panel','gev-voice-control'].map(id=>{const e=document.getElementById(id);const r=e.getBoundingClientRect();return [id,[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]];})),
    violations: window.__lc.violations,
    diag: window.__lc.diagnostics,
    lcState: window.__lc.api.state(),
  };
});
console.log(JSON.stringify(out,null,1));
await b.close();
