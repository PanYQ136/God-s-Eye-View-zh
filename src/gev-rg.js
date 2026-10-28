/* ============================================================================
   gev-rg.js —— 上帝之眼：用官方 rdev/liquid-glass-react（React + GPU 位移滤镜）
   给 9 个面板铺「真·液态玻璃折射」层。
   思路：一个 body 级 overlay(z 低, 在 canvas 之上/面板之下)，为每个面板放一个
   LiquidGlass(mode="shader"，按自身尺寸生成位移图)，rAF 跟随面板实时矩形。
   面板本身半透明，玻璃折射其背后的地图 → 真折射。删本文件 + index.html 的
   <script> + CSS 里的 .gev-rg-* / html.gev-rg-on 段 即回滚。
   ========================================================================== */
import React from 'react';
import { createRoot } from 'react-dom/client';
import LiquidGlass from 'liquid-glass-react';

const IDS = [
  'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab',
];
const reg = {}; // id -> { host, setSize }

class EB extends React.Component {
  constructor(p) { super(p); this.state = { dead: false }; }
  static getDerivedStateFromError() { return { dead: true }; }
  componentDidCatch() {}
  render() { return this.state.dead ? null : this.props.children; }
}

function GlassHost({ id }) {
  const ref = React.useRef(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    reg[id] = { host: ref.current, setSize };
    return () => { delete reg[id]; };
  }, [id]);
  const ready = size.w > 8 && size.h > 8;
  return React.createElement(
    'div',
    { ref, className: 'gev-rg-host' },
    ready
      ? React.createElement(EB, null,
          React.createElement(
            LiquidGlass,
            { className: 'fd-glass', mode: 'standard', displacementScale: 70, blurAmount: 0.0625, saturation: 140, aberrationIntensity: 2, cornerRadius: 18 },
            React.createElement('div', { style: { width: '100%', height: '100%' } })
          )
        )
      : null
  );
}

function App() {
  return React.createElement(
    React.Fragment,
    null,
    IDS.map((id) => React.createElement(GlassHost, { key: id, id }))
  );
}

function boot() {
  const have = IDS.filter((id) => document.getElementById(id)).length;
  if (have < 6) { setTimeout(boot, 800); return; }        // 等面板就绪
  if (document.getElementById('gev-rg-overlay')) return;
  document.documentElement.classList.add('gev-rg-on');    // 关闭原生 warp、面板透明
  const overlay = document.createElement('div');
  overlay.id = 'gev-rg-overlay';
  document.body.appendChild(overlay);
  createRoot(overlay).render(React.createElement(App));

  const last = {};
  const syncSize = (id, r) => {
    const g = reg[id]; if (!g) return;
    const l = last[id] || { w: 0, h: 0 };
    if (Math.abs(l.w - r.width) > 6 || Math.abs(l.h - r.height) > 6) {
      last[id] = { w: r.width, h: r.height };
      g.setSize({ w: r.width, h: r.height });
    }
  };
  const tick = () => {
    for (let i = 0; i < IDS.length; i++) {
      const id = IDS[i];
      const el = document.getElementById(id);
      const g = reg[id];
      if (!el || !g || !g.host) continue;
      const r = el.getBoundingClientRect();
      const off = r.width < 6 || r.height < 6 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight;
      if (off) { g.host.style.display = 'none'; continue; }
      g.host.style.display = 'block';
      g.host.style.left = r.left + 'px';
      g.host.style.top = r.top + 'px';
      g.host.style.width = r.width + 'px';
      g.host.style.height = r.height + 'px';
      syncSize(id, r);
    }
    requestAnimationFrame(tick);
  };
  const initSizes = () => {
    for (let i = 0; i < IDS.length; i++) {
      const id = IDS[i];
      const el = document.getElementById(id); const g = reg[id];
      if (el && g) {
        const r = el.getBoundingClientRect();
        last[id] = { w: r.width, h: r.height };
        g.setSize({ w: r.width, h: r.height });
      }
    }
    requestAnimationFrame(tick);
  };
  setTimeout(initSizes, 350);
}

setTimeout(boot, 1200);
