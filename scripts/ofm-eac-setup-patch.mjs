// Reproducible diagnostics patch; OAuth, signatures and authorization are unchanged.
export function patchEacDiagnostics(source) {
  const pairs = [
    ['fetch = directFetch })', 'fetch = directFetch, setup })'],
    ["authorized: lane?.mode === 'direct', login: '' }", "authorized: lane?.mode === 'direct', login: '', ...setup ? { setup } : {} }"],
    ['savedAt: user?.savedAt ?? 0 }', 'savedAt: user?.savedAt ?? 0, ...setup ? { setup } : {} }'],
  ];
  for (const [before, after] of pairs) {
    if (source.split(before).length !== 2) throw new Error('Upstream EAC diagnostic integration changed');
    source = source.replace(before, after);
  }
  return source;
}

export function patchEacSetupUi(source) {
  const before = 'a("eac.noLane"));const x=t.repo';
  if (source.split(before).length !== 2) throw new Error('Upstream EAC UI integration changed');
  return source.replace(before, 't.setup?.message??a("eac.noLane"));const x=t.repo');
}
