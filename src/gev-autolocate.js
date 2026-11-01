/* ═══════════════════════════════════════════════════════════════
   GEV —— 启动相机：地球上空 → 定位当前设备 → 电影镜头放大到当前位置
   用户 2026-09-28 指定：定位与瓦片加载【并行】；不做航班追踪。

   ⚠️ 大陆环境关键结论：浏览器内置定位（走 Google）在国内被墙，常年拿不到值，
      所以之前一直回退到"家"（福州）。本模块改用【多源定位】，优先国内可用源：
        1) 高德 JS API Geolocation（手机 GPS/WiFi，最准）
        2) 浏览器 navigator.geolocation（境外或已授权时）
        3) 高德 REST IP 定位（城市级，大陆可用；用客户端真实 IP）
        4) localStorage 上次成功的位置
        5) 兜底：家（福州）

   诊断：window.__gevCine = { stage, frames, geo, sources }
        geo = { lat, lon, source, city?, acc? } 或 null
        sources = { amapJs, browser, amapIp } 各自结果

   零侵入可还原：删本文件 + index.html 那行 <script> + controls.js 取消注释。
   ═══════════════════════════════════════════════════════════════ */

import * as bridge from './bridge.js';
import { Cesium } from './cesium.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { announceBootCenter } from './maps/tileWarmup.js';

