// Select a verified upstream bundle without modifying its channel/login logic.
export function patchChannelSource(file, source) {
  const pairs = file.endsWith('/service.mjs') ? [
    ['probe, eacCredential, eacSetup,', 'probe, eacCredential, eacSetup, channelBusiness,'],
    ['createChannelRuntime({ dataDir, logger, stats: stores.stats })', 'createChannelRuntime({ dataDir, logger, stats: stores.stats, businessPath: channelBusiness })'],
  ] : file.endsWith('/runtime.mjs') ? [
    ['createChannelRuntime({ dataDir, logger = console, stats })', 'createChannelRuntime({ dataDir, logger = console, stats, businessPath })'],
    ['workerData: { dataDir }', 'workerData: { dataDir, businessPath }'],
  ] : [
    ["import {\n  apply,", "const {\n  apply,"],
    ["} from './business.mjs'", "} = await import(workerData.businessPath ?? new URL('./business.mjs', import.meta.url).href)"],
  ];
  for (const [before, after] of pairs) {
    if (source.split(before).length !== 2) throw new Error('Upstream channel source integration changed');
    source = source.replace(before, after);
  }
  return source;
}
