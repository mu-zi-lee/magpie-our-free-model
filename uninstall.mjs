import { cleanupInstallation } from './src/installation-state.mjs';

// Magpie loads this declared entry even when the normal provider is disabled.
// It never starts Node, downloads dependencies, or loads EAC credential material.
export default async function uninstall(input, options = {}) {
  await cleanupInstallation(input, options.managed && typeof options.managed === 'object' ? options.managed : {});
}
