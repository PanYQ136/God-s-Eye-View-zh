/**
 * @file 卫星底图数据源的区域自适应检测（CN 反向移植）。
 *
 * 判断逻辑（总预算 ~2.5s，任何一步都有兜底，绝不阻塞启动超过预算）：
 *
 * ① 会话缓存：sessionStorage 已有结论直接复用（同一会话刷新不重复探测）。
 * ② 并行可达性探测（各 1.5s 超时，no-cors 不透明请求，仅测连通性）：
 *      · CN 探针  = 高德瓦片一张（webst01.is.autonavi.com，与实际底图同域）
 *      · 全球探针 = gstatic generate_204（Google 静态基础设施）
 * ③ 结论合成：
 *      · CN 通 && 全球不通 → 'cn'（典型中国大陆网络）
 *      · 全球通 && CN 不通 → 'global'（典型海外网络）
 *      · 双通 → 时区/语言倾向优先（海外 VPN 或全球加速场景，保持 global）
 *      · 双不通 → 时区倾向，兜底 'global'（保持上游默认行为）
 *
 * 时区先验：Intl timezone ∈ {Asia/Shanghai, Asia/Urumqi, Asia/Chongqing,
 * Asia/Harbin} 视为 CN 倾向。探测器在 CN 网络下也会给出一致结论，
 * 时区只用于「双通/双不通」时的倾向破平与缓存前写。
 *
 * 探测结果只影响**默认底图**的选择；用户仍可在图层切换 chip 中随时
 * 手动切换任意底图（含仍显示但标记不可用的 Google 3D）。
 */

const CN_PROBE_URL =
  'https://webst01.is.autonavi.com/appmaptile?style=6&x=1&y=1&z=3';
const GLOBAL_PROBE_URL = 'https://www.gstatic.com/generate_204';
const PROBE_TIMEOUT_MS = 1500;
const CACHE_KEY = 'gev:base-source-preference';

const CN_TIMEZONES = new Set([
  'Asia/Shanghai',
  'Asia/Urumqi',
  'Asia/Chongqing',
  'Asia/Harbin',
  'Asia/Kashgar',
]);

/** 同步先验：时区/语言是否倾向中国大陆。 */
export function hasChinaLocaleHint(timeZone) {
  const tz =
    timeZone ||
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return '';
      }
    })();
  return CN_TIMEZONES.has(tz);
}

function probe(url, timeoutMs, fetchImpl) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    try {
      void fetchImpl(url, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: AbortSignal.timeout
          ? AbortSignal.timeout(timeoutMs)
          : undefined,
      }).then(
        () => {
          clearTimeout(timer);
          done(true);
        },
        () => {
          clearTimeout(timer);
          done(false);
        },
      );
    } catch {
      clearTimeout(timer);
      done(false);
    }
  });
}

function readSessionCache(sessionStorage) {
  try {
    const value = sessionStorage.getItem(CACHE_KEY);
    return value === 'cn' || value === 'global' ? value : null;
  } catch {
    return null;
  }
}

function writeSessionCache(sessionStorage, value) {
  try {
    sessionStorage.setItem(CACHE_KEY, value);
  } catch {
    /* 隐私模式等场景下写入失败不影响结论 */
  }
}

/**
 * 检测当前用户应使用的默认卫星底图区域。
 *
 * @param {{ fetchImpl?: Function, sessionStorage?: Storage, timeZone?: string,
 *           probeTimeoutMs?: number, now?: () => number }} [options]
 * @returns {Promise<{region: 'cn'|'global', reason: string}>}
 */
export async function detectBaseSourceRegion(options = {}) {
  const fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  const storage =
    options.sessionStorage ??
    (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;

  const cached = storage ? readSessionCache(storage) : null;
  if (cached) return { region: cached, reason: 'session-cache' };

  const chinaHint = hasChinaLocaleHint(options.timeZone);

  const [cnReachable, globalReachable] = await Promise.all([
    probe(CN_PROBE_URL, probeTimeoutMs, fetchImpl),
    probe(GLOBAL_PROBE_URL, probeTimeoutMs, fetchImpl),
  ]);

  let region;
  let reason;
  if (cnReachable && !globalReachable) {
    region = 'cn';
    reason = 'probe: cn reachable, global blocked';
  } else if (globalReachable && !cnReachable) {
    region = 'global';
    reason = 'probe: global reachable, cn blocked';
  } else if (cnReachable && globalReachable) {
    // 双通（海外 VPN / 全球加速）：倾向优先，保持上游全球体验。
    region = chinaHint ? 'cn' : 'global';
    reason = `probe: both reachable; locale hint ${chinaHint ? 'cn' : 'global'}`;
  } else {
    // 双不通（探测被策略拦截）：按倾向兜底，未知环境保持 global。
    region = chinaHint ? 'cn' : 'global';
    reason = `probe: both blocked; locale hint ${chinaHint ? 'cn' : 'global'}`;
  }

  if (storage) writeSessionCache(storage, region);
  return { region, reason };
}
