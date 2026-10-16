// Persist minted free-lane sessions in the standalone data directory, not ~/.dsh.
export function patchSessionStore(source) {
  const before = `function sessionStorePath() {
  try { return path.join(path.resolve(resolveDshHome(), DATA_DIR_NAME), SESSION_MAP_FILE) } catch { return undefined }
}`;
  const after = `let sessionRoot
export function setSessionStoreRoot(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new TypeError('session store root must be an absolute path')
  if (sessionRoot === dir) return
  sessionRoot = dir
  sessions = undefined
}

function sessionStorePath() {
  try {
    const root = sessionRoot
      ?? (typeof process.env.OFM_HOME === 'string' && process.env.OFM_HOME.trim() !== '' ? process.env.OFM_HOME.trim() : undefined)
    if (root) return path.join(path.resolve(root), SESSION_MAP_FILE)
    return path.join(path.resolve(resolveDshHome(), DATA_DIR_NAME), SESSION_MAP_FILE)
  } catch { return undefined }
}`;
  if (source.split(before).length !== 2) throw new Error('Upstream free-lane session store path changed');
  return source.replace(before, after);
}
