import puppeteer from 'puppeteer';
const W=1348,H=774;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({headless:false,executablePath:'C:\Program Files\Google\Chrome\Application\chrome.exe',
 args:['--no-sandbox',`--window-size=${W+24},${H+160}`,'--window-position=40,20','--hide-scrollbars','--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-features=CalculateNativeWinOcclusion'],
 protocolTimeout:900000,defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const page=await browser.newPage(); await page.bringToFront().catch(()=>{});
await page.goto('http://127.0.0.1:4173/?welcome=0&t='+Date.now(),{waitUntil:'load'});
for(let i=0;i<150;i++){const ok=await page.evaluate(()=>!!(window.__lc&&window.__lc.api&&window.__lc.api.ready&&window.__gevEdge&&window.__gevEdge.stats().count>0)).catch(()=>false); if(ok)break; await sleep(400);}
await sleep(4000);
await page.evaluate(()=>window.__lc.api.dispatch({type:'ESC',id:'data-panel'})); await sleep(1200);
const a=await page.evaluate(()=>{const s=window.__gevEdge.stats();return{f:s.frames,k:s.skip,d:s.drawFps,fps:s.fps,post:s.post,raf:s.raf,err:s.err};});
await sleep(2000);
const b=await page.evaluate(()=>{const s=window.__gevEdge.stats();return{f:s.frames,k:s.skip,d:s.drawFps,fps:s.fps,post:s.post,raf:s.raf,err:s.err};});
console.log('t0',JSON.stringify(a)); console.log('t2s',JSON.stringify(b));
console.log('frames+',b.f-a.f,'skip+',b.k-a.k);
await browser.close();
