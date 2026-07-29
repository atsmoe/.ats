function cleanHash(hash = '') {
  const raw = String(hash).replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
}

export function legacyWh40kDestination(search = '', hash = '') {
  if (String(search)) return null;
  const recordId = cleanHash(hash);
  if (!/^wh-\d+$/.test(recordId)) return null;
  return `wh40k-chronicle.html#${encodeURIComponent(recordId)}`;
}
