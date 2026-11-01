/**
 * 服务端预热：服务起来后后台先打一遍重接口（风场整场、气旋、发射计划、TLE），
 * 用户第一次点开这些图层时缓存已经建好，省掉 2~6 秒等待。
 *
 * 注：gzip 不放在这里。vite 的 configureServer 阶段拿不到 httpServer，
 * 用 middlewares.use 注册又会排在 provider 的 mount 后面（req.url 已被剥前缀、
 * 头部也可能已经发出）。gzip 改在 server/providers/local.js 里包住第一个 provider
 * 的 configureServer，实现见 providers/send-json.js 的 gzipRes()。
 */
export function warmupPlugin() {
  return {
    name: 'gev-warmup',
    configureServer(server) {
      const run = () => {
        const port =
          (server.config.server && server.config.server.port) ||
          process.env.PORT ||
          4173;
        const base = `http://127.0.0.1:${port}`;
        [
          '/api/wind?model=gfs',
          '/api/cyclones',
          '/api/launches',
          '/api/celestrak/stations',
        ].forEach((u, i) => {
          setTimeout(
            () => {
              fetch(base + u)
                .then((r) => r.text())
                .catch(() => {});
            },
            1500 + i * 800,
          );
        });
      };
      if (!server.httpServer) return;
      if (server.httpServer.listening) run();
      else server.httpServer.once('listening', run);
    },
  };
}
