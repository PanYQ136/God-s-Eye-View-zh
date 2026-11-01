/* Phase7D1 · 「这一帧到底有没有画面」的像素判据。
 *
 * 背景（实测）：Google Photorealistic 3D Tiles 在瓦片真正成片之前，会以
 * 「整屏均匀灰/黑几何」盖在最上层（prod 实测 std 0.43 / mean 83，持续 1.6s），
 * 底图即使已上屏也被它挡得看不见。所以「首批瓦片事件 = 可以切」是错的判据，
 * 只有在画布上读回真实像素才知道能不能切。
 *
 * 读回必须在 scene.postRender 里做：drawing buffer 在下一次合成后即失效
 * （Cesium 默认 preserveDrawingBuffer:false），postRender 期间仍是本帧内容。
 */

/** luma 均值/标准差/唯一色数（纯函数，可单测）。rgba 为 RGBA8 缓冲。 */
export function contentStats(rgba) {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  const uniq = new Set();
  for (let p = 0; p + 3 < rgba.length; p += 4) {
    const l = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    sum += l;
    sum2 += l * l;
    n += 1;
    uniq.add((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
  }
  if (!n) return { std: 0, uniq: 0, mean: 0, px: 0 };
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return {
    std: +std.toFixed(2),
    uniq: uniq.size,
    mean: +mean.toFixed(2),
    px: n,
  };
}

/** 中央取样框：按画布比例取（与 gate 的中心 640×420@1348×774 同区域）。 */
function centerRect(
  width,
  height,
  { widthRatio = 0.475, heightRatio = 0.543 } = {},
) {
  const w = Math.max(16, Math.min(width, Math.round(width * widthRatio)));
  const h = Math.max(16, Math.min(height, Math.round(height * heightRatio)));
  return {
    x: Math.max(0, Math.floor((width - w) / 2)),
    y: Math.max(0, Math.floor((height - h) / 2)),
    w,
    h,
  };
}

function glOf(scene) {
  const ctx = scene?.context;
  return ctx?._originalGLContext || ctx?._gl || null;
}

/**
 * 读回画布中央区域的像素统计（下一帧 postRender 时读取）。
 * @returns {Promise<{std:number,uniq:number,mean:number,px:number}|null>} 读不到时 null
 */
export function sampleCanvasContent(viewer, options = {}) {
  const { timeoutMs = 2000 } = options;
  return new Promise((resolve) => {
    const scene = viewer?.scene;
    if (!scene || scene.isDestroyed?.()) return resolve(null);
    const gl = glOf(scene);
    const canvas = scene.canvas;
    if (!gl || !canvas || !canvas.width || !canvas.height) return resolve(null);
    let settled = false;
    let remove = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        remove();
      } catch (_) {
        /* listener already gone */
      }
      resolve(value);
    };
    remove = scene.postRender.addEventListener(() => {
      try {
        const { x, y, w, h } = centerRect(canvas.width, canvas.height, options);
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        finish(contentStats(buf));
      } catch (_) {
        finish(null);
      }
    });
    try {
      scene.requestRender();
    } catch (_) {
      finish(null);
    }
    setTimeout(() => finish(null), timeoutMs);
  });
}

/** 与 gate 判据同尺度：中心区 std ≥18 且唯一色 ≥800 → 画面成片。 */
export function isSceneContentVisible(
  sample,
  { minStd = 18, minUniq = 800 } = {},
) {
  return Boolean(sample) && sample.std >= minStd && sample.uniq >= minUniq;
}
