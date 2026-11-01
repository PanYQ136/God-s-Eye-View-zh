import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless:'new', executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', args:['--enable-gpu'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil:'domcontentloaded' });
await p.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.mounted), { timeout: 60000 });
await new Promise(r=>setTimeout(r,3000));
console.log(await p.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  const kids = [...el.children].map(c => `${c.tagName.toLowerCase()}.${[...c.classList].join('.')} @${Math.round(c.getBoundingClientRect().height)}`);
  const rows = [...el.querySelectorAll('*')].filter(e => /header|title|row/.test(e.className)).slice(0,4).map(e => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
  return JSON.stringify({ phase: el.getAttribute('data-lc-phase'), cls: el.className, rect:[r.x,r.y,r.width,r.height].map(Math.round), kids, rows }, null, 1);
}));
await b.close();
