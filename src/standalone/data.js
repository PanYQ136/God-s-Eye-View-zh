import { createApplicationData } from '../app/data.js';
import { getStandaloneCatalog } from './catalog.js';
export async function createStandaloneData(options) {
  return createApplicationData({
    catalog: options?.catalog ?? (await getStandaloneCatalog()),
    ...options,
  });
}
