/**
 * gev-perf.js — 非侵入「性能模式」+ 实时 FPS 徽标（God's Eye View 增强层）。
 *
 * 一键降低渲染负载，实测前台 FPS 提升主要来自三处（本机 RTX3060）：
 *   关后处理(风格滤镜)  +~10 FPS、放宽瓦片 LOD +~6、降分辨率缩放 +~2；
 *   航班层的 billboard 数量是最大单项成本（关掉整层 +~57 FPS）。
 *
 * 完全可还原：删掉本文件 + index.html 里对应的 1 行 <script> 即恢复原状。
 * 只读 window.__gevViewer（由 viewer.js 暴露），不 import Cesium、不改动任何既有模块。
 */
/* Phase 1 · S1g：#gev-gpu-chip 必须与 FPS 同一个 wrap（§13.3 R3），
   由 src/lc/gpu.js 提供（唯一 GPU 判定来源，R5）。 */
import { mountChip } from './lc/gpu.js';

(() => {
  const LS_KEY = 'gev.perfMode';
  const st = {
    viewer: null,
    on: false,
    saved: null, // {res, globeMSE, tfr, tilesets:[], tilesetMSE:[], stageOn:[]}
    frames: 0,
    t0: 0,
  };
  // N-1: 按钮文案随语言(body.gev-zh 由 gev-cn.js 控制)切换，监听切换事件
  function syncBtn() {
    const btn = document.getElementById('gev-perf-btn');
    if (!btn) return;
    const zh = document.body.classList.contains('gev-zh');
    btn.textContent = st.on
      ? zh
        ? '性能 · 开'
        : 'PERF · ON'
      : zh
        ? '性能模式'
        : 'PERF MODE';
    btn.title = st.on
      ? zh
        ? '点击恢复画质'
        : 'Click to restore quality'
      : zh
        ? '点击降低负载、提高帧率'
        : 'Reduce load · raise FPS';
  }
  document.addEventListener('gev-lang-change', syncBtn);

  function findTilesets(scene) {
    const out = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const p = scene.primitives.get(i);
      if (p && p.constructor && p.constructor.name === 'Cesium3DTileset')
        out.push(p);
    }
    return out;
  }

  function snapshot() {
    const v = st.viewer;
    const s = v.scene;
    const tilesets = findTilesets(s);
    const stageOn = [];
    try {
      for (let i = 0; i < s.postProcessStages.length; i++)
        stageOn.push(s.postProcessStages.get(i).enabled);
    } catch (e) {}
    st.saved = {
      res: v.resolutionScale,
      globeMSE: s.globe ? s.globe.maximumScreenSpaceError : 2,
      tfr: v.targetFrameRate,
      tilesets,
      tilesetMSE: tilesets.map((t) => t.maximumScreenSpaceError),
      stageOn,
    };
  }

  function apply(on) {
    const v = st.viewer;
    if (!v) return;
    const s = v.scene;
    if (!st.saved) snapshot();
    if (on) {
      v.resolutionScale = 0.85;
      if (s.globe) s.globe.maximumScreenSpaceError = 6;
      st.saved.tilesets.forEach((t) => {
        try {
          t.maximumScreenSpaceError = 48;
        } catch (e) {}
      });
      try {
        for (let i = 0; i < s.postProcessStages.length; i++)
          s.postProcessStages.get(i).enabled = false;
      } catch (e) {}
      // GEV perf 2026-10-24: 性能模式不再把帧率硬锁 30（30fps 对地图明显不流畅），
      // 放宽到 60；分辨率 0.7→0.85 兼顾清晰与负载。
      if (v.targetFrameRate) v.targetFrameRate = 60;
    } else {
      v.resolutionScale = st.saved.res;
      if (s.globe) s.globe.maximumScreenSpaceError = st.saved.globeMSE;
      st.saved.tilesets.forEach((t, i) => {
        if (st.saved.tilesetMSE[i] != null) {
          try {
            t.maximumScreenSpaceError = st.saved.tilesetMSE[i];
          } catch (e) {}
        }
      });
      try {
        for (let i = 0; i < s.postProcessStages.length; i++) {
          if (st.saved.stageOn[i] != null)
            s.postProcessStages.get(i).enabled = st.saved.stageOn[i];
        }
      } catch (e) {}
      if (st.saved.tfr) v.targetFrameRate = st.saved.tfr;
    }
    st.on = on;
    try {
      localStorage.setItem(LS_KEY, on ? '1' : '0');
    } catch (e) {}
    const btn = document.getElementById('gev-perf-btn');
    if (btn) btn.classList.toggle('on', on);
    syncBtn();
    // 立刻刷新一帧，切换当场可见
    try {
      v.scene.requestRenderMode = false;
      setTimeout(() => {
        try {
          v.scene.requestRenderMode = true;
        } catch (e) {}
      }, 260);
    } catch (e) {}
  }

  // 瓦片集（3D Tileset）通常异步加载，启动时可能还没就绪 → 稍后补设其 LOD。
  function applyTileLod() {
    if (!st.on || !st.viewer) return;
    try {
      const ts = findTilesets(st.viewer.scene);
      for (const t of ts) {
        try {
          t.maximumScreenSpaceError = 48;
        } catch (e) {}
      }
    } catch (e) {}
  }

  function buildUi() {
    if (document.getElementById('gev-perf-btn')) return;
    const css = document.createElement('style');
    /* Phase8D #13：运行时注入的样式表也要进层 */
    css.textContent =
      '@layer components {\n' +
      [
        '#gev-perf-wrap{position:fixed;left:12px;bottom:52px;z-index:var(--z-devtools, 160);display:flex;gap:8px;align-items:center;font:12px/1.2 system-ui,"Segoe UI",sans-serif;}',
        /* 灰圈=0（Phase 1 · §6.6）：徽标不用 border/outline/inset 描边，层级只靠底色与亮度 */
        '#gev-perf-btn{cursor:pointer;border:0;outline:0;box-shadow:none;background:rgba(8,20,30,.72);color:#bfe9ff;padding:6px 11px;border-radius:16px;letter-spacing:.4px;backdrop-filter:blur(3px);}',
        '#gev-perf-btn.on{background:rgba(10,58,42,.86);color:#9dffd6;}',
        '#gev-perf-fps{border:0;outline:0;box-shadow:none;background:rgba(8,20,30,.72);color:#8fe3ff;padding:6px 10px;border-radius:16px;min-width:62px;text-align:center;font-variant-numeric:tabular-nums;}',
      ].join('') +
      '\n}';
    document.head.appendChild(css);
    const wrap = document.createElement('div');
    wrap.id = 'gev-perf-wrap';
    const fps = document.createElement('div');
    fps.id = 'gev-perf-fps';
    fps.textContent = 'FPS —';
    const btn = document.createElement('button');
    btn.id = 'gev-perf-btn';
    btn.type = 'button';
    btn.textContent = '性能模式';
    btn.addEventListener('click', () => apply(!st.on));
    wrap.appendChild(fps);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
    mountChip(); // #gev-gpu-chip 与 FPS 同 wrap（§13.3 R3）
    syncBtn();
  }

  function tickFps() {
    if (!st.viewer) return;
    const el = document.getElementById('gev-perf-fps');
    const now = performance.now();
    if (st.t0) {
      const dt = now - st.t0;
      if (dt >= 900) {
        const fps = Math.round((st.frames * 1000) / dt);
        if (el) el.textContent = 'FPS ' + fps;
        // GEV (G4/G14): 自适应分辨率——性能模式开启时按实测 FPS 微调 resolutionScale 逼近 57fps。
        // 50–58 为死区（不抖），越界才按 0.05/0.03 步长在 [0.6, 0.9] 内调整。
        /* Phase7D2：启动/升级期的 FPS 低谷是「瓦片 burst」造成的，不是分辨率造成的
           —— 那时降分辨率既压不住 burst，还会让画布尺寸来回跳（实测 0.85→0.61→0.9
           三档各触发一次 framebuffer 重建，长帧窗口里纯属加戏）。所以先在启动后 12s、
           且 __gevPhotoreal 还没 ready 时冻结自适应；20s 后无论如何解冻，
           防止「photoreal 永远不 ready」把自适应永久锁死。 */
        try {
          if (st.on && st.viewer) {
            const v = st.viewer;
            const nowMs = performance.now();
            const bootAge = nowMs - (st.bootAt || 0);
            const photo = globalThis.__gevPhotoreal;
            const upgrading = !!(photo && photo.ready === false);
            const frozen = bootAge < 12000 || (upgrading && bootAge < 20000);
            if (frozen) {
              st.adaptFrozen = true;
            } else {
              st.adaptFrozen = false;
              let r = v.resolutionScale || 0.85;
              if (fps > 0 && fps < 50 && r > 0.6) r = Math.max(0.6, r - 0.05);
              else if (fps > 58 && r < 0.9) r = Math.min(0.9, r + 0.03);
              if (Math.abs(r - (v.resolutionScale || 0.85)) > 0.001) {
                v.resolutionScale = r;
                try {
                  v.scene.requestRender && v.scene.requestRender();
                } catch (e) {}
              }
            }
          }
        } catch (e) {}
        st.frames = 0;
        st.t0 = now;
      }
    } else st.t0 = now;
  }

  function boot(viewer) {
    st.viewer = viewer;
    st.bootAt = performance.now();
    buildUi();
    // FPS 计数：st.frames 过去从未自增（徽标恒 0）。用 requestAnimationFrame
    // 度量浏览器实际帧节奏——requestRenderMode 空闲不渲染时它仍反映真实流畅度。
    try {
      const rafTick = () => {
        st.frames++;
        requestAnimationFrame(rafTick);
      };
      requestAnimationFrame(rafTick);
      setInterval(tickFps, 500);
    } catch (e) {}
    // 用户要求「默认最大化流畅度」→ 首次默认开启性能模式（点按钮可关掉恢复画质/风格）
    let want = true;
    try {
      const p = localStorage.getItem(LS_KEY);
      if (p != null) want = p === '1';
    } catch (e) {}
    if (want) {
      apply(true);
      [3000, 9000, 18000].forEach((t) => setTimeout(applyTileLod, t));
    } else {
      const btn = document.getElementById('gev-perf-btn');
      if (btn) btn.textContent = '性能模式';
    }
  }

  let tries = 0;
  const timer = setInterval(() => {
    if (window.__gevViewer && window.__gevViewer.scene) {
      clearInterval(timer);
      boot(window.__gevViewer);
    } else if (++tries > 200) clearInterval(timer);
  }, 250);
})();
