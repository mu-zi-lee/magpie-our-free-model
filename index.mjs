import { createManagedPlugin } from './src/managed.mjs';

export async function OurFreeModelPlugin(input, options = {}) {
  if (options.managed === false) return {};
  return createManagedPlugin(input, options.managed ?? {});
}
