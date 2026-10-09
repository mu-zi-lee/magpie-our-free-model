// Optional legacy entry. The normal package entry registers only Our Free Model.
import zen from './vendor/zen-free/provider.mjs';
import { createKiloPlugin } from './src/kilo.mjs';
import { createLocalPlugin } from './src/local.mjs';

export async function ZenFreePlugin(input, options = {}) {
  if (options.zen === false) return {};
  const hooks = await zen.server(input, options.zen ?? {});
  const config = hooks.config;
  hooks.config = async cfg => {
    await config(cfg);
    cfg.provider['our-free-zen'].name = 'Our Free Model · Zen';
  };
  return hooks;
}
export async function KiloFreePlugin(input, options = {}) {
  if (options.kilo === false) return {};
  return createKiloPlugin(input, options.kilo ?? {});
}
export async function LocalGatewayPlugin(input, options = {}) {
  if (options.local === false) return {};
  return createLocalPlugin(input, options.local ?? {});
}
