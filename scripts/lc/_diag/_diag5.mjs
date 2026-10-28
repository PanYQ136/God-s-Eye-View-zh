import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=1980,20'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
const logs=[];p.on('console',m=>logs.push(m.type()+':'+m.text().slice(0,200)));p.on('pageerror',e=>logs.push('pageerror:'+e.message));
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for (const t of [3000,6000,9000,13000]) {
  await sleep(t===3000?3000:3000);
  const s=await p.evaluate(()=>{
    const L=document.querySelector('#left-panel-stack');
    const cs=getComputedStyle(L);
    return {top:Math.round(L.getBoundingClientRect().top), translate:cs.translate, inlineTranslate:L.style.translate, inlineTop:L.style.top, ready:!!(window.__lc&&window.__lc.api&&window.__lc.api.ready), booted:!!window.__lcBooted, diag:window.__lc&&window.__lc.diagnostics, lastFrameAt:window.__lc&&window.__lc.lastFrameAt, phases:window.__lc&&window.__lc.api?window.__lc.api.phases():null};
  });
  console.log(t, JSON.stringify(s));
}
const forced=await p.evaluate(()=>{
  const L=document.querySelector('#left-panel-stack');
  L.style.setProperty('translate','0 -96px');
  const a=Math.round(L.getBoundingClientRect().top);
  L.style.setProperty('translate','none');
  return {afterManual:a};
});
console.log('manual', JSON.stringify(forced));
console.log(logs.slice(0,10).join('\n'));
await b.close();
