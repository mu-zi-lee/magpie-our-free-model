import zen from './vendor/zen-free/provider.mjs';
import { createKiloPlugin } from './src/kilo.mjs';
import { createLocalPlugin } from './src/local.mjs';

// Magpie invokes every exported function as a separate provider plugin.
export async function ZenFreePlugin(input, options = {}) {
  if (options.zen === false) return {};
  return zen.server(input, options.zen ?? {});
}
export async function KiloFreePlugin(input, options = {}) {
  if (options.kilo === false) return {};
  return createKiloPlugin(input, options.kilo ?? {});
}
export async function LocalGatewayPlugin(input, options = {}) {
  if (options.local === false) return {};
  return createLocalPlugin(input, options.local ?? {});
}
