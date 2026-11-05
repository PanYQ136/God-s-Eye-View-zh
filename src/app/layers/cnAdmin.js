import { createCnAdminLayer } from '../../layers/cnAdmin/index.js';

/** Wire the China administrative-boundary layer into the application. */
export function createApplicationCnAdmin(options) {
  return createCnAdminLayer(options);
}
