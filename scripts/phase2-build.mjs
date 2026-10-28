#!/usr/bin/env node
/**
 * phase2-build.mjs —— 生成 Phase 2 的三个视觉候选（同背景 / 同尺寸 / 同布局）
 *
 *   A 清透 CSS     ：卡壳 alpha .14（≤.22）+ 单层 backdrop blur(9px)，无内影暗带
 *   B 3:25 原版    ：卡壳 rgba(12,18,26,.52) + 内层 warp 层 blur(6px) saturate(140%)（§2 原值）
 *   C 边缘混合     ：中心 清透（alpha .12 + blur 8），边缘 0–14px 走 SVG feDisplacementMap
 *                    真折射 + R/G/B 三档位移（20/13/7）→ 2–4x 可见色散，中心不污染
 *
 * 三页共用：同一张 map-bg.png（1536×730，正式页面同帧地图）、同一套真实 rect（layout.json）、
 * 同一个逐帧平移的地图画布（让 backdrop-filter / SVG 滤镜必须每帧重算，FPS 才有意义）。
 *
 * 用法: node scripts/phase2-build.mjs
 * 产物: .gev-logs/phase2/candidates/{A-clear-css,B-325-original,C-edge-hybrid}.html
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.gev-logs/phase2');
const OUT = path.join(ROOT, 'candidates');
fs.mkdirSync(OUT, { recursive: true });
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'layout.json'), 'utf8'));
const R = (id) => {
  const c = LAYOUT.cards.find((x) => x.id === id);
  if (!c || !c.rect) throw new Error('missing rect ' + id);
  return c.rect;
};

/* ── 真实布局（取自 layout.json 的 1536×730 实跑 rect） ───────────────── */
const CARDS = [
  { id: 'data-panel', rect: R('data-panel'), kind: 'expanded', title: '数据图层', close: true },
  { id: 'scene-panel', rect: R('scene-panel'), kind: 'mini', title: '场景' },
  { id: 'pp-toggles', rect: R('pp-toggles'), kind: 'mini', title: '显示' },
  { id: 'cctv-panel', rect: R('cctv-panel'), kind: 'mini', title: '监控' },
  { id: 'global-context-panel', rect: R('global-context-panel'), kind: 'mini', title: '上下文', icon: '⧉' },
  { id: 'location-bar', rect: R('location-bar'), kind: 'dock', title: '位置', icon: '◎' },
  { id: 'control-panel', rect: R('control-panel'), kind: 'dock', title: '视觉预设', icon: '▤' },
  { id: 'gev-voice-control', rect: R('gev-voice-control'), kind: 'voice' },
  { id: 'gev-gfx-fab', rect: R('gev-gfx-fab'), kind: 'fab' },
];
const TRAY = [518, 622, 494, 104]; // 底部托盘（三张 dock 卡的外壳）

/* 展开卡内容：照抄正式页 data-panel 的条目（供文字可读性测量） */
const DATA_ROWS = [
  { icon: '🛰', name: '卫星', meta: 'Celestrak · 从未', label: '渲染上限', val: '25', unit: '颗' },
  { icon: '✈', name: '实时航班', meta: 'OpenSky Network · 从未', label: '渲染上限', val: '25', unit: '架' },
  { icon: '🎖', name: '军机', meta: 'adsb.lol · 从未', label: '渲染上限', val: '999', unit: '架' },
  { icon: '📡', name: '本地 ADS-B', meta: '', label: '', val: '', unit: '' },
];

const px = (r) => `left:${r[0]}px;top:${r[1]}px;width:${r[2]}px;height:${r[3]}px;`;

