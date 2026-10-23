import { createTransitService } from '../../src/sources/transitService.js';
import { installTransitCircuit } from './transit-circuit.js';
export { fetchTransitFeed } from '../../src/sources/transitService.js';

/** Connect the reusable transit request service to development and preview. */
export function transitProxy(options = {}) {
  const service = createTransitService(options);
  const handleWithCircuit = installTransitCircuit(service);
  function install(server) {
    // 熔断层：超时/5xx 一律转成 200 + available:false，并给该 feed 10 分钟冷却，
    // 避免小程序每次刷新都撞一次死掉的城市上游（会刷 504 且白等十几秒）。
    server.middlewares.use('/api/transit', handleWithCircuit);
    server.httpServer?.once('close', service.close);
  }
  return {
    name: 'transit-proxy',
    closeBundle: service.close,
    configureServer: install,
    configurePreviewServer: install,
  };
}
