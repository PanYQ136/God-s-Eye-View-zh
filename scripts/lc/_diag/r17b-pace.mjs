/* Phase5-FPS diag r17 — presentation cadence attribution (Ego Lite, RTX 3060)
   Battery of A/B layers on the live page, rAF interval histograms in vsync units.
   Writes .gev-logs/ego/phase5/r17-pace.json                                     */
const fs = await import("node:fs/promises");
const OUT = "D:/Hermes/gods-eye-view/.gev-logs/ego/phase5/";
const task = await claimTaskSpace(1);
console.log("space", task.spaceId, task.name, (await task.pages()).map((p) => p.label));
let page;
try { page = task.page("p1"); await page.url(); } catch { page = await task.newPage(); }
console.log("page", page.label);
try { await page.goto("http://127.0.0.1:4173/"); } catch (e) { console.log("goto err", String(e).slice(0, 120)); }
await page.waitForLoadState("load").catch(() => {});
for (let i = 0; i < 120; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(5000);

await page.evaluate(() => {
  window.__r17 = {
    sample(dur) {
      return new Promise((res) => {
        const ts = []; let stop = false;
        const tick = (t) => { ts.push(t); if (!stop) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        setTimeout(() => { stop = true; res(ts); }, dur);
      });
    },
    stat(ts) {
      const d = ts.slice(1).map((t, i) => t - ts[i]);
      const s = [...d].sort((a, b) => a - b);
      const sum = d.reduce((a, b) => a + b, 0);
      const vs = 1000 / 165;
      const buckets = {};
      for (const x of d) { const k = String(Math.round(x / vs)); buckets[k] = (buckets[k] || 0) + 1; }
      return { n: d.length, fps: +((d.length / sum) * 1000).toFixed(1),
        avg: +(sum / d.length).toFixed(2), p50: +s[Math.floor(s.length * 0.5)].toFixed(2),
        p95: +s[Math.floor(s.length * 0.95)].toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2),
        vsyncBuckets: buckets };
    },
  };
});

const measure = async (ms) => page.evaluate(async (d) => {
  const ts = await window.__r17.sample(d);
  return window.__r17.stat(ts);
}, ms);

const R = {};
const put = (k, v) => { R[k] = v; console.log(k, JSON.stringify(v)); };

put("env", await page.evaluate(() => ({
  dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight,
  screen: [screen.width, screen.height, screen.availWidth, screen.availHeight],
  vis: document.visibilityState, hidden: document.hidden,
  canvases: [...document.querySelectorAll("canvas")].map((c) => {
    const b = c.getBoundingClientRect();
    return { id: c.id || String(c.className) || "(anon)", css: [Math.round(b.width), Math.round(b.height)],
      dev: [c.width, c.height], disp: getComputedStyle(c).display };
  }),
  glass: (() => {
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (bf && bf !== "none") out.push({ id: el.id || String(el.className).slice(0, 40), bf, wc: cs.willChange });
    });
    return out;
  })(),
  cardCount: document.querySelectorAll(".gev-lc").length,
})));

put("A_baseline", await measure(6000));

// B) force per-frame damage: mutate a div every frame
await page.evaluate(() => {
  const d = document.createElement("div");
  d.id = "__r17anim";
  d.style.cssText = "position:fixed;left:2px;top:2px;width:60px;height:60px;background:red;opacity:.01;will-change:transform;pointer-events:none;z-index:99999";
  document.body.appendChild(d);
  let i = 0;
  const tick = () => { d.style.transform = "translateX(" + (i++ % 100) + "px)"; window.__r17animRaf = requestAnimationFrame(tick); };
  window.__r17animRaf = requestAnimationFrame(tick);
});
await page.waitForTimeout(500);
put("B_damage_anim", await measure(5000));

// C) kill backdrop-filter on everything (diagnostic only)
await page.evaluate(() => {
  const s = document.createElement("style");
  s.id = "__r17nobf";
  s.textContent = "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}";
  document.head.appendChild(s);
});
await page.waitForTimeout(600);
put("C_damage_noBF", await measure(5000));

// D) also hide all canvases (recoverable)
await page.evaluate(() => {
  window.__r17cv = [...document.querySelectorAll("canvas")].map((c) => [c, c.style.visibility]);
  for (const pair of window.__r17cv) pair[0].style.visibility = "hidden";
});
await page.waitForTimeout(600);
put("D_damage_noBF_noCanvas", await measure(5000));

// E) restore canvases, keep no-BF, drop the damage anim
await page.evaluate(() => {
  for (const pair of window.__r17cv || []) pair[0].style.visibility = pair[1] || "";
  cancelAnimationFrame(window.__r17animRaf);
  const d = document.getElementById("__r17anim"); if (d) d.remove();
});
await page.waitForTimeout(600);
put("E_noBF_noDamage", await measure(5000));

// F) restore BF (full baseline again) to confirm no drift
await page.evaluate(() => { const s = document.getElementById("__r17nobf"); if (s) s.remove(); });
await page.waitForTimeout(800);
put("F_restored", await measure(5000));

// G) GPU / compositor info via CDP
try {
  const si = await task.cdp("SystemInfo.getInfo", {});
  R.G_sysinfo = { devices: (si.gpu && si.gpu.devices || []).map((d) => ({ vendor: d.vendorString, device: d.deviceString, active: d.active })),
    aux: si.gpu && si.gpu.auxAttributes ? Object.fromEntries(Object.entries(si.gpu.auxAttributes).filter(([k]) => /gl_?renderer|angle|display|vsync|compositing|direct/i.test(k))) : null };
} catch (e) { R.G_sysinfo = "ERR " + String(e).slice(0, 200); }
console.log("G_sysinfo", JSON.stringify(R.G_sysinfo));

// H) flatten dpr via CDP emulation
try {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1360, height: 782, deviceScaleFactor: 1, mobile: false });
  await page.waitForTimeout(1200);
  R.H_env_dpr1 = await page.evaluate(() => ({ dpr: devicePixelRatio, iw: innerWidth, cesium: (document.querySelector("canvas") || {}).width }));
  put("H_dpr1", await measure(5000));
  await page.cdp("Emulation.clearDeviceMetricsOverride", {});
  await page.waitForTimeout(1200);
  put("I_after_clear", await measure(4000));
} catch (e) { R.H_err = String(e).slice(0, 200); console.log("H err", R.H_err); }

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(OUT + "r17-pace.json", JSON.stringify(R, null, 2));
console.log("WROTE", OUT + "r17-pace.json");