function cardHtml(c) {
  const r = c.rect;
  const isFab = c.kind === 'fab';
  const cls = 'card k-' + c.kind + (isFab ? ' round' : '');
  if (c.kind === 'expanded') {
    return `<div class="${cls}" data-id="${c.id}" style="${px(r)}">
  <div class="warp"></div><div class="edge"><div class="eb"></div></div><div class="hl"></div>
  <div class="body">
    <div class="row hd"><span class="t title" data-role="title">${c.title}</span>${c.close ? '<span class="t x" data-role="icon">✕</span>' : ''}</div>
    <div class="t sec" data-role="section">移动目标</div>
    ${DATA_ROWS.map(
      (d) => `<div class="row it"><span class="t ic" data-role="icon">${d.icon}</span><span class="t nm" data-role="item">${d.name}</span><span class="t off" data-role="meta">关</span></div>
      ${d.meta ? `<div class="t mt" data-role="meta">${d.meta}</div>` : ''}
      ${
        d.label
          ? `<div class="row sl"><span class="t lb" data-role="meta">${d.label}</span><span class="sl-track"><i style="width:${d.val === '999' ? 96 : 12}%"></i><b></b></span><span class="t val" data-role="value">${d.val}</span><span class="t unit" data-role="accent">${d.unit}</span></div>`
          : ''
      }`,
    ).join('\n    ')}
  </div>
</div>`;
  }
  if (c.kind === 'mini') {
    return `<div class="${cls}" data-id="${c.id}" style="${px(r)}">
  <div class="warp"></div><div class="edge"><div class="eb"></div></div><div class="hl"></div>
  <div class="body"><div class="row hd"><span class="t title" data-role="title">${c.title}</span>${c.icon ? `<span class="t ic2" data-role="icon">${c.icon}</span>` : ''}</div></div>
</div>`;
  }
  if (c.kind === 'dock') {
    return `<div class="${cls}" data-id="${c.id}" style="${px(r)}">
  <div class="warp"></div><div class="edge"><div class="eb"></div></div><div class="hl"></div>
  <div class="body"><div class="t dock-ic" data-role="icon">${c.icon || '◈'}</div><div class="t title" data-role="title">${c.title}</div></div>
</div>`;
  }
  if (c.kind === 'voice') {
    return `<div class="${cls}" data-id="${c.id}" style="${px(r)}">
  <div class="warp"></div><div class="edge"><div class="eb"></div></div><div class="hl"></div>
  <div class="body"><div class="vrow"><span class="t mic" data-role="icon">●</span><span class="t vst" data-role="accent">标准</span></div><div class="t von" data-role="meta">ON/OFF</div><div class="t vsub" data-role="meta">语音传输</div></div>
</div>`;
  }
  return `<div class="${cls}" data-id="${c.id}" style="${px(r)}">
  <div class="warp"></div><div class="edge"><div class="eb"></div></div><div class="hl"></div>
  <div class="body"><div class="t gear" data-role="icon">⚙</div></div>
</div>`;
}

const COMMON_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1536px;height:730px;overflow:hidden;background:#05080d;
  font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#eef7ff;
  -webkit-font-smoothing:antialiased}
#bg{position:fixed;left:0;top:0;width:1536px;height:730px;display:block}
.tray{position:absolute;${''}
  left:518px;top:622px;width:494px;height:104px;border-radius:26px;
  background:rgba(10,14,20,0.30);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.10), 0 10px 30px rgba(0,0,0,.30);
  corner-shape:squircle;}