(function () {
  'use strict';

  const AMAP_KEY = (import.meta.env && import.meta.env.VITE_AMAP_KEY) || '';

  const CINE = (window.__gevCine = {
    stage: 'boot',
    frames: 0,
    geo: null,
    sources: {},
  });

  const HOME = { lon: 119.349185, lat: 26.067452 }; // 福州东景家园（兜底）
  const LS_KEY = 'gev.lastLocation';
  const START_HEIGHT = 10_000_000;
  const END_HEIGHT = 12_000;
  const MIN_DWELL_MS = 1000;
  const TWEEN_MS = 4200;
  const GEO_CAP = 6500; // 单源最长等待
  const LOC_CAP_MS = 12000; // 无就绪门（旧路径）等定位的上限
  const GPS_REFINE_MS = 900; // Phase7A：遮罩期内给 GPS 纠偏的窗口（就绪门路径）；3000→900，遮罩不再等它

  let firstCall = true;
  let ran = false;
  let tries = 0;

  const viewer = () => window.__gevViewer;
  const sceneReady = (v) => v && v.camera && v.scene && v.scene.preRender;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);
  const valid = (l) =>
    l &&
    Number.isFinite(l.lat) &&
    Number.isFinite(l.lon) &&
    Math.abs(l.lat) <= 90 &&
    Math.abs(l.lon) <= 180 &&
    !(l.lat === 0 && l.lon === 0);

  /* ── 源 1：高德 JS API Geolocation（手机 GPS/WiFi，最准） ── */
  function loadAmapJs() {
    return new Promise((resolve) => {
      if (window.AMap) return resolve(true);
      if (!AMAP_KEY) return resolve(false);
      const s = document.createElement('script');
      s.src =
        'https://webapi.amap.com/maps?v=2.0&key=' +
        encodeURIComponent(AMAP_KEY) +
        '&plugin=AMap.Geolocation,AMap.CitySearch';
      s.onload = () => resolve(!!window.AMap);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(!!window.AMap), 9000);
    });
  }
  async function amapJsGeo() {
    try {
      const ok = await loadAmapJs();
      if (!ok || !window.AMap || !window.AMap.Geolocation) return null;
      const pos = await cap(
        new Promise((res) => {
          try {
            new window.AMap.Geolocation({
              enableHighAccuracy: true,
              timeout: 6000,
            }).getCurrentPosition((s, r) => {
              if (s === 'complete' && r && r.position)
                res({
                  lon: r.position.getLng(),
                  lat: r.position.getLat(),
                  acc: r.accuracy,
                  source: 'amap-gps',
                });
              else res(null);
            });
          } catch (e) {
            res(null);
          }
        }),
        GEO_CAP,
      );
      return valid(pos) ? pos : null;
    } catch (e) {
      return null;
    }
  }

  /* ── 源 2：浏览器内置定位 ── */
  function tryNav(opts) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      let done = false;
      const fin = (r) => {
        if (!done) {
          done = true;
          resolve(r);
        }
      };
      const g = setTimeout(() => fin(null), (opts.timeout || 6000) + 1500);
      try {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            clearTimeout(g);
            fin({
              lon: p.coords.longitude,
              lat: p.coords.latitude,
              acc: p.coords.accuracy,
              source: 'browser',
            });
          },
          () => {
            clearTimeout(g);
            fin(null);
          },
          opts,
        );
      } catch (e) {
        clearTimeout(g);
        fin(null);
      }
    });
  }
  async function browserGeo() {
    let r = await cap(
      tryNav({ enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }),
      GEO_CAP + 1500,
    );
    if (!valid(r))
      r = await cap(
        tryNav({
          enableHighAccuracy: false,
          timeout: 6000,
          maximumAge: 600000,
        }),
        GEO_CAP + 1500,
      );
    return valid(r) ? r : null;
  }

  /* ── 源 3：高德 REST IP 定位（城市级） ── */
  async function amapIpGeo() {
    if (!AMAP_KEY) return null;
    try {
      const u =
        'https://restapi.amap.com/v3/ip?key=' + encodeURIComponent(AMAP_KEY);
      const r = await cap(
        fetch(u).then((x) => x.json()),
        GEO_CAP,
      );
      if (!r || r.status !== '1' || !r.rectangle) return null;
      // rectangle: "lng1,lat1;lng2,lat2" → 取中心
      const m = String(r.rectangle).match(
        /(-?[\d.]+),(-?[\d.]+);(-?[\d.]+),(-?[\d.]+)/,
      );
      if (!m) return null;
      const lon = (parseFloat(m[1]) + parseFloat(m[3])) / 2;
      const lat = (parseFloat(m[2]) + parseFloat(m[4])) / 2;
      return { lon, lat, city: r.city || r.province || '', source: 'amap-ip' };
    } catch (e) {
      return null;
    }
  }

  /* ── 源 4：本地缓存 ── */
  function lastKnown() {
    try {
      const l = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return valid(l)
        ? { ...l, source: (l.source || 'cache') + '+cache' }
        : null;
    } catch (e) {
      return null;
    }
  }
  function saveLast(loc) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(loc));
    } catch (e) {
      /* ignore */
    }
  }

  async function resolveLocation() {
    // 并行三源（页面一开就发起；通常遮罩收起前已就绪）
    const [ajs, br, ip] = await Promise.all([
      amapJsGeo(),
      browserGeo(),
      amapIpGeo(),
    ]);
    CINE.sources = {
      amapJs: ajs && { lon: ajs.lon, lat: ajs.lat, acc: ajs.acc },
      browser: br && { lon: br.lon, lat: br.lat, acc: br.acc },
      amapIp: ip && { lon: ip.lon, lat: ip.lat, city: ip.city },
    };
    const loc = ajs || br || ip || lastKnown() || { ...HOME, source: 'home' };
    CINE.geo = loc;
    if (loc.source && !String(loc.source).includes('cache')) saveLast(loc);
    try {
      console.log(
        '[GEV] location resolved:',
        JSON.stringify({
          source: loc.source,
          lat: +loc.lat.toFixed(4),
          lon: +loc.lon.toFixed(4),
          city: loc.city || undefined,
        }),
      );
    } catch (e) {
      /* ignore */
    }
    return loc;
  }

  /* ── 快速定位（Phase6C3-B）：高德 IP 或本地缓存，通常 <1s ──
     冷启动遮罩期先用它落位，GPS（要下载高德 JS 脚本 + 授权）在之后 3s 内追上来
     再纠正；这样「冷启动时长」不被 GPS 绑住，又不会长期停在城市级精度。 */
  async function resolveFastLocation() {
    try {
      const ip = await Promise.race([amapIpGeo(), sleep(2200).then(() => null)]);
      if (valid(ip)) return ip;
    } catch (e) {
      /* ignore */
    }
    return lastKnown();
  }

  /* 两个位置是否相距 >2km（判断 GPS 是否值得再落位一次） */
  function isFar(a, b) {
    if (!valid(a) || !valid(b)) return false;
    const dLat = (a.lat - b.lat) * 111;
    const dLon = (a.lon - b.lon) * 111 * Math.cos((b.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLon) > 2;
  }

  function hasShareLink() {
    return /(?:^|[#&])lat=-?[\d.]+/.test(window.location.hash || '');
  }

  function setSpaceView(lon, lat) {
    const v = viewer();
    if (!sceneReady(v)) return false;
    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, START_HEIGHT),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
    });
    return true;
  }

  /* ── 直接落到最终视角（无动画）：Phase6C3-B 遮罩期预热用 ──
     相机从 10,000km 拉到 12,000m 的电影镜头会持续 4.2s 流瓦片，可见状态下必然
     出现 >100ms 长帧；遮罩期一次落位，把「落位 + 瓦片流」都压在遮罩后面。 */
  function jumpTo(target) {
    const v = viewer();
    if (!sceneReady(v)) return false;
    const t = target || HOME;
    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, END_HEIGHT),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-89),
        roll: 0,
      },
    });
    try {
      v.scene.requestRender?.();
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  function tweenTo(target) {
    const v = viewer();
    if (!sceneReady(v)) {
      CINE.stage = 'tween-noScene';
      return;
    }
    CINE.stage = 'tweening';
    const cam = v.camera;
    const scene = v.scene;
    let from;
    try {
      const c = cam.positionCartographic;
      from = {
        lon: Cesium.Math.toDegrees(c.longitude),
        lat: Cesium.Math.toDegrees(c.latitude),
        h: c.height,
        heading: cam.heading,
        pitch: cam.pitch,
      };
    } catch (e) {
      from = null;
    }
    if (
      !from ||
      !Number.isFinite(from.lon) ||
      !Number.isFinite(from.lat) ||
      !Number.isFinite(from.h) ||
      from.h <= 0
    ) {
      from = {
        lon: HOME.lon,
        lat: HOME.lat,
        h: START_HEIGHT,
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-90),
      };
    }
    const to = {
      lon: target.lon,
      lat: target.lat,
      h: END_HEIGHT,
      heading: Cesium.Math.toRadians(15),
      // Land straight-down (nadir) so the view opens flat, not tilted, and the
      // camera-tilt toggle reads OFF by default (owner request 2026-10-01).
      pitch: Cesium.Math.toRadians(-89),
    };

    let done = false;
    let raf = 0;
    const t0 = performance.now();
    const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const finish = () => {
      if (done) return;
      done = true;
      try {
        cancelAnimationFrame(raf);
      } catch (e) {
        /* ignore */
      }
      releaseContinuousRender('gev-cine');
      /* Phase6C3-B：告诉冷启动就绪门「镜头已落到最终视角」——它会接着等
         最终视角的瓦片流静默，然后才允许收起加载遮罩。 */
      CINE.done = true;
      CINE.stage = 'done';
      try {
        window.dispatchEvent(new CustomEvent('gev:cine-done'));
      } catch (e) {
        /* ignore */
      }
    };
    holdContinuousRender('gev-cine');
    const step = () => {
      if (done) return;
      CINE.frames++;
      let t = (performance.now() - t0) / TWEEN_MS;
      if (!Number.isFinite(t)) t = 1;
      if (t > 1) t = 1;
      const s = ease(t);
      const h = from.h * Math.pow(to.h / from.h, s);
      const lon = from.lon + (to.lon - from.lon) * s;
      const lat = from.lat + (to.lat - from.lat) * s;
      const dHeading = Math.atan2(
        Math.sin(to.heading - from.heading),
        Math.cos(to.heading - from.heading),
      );
      const heading = from.heading + dHeading * s;
      const pitch = from.pitch + (to.pitch - from.pitch) * s;
      try {
        cam.setView({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, h),
          orientation: { heading, pitch, roll: 0 },
        });
      } catch (e) {
        /* ignore */
      }
      try {
        scene.requestRender?.();
      } catch (e) {
        /* ignore */
      }
      if (t >= 1) {
        finish();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    setTimeout(finish, TWEEN_MS + 3000);
  }

  function waitForLoaderHidden(maxMs) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const check = () => {
        const el = document.getElementById('loading-screen');
        // 注意：不能用 offsetParent —— #loading-screen 是 position:fixed，fixed 元素恒为 null
        const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
        const gone = !el || !Number.isFinite(op) || op < 0.05;
        if (gone || performance.now() - t0 > maxMs) return resolve();
        setTimeout(check, 150);
      };
      check();
    });
  }

  function toast(msg, ms) {
    let el = document.getElementById('gev-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gev-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms || 5200);
  }

  /* Phase7A：定位在**脚本求值**就发起（旧实现在 run() 里、要等 viewer 就绪+
     就绪门放行才发，白等 1–2s）。相机一就绪就能直接落位。 */
  const bootLocP = resolveLocation();
  const bootFastP = resolveFastLocation();
  if (bootFastP && typeof bootFastP.then === 'function')
    bootFastP
      .then((loc) => {
        if (!loc) return;
        announceBootCenter(loc);
        /* Phase7A：底图瓦片预取按真实中心重算（与预取中心相距 >2km 时） */
        try {
          globalThis.__gevBaseTiles?.center(loc);
        } catch (_) {}
      })
      .catch(() => {});

  async function run() {
    if (ran) return;
    const v = viewer();
    if (!sceneReady(v)) {
      if (tries++ < 600) setTimeout(run, 60);
      return;
    }
    if (firstCall && hasShareLink()) {
      ran = true;
      CINE.stage = 'share-skip';
      CINE.done = true;
      return;
    }
    firstCall = false;
    ran = true;

    CINE.stage = 'locating';
    const locP = bootLocP; // ① 全量定位（GPS 优先；脚本求值即发起）
    const fastP = bootFastP; // ①b 快速定位（高德 IP / 本地缓存）

    /* ② Phase6C3-B：相机动作全部挪到加载遮罩「后面」——
       就绪门在 3D Tiles 首批瓦片进场景之后再放行相机动作；遮罩则由就绪门在
       「相机落到最终视角 + 瓦片流静默」之后才收。于是冷启动的 shader link /
       瓦片 JSON 解析 burst 全部发生在遮罩期内，用户看不到长帧。
       就绪门缺失时退回旧行为（等遮罩收起后再跑电影镜头）。 */
    const bg = bridge.get('boot');
    const gated = !!(bg && typeof bg.whenCineMayStart === 'function');
    await (gated ? bg.whenCineMayStart(14000) : waitForLoaderHidden(30000));
    CINE.stage = 'space-set';
    setSpaceView(HOME.lon, HOME.lat); // 站位视角（太空层瓦片很便宜，先让 tileset 有东西可画）

    if (gated) {
      /* ③ 遮罩期落位，两段：
         (a) 先用快速定位（IP / 本地缓存）落位，不必等 GPS 脚本把冷启动拖长；
         (b) 再给 GPS 一个短窗口（GPS_REFINE_MS），拿到更准位置且明显不同时，
             在遮罩内再落位一次 —— 两次落位的瓦片流都在遮罩后面。
         直接落位（不做 4.2s 电影镜头）：镜头从 10,000km 拉到 12km 期间持续
         流瓦片，可见状态下必然出现 >100ms 长帧；遮罩期一次落位能把「落位 +
         瓦片流」整体压进遮罩。reveal 后用户看到的是已就位的本机位置画面。
         （Phase6C4 实测：把这两段等待摘出关键路径后 cine 由 4.2s 缩到 2.0s，
           但总遮罩时长 0 收益 —— 见下一条注释，瓶颈不在相机侧。已回退。） */
      const cached = lastKnown();
      let target = cached || { ...HOME, source: 'home' };
      /* Phase7A：先用缓存/家**立即**落位 —— 底图瓦片此刻才开始流，别为
         1.2s 的 IP 定位把整条金字塔链整体后推（实测落位后 2.2s 才到清晰层）。 */
      CINE.stage = 'preroll-jump';
      jumpTo(target);
      const fast = await Promise.race([fastP, sleep(1200).then(() => null)]);
      if (fast && valid(fast) && isFar(target, fast)) {
        target = fast;
        CINE.stage = 'preroll-jump:fast';
        jumpTo(target);
      }
      const better = await Promise.race([locP, sleep(GPS_REFINE_MS).then(() => null)]);
      if (better && valid(better) && isFar(target, better)) {
        target = better;
        CINE.stage = 'preroll-jump:gps';
        jumpTo(target);
      }
      CINE.geo = target;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      CINE.stage = 'done';
      CINE.done = true;
      try {
        window.dispatchEvent(new CustomEvent('gev:cine-done'));
      } catch (e) {
        /* ignore */
      }
      if (target.source && target.source !== 'home') {
        const tag =
          { 'amap-gps': '高德GPS', browser: '浏览器', 'amap-ip': '高德IP' }[
            target.source
          ] || target.source;
        toast('定位来源：' + tag + (target.city ? '（' + target.city + '）' : ''));
      } else {
        toast('未能获取设备定位，已定位到默认位置');
      }
      return;
    }

    /* 无就绪门（旧行为）：等定位结果后跑可见电影镜头 */
    const locSel =
      (await Promise.race([locP, sleep(LOC_CAP_MS).then(() => null)])) || null;
    const loc = locSel || lastKnown() || { ...HOME, source: 'home' };
    CINE.stage = locSel ? 'space-set:device' : 'space-set:loc-timeout';
    if (locSel && locSel.lon !== HOME.lon) setSpaceView(loc.lon, loc.lat);

    await sleep(MIN_DWELL_MS);
    tweenTo(loc); // ⑤ 电影镜头放大（仅无就绪门时可见）

    if (loc && loc.source && loc.source !== 'home') {
      const tag =
        { 'amap-gps': '高德GPS', browser: '浏览器', 'amap-ip': '高德IP' }[
          loc.source
        ] || loc.source;
      toast('定位来源：' + tag + (loc.city ? '（' + loc.city + '）' : ''));
    } else if (loc && loc.source === 'home') {
      toast('未能获取设备定位，已定位到默认位置');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
