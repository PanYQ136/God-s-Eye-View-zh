import { createCnQuakesLayer } from '../../layers/cnQuakes/index.js';

/** Wire the China Earthquake (CENC) layer into the application. */
export function createApplicationCnQuakes(options) {
  return createCnQuakesLayer(options);
}
