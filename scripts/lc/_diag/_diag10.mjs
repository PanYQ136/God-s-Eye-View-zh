import puppeteer from 'puppeteer';
const W=1536,H=730;const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({headless:false,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars'],protocolTimeout:600000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
await p.evaluateOnNewDocument(()=>{try{localStorage.clear();localStorage.setItem('gev:first-run-mission:v1','suppressed');}catch(e){}});
await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:180000});
for(let i=0;i<120;i++){const r=await p.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready)).catch(()=>false); if(r)break; await sleep(400);}
await sleep(9000);
const click=async(sel)=>{const pt=await p.evaluate(s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width*0.5),y:Math.round(r.y+r.height*0.5)};},sel); await p.mouse.move(pt.x,pt.y,{steps:3}); await sleep(40); await p.mouse.down(); await sleep(30); await p.mouse.up();};
await click('#pp-toggles .pp-header-label'); await sleep(1400);
await click('#cctv-panel .panel-title'); await sleep(1600);
const out=await p.evaluate(()=>{
  const el=document.getElementById('cctv-panel'); const cs=getComputedStyle(el);
  return {inline:{h:el.style.height,maxH:el.style.maxHeight,minH:el.style.minHeight,pos:el.style.position,transform:el.style.transform,cls:el.className},
    cs:{h:cs.height,maxH:cs.maxHeight,minH:cs.minHeight,display:cs.display,overflowY:cs.overflowY,flex:cs.flex,alignSelf:cs.alignSelf,position:cs.position},
    rect:((r)=>({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}))(el.getBoundingClientRect()),
    parent:el.parentElement.id||el.parentElement.className,
    stageH:document.getElementById('lc-stage').getBoundingClientRect().height,
    contentH:el.scrollHeight, clientH:el.clientHeight,
    box:window.__lc.result.boxes['cctv-panel']};
});
console.log(JSON.stringify(out,null,1));
await b.close();
