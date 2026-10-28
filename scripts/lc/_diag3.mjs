import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=1980,20'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
await sleep(3000);
const early=await p.evaluate(()=>{
  const f=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const c=getComputedStyle(e);const r=e.getBoundingClientRect();return{rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],top:c.top,bottom:c.bottom,padding:c.padding,translate:c.translate,transform:c.transform,pos:c.position,height:c.height,inlineTop:e.style.top,inlinePad:e.style.paddingTop};};
  return {L:f('#left-panel-stack'),R:f('#right-context-rail'),dock:f('#command-dock')};
});
console.log('t=3s',JSON.stringify(early,null,1));
await sleep(9000);
const late=await p.evaluate(()=>{
  const f=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const c=getComputedStyle(e);const r=e.getBoundingClientRect();return{rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],top:c.top,bottom:c.bottom,padding:c.padding,translate:c.translate,transform:c.transform,inlineTop:e.style.top,inlineLeft:e.style.left};};
  return {L:f('#left-panel-stack'),R:f('#right-context-rail')};
});
console.log('t=12s',JSON.stringify(late,null,1));
await b.close();
