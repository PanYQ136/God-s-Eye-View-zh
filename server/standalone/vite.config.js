import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
<<<<<<< ours
import { localMcpPlugin } from '../mcp/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { unwatchedRuntimeDirsPlugin } from './unwatched-cache.js';
=======
import { warmupPlugin } from './mini-speedup.js';
import { apiNotFoundPlugin } from './api-not-found.js';
// China-network helper: route outbound provider fetches through a local proxy
// (ClashMi 127.0.0.1:7890) when one is running. Remove this import + the
// bootstrapLocalProxy() call to revert. See server/standalone/local-proxy.mjs.
import { bootstrapLocalProxy } from './local-proxy.mjs';
>>>>>>> theirs

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
<<<<<<< ours
export function standaloneConfig(
  { command, mode },
  { nominatimStorageDir } = {},
) {
=======
export default defineConfig(async ({ command, mode }) => {
  await bootstrapLocalProxy();
>>>>>>> theirs
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const tools = standaloneVoiceTools();
  return createBrowserViteConfig({
<<<<<<< ours
    plugins: [
      ...localProviderPlugins({
        realtime: { tools },
        gemini: { tools },
        nominatimStorageDir,
      }),
      localMcpPlugin(),
      googleTokenUnavailablePlugin(),
      apiNotFoundPlugin(),
      unwatchedRuntimeDirsPlugin(),
    ],
=======
    plugins: [...localProviderPlugins(), warmupPlugin(), apiNotFoundPlugin()],
>>>>>>> theirs
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    photonUrl: process.env.PHOTON_URL,
    mapillaryToken: process.env.MAPILLARY_CLIENT_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
    allowedHosts: resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS),
    command,
  });
}

export default defineConfig(standaloneConfig);