.card{position:absolute;border-radius:16px;corner-shape:squircle;overflow:hidden;isolation:isolate}
.card.round{border-radius:50%!important;corner-shape:round!important}
.warp,.edge,.hl{position:absolute;inset:0;border-radius:inherit;pointer-events:none}
.edge{display:none;overflow:hidden}
.eb{position:absolute;left:0;top:0;width:1536px;height:730px;background-repeat:no-repeat}
.body{position:relative;z-index:3;height:100%;display:flex;flex-direction:column}
.t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row{display:flex;align-items:center;gap:6px}
.hd{padding:11px 12px 4px 12px;justify-content:space-between}
.title{font-size:11.5px;font-weight:600;color:#eef7ff;letter-spacing:.3px;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.x{font-size:10px;color:rgba(220,232,244,.9);width:16px;height:16px;display:grid;place-items:center;border-radius:50%;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}
.sec{padding:6px 12px 4px;font-size:9px;letter-spacing:1.2px;color:rgba(150,172,196,.95);text-transform:uppercase;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.it{padding:5px 12px 0;gap:7px}
.ic{font-size:10px;width:12px}
.nm{font-size:11px;color:#dfeaf6;flex:1;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.off{font-size:9.5px;color:rgba(168,182,198,.95);text-shadow:0 1px 2px rgba(0,0,0,.5)}
.mt{padding:1px 12px 0 31px;font-size:9px;color:rgba(140,160,182,.95);text-shadow:0 1px 2px rgba(0,0,0,.5)}
.sl{padding:4px 12px 2px 31px;gap:8px}
.lb{font-size:9px;color:rgba(160,178,198,.95);text-shadow:0 1px 2px rgba(0,0,0,.5)}
.sl-track{position:relative;flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.14)}
.sl-track i{position:absolute;left:0;top:0;height:3px;border-radius:2px;background:#00d4ff}
.sl-track b{position:absolute;left:12%;top:-3px;width:9px;height:9px;border-radius:50%;background:#eaf6ff;box-shadow:0 0 6px rgba(0,212,255,.6)}
.val{font-size:9.5px;color:#eef7ff;min-width:22px;text-align:right;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.unit{font-size:9px;color:#00d4ff;text-shadow:0 1px 2px rgba(0,0,0,.55)}
.ic2{font-size:11px;color:rgba(200,215,230,.9)}
.dock-ic{font-size:12px;color:rgba(210,226,240,.92)}
.card.k-dock .body{align-items:center;justify-content:center;gap:5px}
.card.k-fab .body{align-items:center;justify-content:center}
.gear{font-size:12px;color:rgba(215,230,244,.95)}
.card.k-voice .body{align-items:center;justify-content:center;gap:2px}
.vrow{display:flex;align-items:center;gap:5px}
.mic{font-size:9px;color:#00d4ff}
.vst{font-size:9.5px;color:#00d4ff}
.von{font-size:9px;color:rgba(230,240,250,.95)}
.vsub{font-size:8px;color:rgba(150,170,190,.95)}
/* 测量态：只留背景 */
body.m-bg .card,body.m-bg .tray{display:none!important}
body.m-notext .t{visibility:hidden!important}
body.m-noedge .edge{display:none!important}
`;

/* ── A 清透 CSS ───────────────────────────────────────────────────────── */
const A_CSS = `
:root{--fill:rgba(10,16,24,0.14);}
.card,.tray{background:rgba(10,16,24,0.14) !important;
  -webkit-backdrop-filter:blur(9px) saturate(140%) brightness(1.02);
  backdrop-filter:blur(9px) saturate(140%) brightness(1.02);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.30),
    inset 0 1px 0 rgba(255,255,255,0.42),
    0 10px 30px rgba(0,0,0,0.26) !important;}
.hl{background:linear-gradient(180deg,rgba(255,255,255,0.10) 0%,rgba(255,255,255,0.02) 34%,rgba(255,255,255,0) 60%)}
`;

/* ── B 3:25 原版 ──────────────────────────────────────────────────────── */
const B_CSS = `
.card,.tray{background:rgba(12,18,26,0.52) !important;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.10), 0 12px 40px rgba(0,0,0,0.28) !important;}
.card .warp{inset:12px;border-radius:6px;
  -webkit-backdrop-filter:blur(6px) saturate(140%);backdrop-filter:blur(6px) saturate(140%);
  -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 8px,#000 calc(100% - 8px),transparent 100%),linear-gradient(180deg,transparent 0,#000 8px,#000 calc(100% - 8px),transparent 100%);
  -webkit-mask-composite:source-in;
  mask-image:linear-gradient(90deg,transparent 0,#000 8px,#000 calc(100% - 8px),transparent 100%),linear-gradient(180deg,transparent 0,#000 8px,#000 calc(100% - 8px),transparent 100%);
  mask-composite:intersect;}
.hl{background:none}
`;

/* ── C 边缘混合：清透中心 + 边缘真折射/色散 ───────────────────────────── */
const C_CSS = `
.card,.tray{background:rgba(10,16,24,0.12) !important;
  -webkit-backdrop-filter:blur(8px) saturate(130%);
  backdrop-filter:blur(8px) saturate(130%);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.26), 0 10px 30px rgba(0,0,0,0.24) !important;}
.card .edge{display:block}
.card .edge .eb{-webkit-filter:var(--lens);filter:var(--lens)}
.hl{background:linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0) 45%)}
`;

/* ── 共享 JS：地图逐帧平移 + FPS 探针 + 边缘层对齐 ─────────────────────── */
const COMMON_JS = `
const W=1536,H=730,SCALE=1.12;
const img=new Image();
const cv=document.getElementById('bg'),ctx=cv.getContext('2d',{alpha:false});
window.__ready=false;window.__freeze=false;
window.__forceRedraw=function(){ if(img.complete&&img.naturalWidth) draw(0); };
let t0=performance.now();
function draw(t){
  const tt=window.__freeze?0:t;
  const CW=W*SCALE, CH=H*SCALE;
  const ox=-(CW-W)/2 + 26*Math.sin(tt/1000*0.55);
  const oy=-(CH-H)/2 + 16*Math.cos(tt/1000*0.41);
  ctx.drawImage(img,ox,oy,CW,CH);
  if(EDGE_ON) syncEdges(ox,oy,CW,CH);
  window.__bg={ox:ox,oy:oy,CW:CW,CH:CH};
}
function loop(t){ draw(t); if(!window.__freeze) requestAnimationFrame(loop); }
img.onload=()=>{ draw(0); window.__ready=true; requestAnimationFrame(loop); };
img.src='../map-bg.png';

function syncEdges(ox,oy,CW,CH){
  for(const el of document.querySelectorAll('.eb')){
    const c=el.closest('.card'); const r=c.getBoundingClientRect();
    el.style.backgroundImage="url('../map-bg.png')";
    el.style.backgroundSize=CW+'px '+CH+'px';
    el.style.backgroundPosition=(ox-r.left)+'px '+(oy-r.top)+'px';
  }
}
/* 边缘色散滤镜：每种卡尺寸一套（位移图 + 掩膜按尺寸生成） */
window.__buildLens=function(){
  const SVGNS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(SVGNS,'svg');
  svg.setAttribute('width','0');svg.setAttribute('height','0');
  svg.style.position='absolute';svg.style.left='-9999px';
  document.body.appendChild(svg);
  const uniq={};
  const cards=[...document.querySelectorAll('.card')].filter(c=>!c.classList.contains('round'));
  for(const c of cards){
    const r=c.getBoundingClientRect();
    const w=Math.round(r.width),h=Math.round(r.height),key=w+'x'+h;
    if(!uniq[key]) uniq[key]=makeFilter(svg,w,h,key);
    c.querySelector('.edge').style.setProperty('--lens','url(#'+uniq[key]+')');
    c.querySelector('.edge').style.webkitMaskImage='url('+ringURL(w,h)+')';
    c.querySelector('.edge').style.maskImage='url('+ringURL(w,h)+')';
    c.querySelector('.edge').style.maskSize='100% 100%';
    c.querySelector('.edge').style.maskRepeat='no-repeat';
  }
  return Object.keys(uniq);
};
function distInside(x,y,w,h,rad){
  const cx=Math.min(Math.max(x,rad),w-rad), cy=Math.min(Math.max(y,rad),h-rad);
  const dx=x-cx, dy=y-cy, d=Math.sqrt(dx*dx+dy*dy);
  const dEdge=Math.min(x,y,w-x,h-y);
  return dEdge;
}
function ringURL(w,h){
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const c=cv.getContext('2d');
  c.fillStyle='#fff';
  const rad=16, band=0.0001;
  // 圆角矩形环：外圈白，内圈黑，用两遍绘制 + 模糊羽化
  const g=c.createRadialGradient(0,0,0,0,0,1);
  c.save();
  c.beginPath();
  roundRect(c,0,0,w,h,rad);c.fill();
  c.globalCompositeOperation='destination-out';
  c.filter='blur(4px)';
  c.beginPath();roundRect(c,12,12,w-24,h-24,Math.max(2,rad-12));c.fill();
  c.filter='none';
  c.restore();
  return cv.toDataURL('image/png');
}
function roundRect(c,x,y,w,h,r){
  c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
}
function makeFilter(svg,w,h,key){
  const id='lens-'+key;
  // 位移图：SDF → 法线方向向内采样，band 内线性增强
  const dc=document.createElement('canvas');dc.width=w;dc.height=h;
  const dx=dc.getContext('2d');
  const im=dx.createImageData(w,h);
  const rad=16, band=16, maxShift=12;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const dEdge=distInside(x,y,w,h,rad);
      const k=Math.max(0,1-dEdge/band);
      const f=k*k;
      // 朝内（指向卡片中心）采样 → 边缘像被放大/折射
      const nx=(x-w/2), ny=(y-h/2), nl=Math.hypot(nx,ny)||1;
      const dirx=-nx/nl, diry=-ny/nl;
      const px=dirx*f*maxShift, py=diry*f*maxShift;
      const o=(y*w+x)*4;
      im.data[o]=Math.max(0,Math.min(255,128+px/10*127));
      im.data[o+1]=Math.max(0,Math.min(255,128+py/10*127));
      im.data[o+2]=0; im.data[o+3]=255;
    }
  }
  dx.putImageData(im,0,0);
  const dispURL=dc.toDataURL('image/png');
  const NS='http://www.w3.org/2000/svg';
  const f=document.createElementNS(NS,'filter');
  f.setAttribute('id',id);
  f.setAttribute('filterUnits','userSpaceOnUse');
  f.setAttribute('x','0');f.setAttribute('y','0');f.setAttribute('width',w);f.setAttribute('height',h);
  f.setAttribute('color-interpolation-filters','sRGB');
  const fi=document.createElementNS(NS,'feImage');
  fi.setAttribute('href',dispURL);
  fi.setAttribute('x','0');fi.setAttribute('y','0');fi.setAttribute('width',w);fi.setAttribute('height',h);
  fi.setAttribute('preserveAspectRatio','none');fi.setAttribute('result','disp');
  f.appendChild(fi);
  const chan=[['rs',26,'1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],['gs',16,'0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],['bs',8,'0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']];
  for(const [res,scale,vals] of chan){
    const cm=document.createElementNS(NS,'feColorMatrix');
    cm.setAttribute('in','SourceGraphic');cm.setAttribute('type','matrix');cm.setAttribute('values',vals);
    cm.setAttribute('result',res+'-c');f.appendChild(cm);
    const dm=document.createElementNS(NS,'feDisplacementMap');
    dm.setAttribute('in',res+'-c');dm.setAttribute('in2','disp');
    dm.setAttribute('scale',String(scale));dm.setAttribute('xChannelSelector','R');dm.setAttribute('yChannelSelector','G');
    dm.setAttribute('result',res);f.appendChild(dm);
  }
  const b1=document.createElementNS(NS,'feBlend');
  b1.setAttribute('in','rs');b1.setAttribute('in2','gs');b1.setAttribute('mode','screen');b1.setAttribute('result','rg');f.appendChild(b1);
  const b2=document.createElementNS(NS,'feBlend');
  b2.setAttribute('in','rg');b2.setAttribute('in2','bs');b2.setAttribute('mode','screen');f.appendChild(b2);
  svg.appendChild(f);
  return id;
}
window.__fps=function(ms){
  ms=ms||3000;
  return new Promise((res)=>{
    const t=performance.now();let n=0;
    (function step(){
      n++;
      if(performance.now()-t<ms) requestAnimationFrame(step);
      else res({frames:n,ms:performance.now()-t,fps:n/((performance.now()-t)/1000)});
    })();
  });
};
`;

const VARIANTS = {
  'A-clear-css': { css: A_CSS, extraJs: '', edge: false, title: 'A 清透 CSS', fill: 0.14 },
  'B-325-original': { css: B_CSS, extraJs: '', edge: false, title: 'B 3:25 原版', fill: 0.52 },
  'C-edge-hybrid': {
    css: C_CSS,
    extraJs: 'if(EDGE_ON&&window.__buildLens){window.__lens=window.__buildLens();}',
    edge: true,
    title: 'C 边缘混合',
    fill: 0.12,
  },
};

for (const [file, v] of Object.entries(VARIANTS)) {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>GEV 视觉候选 ${v.title} · 1536×730</title>
<style>${COMMON_CSS}${v.css}</style>
</head><body>
<canvas id="bg" width="1536" height="730"></canvas>
<div class="tray"></div>
${CARDS.map(cardHtml).join('\n')}
<div style="position:absolute;left:12px;top:8px;font:600 11px/1.4 'Segoe UI',sans-serif;color:rgba(220,235,248,.85);text-shadow:0 1px 2px #000;z-index:9;letter-spacing:.4px">
候选 ${v.title}　declared fill alpha=${v.fill.toFixed(2)}　1536×730　背景=正式页面同帧地图（逐帧平移）
</div>
<script>
const EDGE_ON=${v.edge ? 'true' : 'false'};
${COMMON_JS}
${v.extraJs}
</script>
</body></html>`;
  fs.writeFileSync(path.join(OUT, file + '.html'), html);
  console.log('wrote', file + '.html', fs.statSync(path.join(OUT, file + '.html')).size, 'bytes');
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ cards: CARDS, tray: TRAY, variants: VARIANTS }, null, 1));
console.log('layout:', CARDS.map((c) => c.id + '=' + c.rect.join(',')).join(' | '));
