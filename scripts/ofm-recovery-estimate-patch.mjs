// Selective port of upstream 36734a8: discount image values, not field names.
export function patchRecoveryEstimate(source) {
  const before = `  const textBytes = Buffer.byteLength(JSON.stringify(payload, (key, value) => {
    if (key === 'image_url' || key === 'data') return '[image omitted from text estimate]'
    return value
  }), 'utf8')`;
  const after = `  const OMITTED = '[image omitted from text estimate]'
  const textBytes = Buffer.byteLength(JSON.stringify(payload, function (key, value) {
    if (key === 'image_url') {
      if (typeof value === 'string') return value.startsWith('data:') ? OMITTED : value
      if (value && typeof value === 'object' && typeof value.url === 'string' && value.url.startsWith('data:')) return OMITTED
      return value
    }
    if (key === 'data' && this?.type === 'base64' && typeof value === 'string') return OMITTED
    return value
  }), 'utf8')`;
  if (source.split(before).length !== 2) throw new Error('Recovery estimate upstream anchor changed');
  return source.replace(before, () => after);
}
