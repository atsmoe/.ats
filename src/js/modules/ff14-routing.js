function cleanHash(hash = '') {
  const raw = String(hash).replace(/^#/, '');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
}

/**
 * The former all-in-one FFXIV page accepted record hashes. Keep those links
 * alive by moving only canonical-record hashes to the new chronicle owner.
 */
export function legacyFf14Destination(search = '', hash = '') {
  if (String(search)) return null;
  const recordId = cleanHash(hash);
  const isCanonicalRecord = /^ff14-(?:\d+|s\d+-\d+|a-\d+|l-\d+)$/.test(recordId);
  if (!isCanonicalRecord) return null;
  return `ff14-chronicle.html#${encodeURIComponent(recordId)}`;
}

export function resolveFf14Selection(
  search = '',
  hash = '',
  parameter,
  allowedIds = [],
) {
  const allowed = new Set(allowedIds);
  const fromQuery = new URLSearchParams(search).get(parameter);
  if (allowed.has(fromQuery)) return fromQuery;

  const fromHash = cleanHash(hash);
  if (allowed.has(fromHash)) return fromHash;

  return allowedIds[0] || null;
}

export function ff14SelectionUrl(href, parameter, value) {
  const url = new URL(href);
  url.searchParams.set(parameter, value);
  url.hash = value;
  return `${url.pathname}${url.search}${url.hash}`;
}
