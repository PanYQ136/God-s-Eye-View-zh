import { createApplicationControls } from '../app/controls.js';
import { getStandaloneCatalog } from './catalog.js';
export async function createStandaloneControls(options) {
  return createApplicationControls({
    catalog: options?.catalog ?? (await getStandaloneCatalog()),
    ...options,
  });
}
