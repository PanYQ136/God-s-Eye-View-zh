import { createCnTyphoonLayer } from '../../layers/cnTyphoon/index.js';

/** Wire the China Typhoon (NMC) layer into the application. */
export function createApplicationCnTyphoon(options) {
  return createCnTyphoonLayer(options);
}
