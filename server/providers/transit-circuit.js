/**
 * 公交实时（GTFS-RT）代理 —— 带熔断与超时兜底
 *
 * 背景：`/api/transit/vehicles/capmetro-austin` 这类上游常年 504（城市侧 RT 服务挂了），
 * 小程序每次刷新都会撞一次，控制台刷一片红色 504，还白等十几秒。
 *
 * 这里在原有 transitService 外面加一层：
 *   1. 单次请求最多等 9s，超时就返回 200 + available:false（不再 504）；
 *   2. 同一 feed 失败后进入 10 分钟冷却，冷却期内直接快速返回，不再打上游；
 *   3. 成功一次就清掉冷却。
 *
 * 为什么用 200：对客户端来说「这个城市的实时数据现在没有」是正常业务状态，
 * 不是网络错误；用 504 会让所有客户端把它当异常反复重试 + 打日志。
 */

const FEED_TIMEOUT_MS = 9000;
const COOLDOWN_MS = 10 * 60 * 1000;

function feedIdFromUrl(rawUrl) {
  // 注意：这个中间件挂在 /api/transit 上，req.url 里已经没有前缀了，
  // 可能是 '/vehicles/xxx'，也可能是 '/api/transit/vehicles/xxx'，两种都要认。
  const m = String(rawUrl || '').match(/(?:transit\/)?vehicles\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function installTransitCircuit(service) {
  /* 2026-11-01：冷却表原先挂在模块作用域，跨插件实例共享 —— 同一进程里重建一次
     transitProxy（预览服务器、测试、热重启）会继承上一次的冷却，表现为「新实例
     第一次请求就被熔断挡住、一次上游都没打」。改为随熔断层实例创建，状态边界
     与 service 对齐；单进程生产行为不变。 */
  // feedId → 冷却截止时间戳
  const cooling = new Map();

  return async function handleWithCircuit(req, res) {
    const url = `/api/transit${req.url || '/'}`;
    const feedId = feedIdFromUrl(req.url);

    if (feedId) {
      const until = cooling.get(feedId) || 0;
      if (Date.now() < until) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'x-transit-circuit': 'open',
        });
        res.end(
          JSON.stringify({
            feed: feedId,
            available: false,
            vehicles: [],
            reason: 'upstream_unavailable',
            retryInSec: Math.round((until - Date.now()) / 1000),
          }),
        );
        return;
      }
    }

    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), FEED_TIMEOUT_MS);
    });

    try {
      const response = await Promise.race([
        service.handle({ url: `http://localhost${url}`, method: req.method }),
        timeout,
      ]);
      clearTimeout(timer);

      if (!response || response.__timeout) {
        if (feedId) cooling.set(feedId, Date.now() + COOLDOWN_MS);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'x-transit-circuit': 'timeout',
        });
        res.end(
          JSON.stringify({
            feed: feedId,
            available: false,
            vehicles: [],
            reason: 'upstream_timeout',
            retryInSec: Math.round(COOLDOWN_MS / 1000),
          }),
        );
        return;
      }

      const body = await response.text();
      if (response.status >= 500) {
        /* 2026-11-01：冷却时长优先沿用上游/服务层给的 Retry-After。
           固定 10 分钟会把 transitService 自己的指数退避（秒级阶梯）完全遮蔽 ——
           一次瞬时 500 就让该城市十分钟不再被尝试，退避阶梯也成了死代码。
           仍然限制在 [5s, COOLDOWN_MS] 之间，防止上游给出离谱的值。 */
        const retryAfterSec = Number(response.headers?.get?.('retry-after'));
        const cooldownMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(COOLDOWN_MS, Math.max(5_000, retryAfterSec * 1000))
            : COOLDOWN_MS;
        if (feedId) cooling.set(feedId, Date.now() + cooldownMs);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'x-transit-circuit': 'upstream-5xx',
        });
        res.end(
          JSON.stringify({
            feed: feedId,
            available: false,
            vehicles: [],
            reason: 'upstream_error',
            upstreamStatus: response.status,
            retryInSec: Math.round(cooldownMs / 1000),
          }),
        );
        return;
      }

      if (feedId) cooling.delete(feedId);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(body);
    } catch (err) {
      clearTimeout(timer);
      if (feedId) cooling.set(feedId, Date.now() + COOLDOWN_MS);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'x-transit-circuit': 'error',
      });
      res.end(
        JSON.stringify({
          feed: feedId,
          available: false,
          vehicles: [],
          reason: 'upstream_exception',
          message: String((err && err.message) || err).slice(0, 120),
          retryInSec: Math.round(COOLDOWN_MS / 1000),
        }),
      );
    }
  };
}
