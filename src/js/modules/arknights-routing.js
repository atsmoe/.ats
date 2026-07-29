import { worldRecordHref } from './world-routing.js';

const INTEGRATED_RECORD = /^if-(?:ceobe|phantom|mizuki|sami|sarkaz-endless|sui-realm|blackflow)-ending-\d+$/;

function cleanHash(hash = '') {
  const raw = String(hash).replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
}

export function legacyArknightsDestination(search = '', hash = '') {
  const params = new URLSearchParams(search);
  if (params.get('dossier') === 'deep-blue-observation') {
    const destination = new URL('http://archive.local/arknights-is-mizuki.html');
    const recordId = params.get('record');
    if (recordId) destination.searchParams.set('record', recordId);
    return `${destination.pathname.slice(1)}${destination.search}`;
  }

  if (String(search)) return null;
  const recordId = cleanHash(hash);
  if (!/^evt-\d+$/.test(recordId) && !INTEGRATED_RECORD.test(recordId)) return null;
  return worldRecordHref({ worldId: 'arknights', eventId: recordId }).replace(/^\.\//, '');
}
