/* ════════════════════════════════════════════════════════════════════════════
   shaderCompileCache.js —— 启动期 shader 编译去重（不改渲染结果）

   证据（t_ff183910，prod 3 跑 · scripts/lc/boot-upload-ab.mjs）：
     冷启动期 `compileShader` 共 34–36 次，其中**只有 23 份不同源码** ——
     同一个 295 字符的顶点着色器被编译了 **10–12 次**（同一 VS 配 12 个不同
     FS 的 program，Cesium 的 ShaderProgram 每个 program 各自编译一份），
     单次 6.4ms，合计 ≈77ms；再加上其它重复，shader 段总耗时 168–371ms。

   做法：在 WebGL 原型上做一层「同 (context, type, source) 只编译一次」的缓存。
     · `shaderSource` 命中缓存 → 记下映射、**不再**灌源码；
     · `compileShader` 命中缓存 → 直接返回（不编译）；
     · `attachShader` / `getShaderParameter` / `getShaderInfoLog` → 把调用重定向到
       已编译的规范 shader，因此 Cesium 的「编译状态检查 + 链接」看到的是它自己的
       shader 句柄，实际用的是那份唯一编译结果；
     · `deleteShader(规范 shader)` → 不删（被多个 program 共享）。
     WebGL 允许多个 program 共享同一个 shader 对象，且着色器编译完成后不可变 ——
     同源码 + 同类型 ⇒ 同编译结果，所以这不改变任何渲染输出。

   保守开关：`?shadercache=0` 关闭（A/B 用），默认开启；任何异常都退回原路径
   （所有包装器都 try/catch 到原始实现）。
   ════════════════════════════════════════════════════════════════════════════ */

const SHADER_TYPE = 0x8b4f;
const COMPILE_STATUS = 0x8b81;

const stats = {
  installed: false,
  shaderSources: 0,
  compiles: 0,
  compileMs: 0,
  reuses: 0,
  savedMs: 0,
  hitKeys: [],
};

export function installShaderCompileCache({ enabled = true } = {}) {
  if (!enabled) return stats;
  if (typeof WebGLRenderingContext === 'undefined') return stats;
  const ctors = [WebGLRenderingContext];
  if (typeof WebGL2RenderingContext !== 'undefined')
    ctors.push(WebGL2RenderingContext);

  for (const Ctor of ctors) {
    const P = Ctor && Ctor.prototype;
    if (!P || P.__gevShaderCompileCache) continue;
    P.__gevShaderCompileCache = true;

    const byContext = new WeakMap(); // ctx -> Map(key -> { shader, ms })
    const sourceOf = new WeakMap(); // 应用 shader -> source
    const reuseOf = new WeakMap(); // 应用 shader -> 规范 shader
    const canonical = new WeakSet(); // 规范 shader（不可删）

    const cacheOf = (ctx) => {
      let m = byContext.get(ctx);
      if (!m) {
        m = new Map();
        byContext.set(ctx, m);
      }
      return m;
    };

    const origSource = P.shaderSource;
    const origCompile = P.compileShader;
    const origAttach = P.attachShader;
    const origDelete = P.deleteShader;
    const origGetParam = P.getShaderParameter;
    const origGetInfo = P.getShaderInfoLog;

    P.shaderSource = function (shader, src) {
      try {
        const text = String(src);
        sourceOf.set(shader, text);
        let type = 0;
        try {
          type = origGetParam.call(this, shader, SHADER_TYPE) || 0;
        } catch (_) {}
        const cache = cacheOf(this);
        const key = `${type}:${text}`;
        const hit = cache.get(key);
        if (hit) {
          reuseOf.set(shader, hit.shader);
          stats.reuses += 1;
          stats.savedMs += hit.ms;
          if (stats.hitKeys.length < 12)
            stats.hitKeys.push({
              type,
              len: text.length,
              ms: +hit.ms.toFixed(2),
            });
          return; // 命中：不再向这个句柄灌源码
        }
        return origSource.call(this, shader, src);
      } catch (_) {
        return origSource.call(this, shader, src);
      }
    };

    P.compileShader = function (shader) {
      try {
        if (reuseOf.has(shader)) return;
        const t = performance.now();
        const out = origCompile.call(this, shader);
        const ms = performance.now() - t;
        let ok = false;
        try {
          ok = Boolean(origGetParam.call(this, shader, COMPILE_STATUS));
        } catch (_) {}
        if (ok) {
          const text = sourceOf.get(shader);
          let type = 0;
          try {
            type = origGetParam.call(this, shader, SHADER_TYPE) || 0;
          } catch (_) {}
          if (typeof text === 'string')
            cacheOf(this).set(`${type}:${text}`, { shader, ms });
          canonical.add(shader);
        }
        stats.compiles += 1;
        stats.compileMs += ms;
        return out;
      } catch (_) {
        return origCompile.call(this, shader);
      }
    };

    P.attachShader = function (program, shader) {
      const real = reuseOf.get(shader) || shader;
      return origAttach.call(this, program, real);
    };

    P.getShaderParameter = function (shader, pname) {
      const real = reuseOf.get(shader) || shader;
      return origGetParam.call(this, real, pname);
    };

    P.getShaderInfoLog = function (shader) {
      const real = reuseOf.get(shader) || shader;
      return origGetInfo.call(this, real);
    };

    P.deleteShader = function (shader) {
      if (canonical.has(shader)) return; // 共享对象，不能删
      return origDelete.call(this, shader);
    };
  }

  stats.installed = true;
  return stats;
}

/** 诊断入口（harness / gate 读；纯读，无副作用） */
if (typeof window !== 'undefined') {
  window.__gevShaderCache = stats;
}
