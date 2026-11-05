import { createCnTrafficLayer } from '../../layers/cnTraffic/index.js';

/** Wire the China realtime-traffic layer into the application. */
export function createApplicationCnTraffic(options) {
  return createCnTrafficLayer(options);
}
