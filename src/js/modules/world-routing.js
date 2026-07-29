const ARKNIGHTS_INTEGRATED_STRATEGY_PAGES = Object.freeze({
  'if-ceobe': 'ceobe',
  'if-phantom': 'phantom',
  'if-mizuki': 'mizuki',
  'if-sami': 'sami',
  'if-sarkaz-endless': 'sarkaz',
  'if-sui-realm': 'sui',
  'if-blackflow': 'blackflow',
});

function hashFor(eventId) {
  return eventId ? `#${encodeURIComponent(eventId)}` : '';
}

/**
 * Resolve a canonical record to the page that owns it.
 * Lens pages may expose records, but they never become a second canonical URL.
 */
export function worldRecordHref({ worldId, eventId, branchId } = {}) {
  const hash = hashFor(eventId);

  if (worldId === 'ff14') {
    return `./ff14-chronicle.html${hash}`;
  }

  if (worldId === 'wh40k') {
    return `./wh40k-chronicle.html${hash}`;
  }

  if (worldId === 'arknights') {
    const inferredBranchId = branchId || Object.keys(ARKNIGHTS_INTEGRATED_STRATEGY_PAGES)
      .find(candidate => eventId === candidate || eventId?.startsWith(`${candidate}-`));
    const topicSlug = ARKNIGHTS_INTEGRATED_STRATEGY_PAGES[inferredBranchId];
    if (topicSlug) {
      const recordQuery = eventId
        ? `?record=${encodeURIComponent(eventId)}`
        : '';
      return `./arknights-is-${topicSlug}.html${recordQuery}${hash}`;
    }
    return `./arknights-chronicle.html${hash}`;
  }

  return `./${encodeURIComponent(worldId || '')}.html${hash}`;
}
