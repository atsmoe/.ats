import { createWorldArchive } from './world-archive.js';
import { worldRecordHref } from './world-routing.js';
import { getWh40kVerificationState } from './wh40k-verification.js';
export { segmentSearchText, searchTerms, compactSearchExcerpt } from './archive-search-text.js';

export const SEARCH_WORLD_IDS = Object.freeze(['arknights', 'wh40k', 'ff14']);

function textValues(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(textValues);
  return [];
}

// Derived exclusively from validated archives. No source content is rewritten.
export function buildSearchRecords(worlds) {
  const seen = new Set();
  return worlds.flatMap(data => {
    const worldId = data.world?.id;
    if (!SEARCH_WORLD_IDS.includes(worldId)) throw new Error(`Unknown search world: ${worldId}`);
    const archive = createWorldArchive(data).explore({ lens: 'chronicle' });
    const contexts = new Map(archive.contexts.map(context => [context.id, context]));
    const excludedIds = new Set(data.archive?.coverage?.excludedRecordIds || []);

    return archive.sections.flatMap(section => section.recordIds.map(recordId => {
      if (seen.has(recordId)) throw new Error(`Duplicate search record: ${recordId}`);
      seen.add(recordId);
      const record = archive.recordsById[recordId];
      if (!record.title?.trim()) throw new Error(`Search record has no title: ${recordId}`);
      const context = contexts.get(section.contextId);
      const verification = worldId === 'wh40k'
        ? getWh40kVerificationState(record, excludedIds)
        : null;
      const fields = [
        ['标题', record.title], ['正文', record.description],
        ['时间', record.dateDisplay], ['人物与地点', textValues([record.location, record.characters, record.tags]).join(' ')],
        ['结局条件', record.conditions], ['后续', record.aftermath],
        ['路线步骤', textValues(record.routeGuide).join(' ')],
        ['所属专题', [context.name, section.title, data.world.name].join(' ')],
      ].filter(([, value]) => typeof value === 'string' && value);
      return {
        url: worldRecordHref({ worldId, eventId: recordId, branchId: context.id }),
        language: 'zh',
        content: textValues([
          record.title, record.description, record.dateDisplay, record.location,
          record.characters, record.tags, record.conditions, record.aftermath, record.routeGuide,
          context.name, section.title, data.world.name,
        ]).join('\n').normalize('NFC'),
        meta: {
          title: record.title,
          recordId,
          world: data.world.name,
          worldId,
          context: context.name,
          section: section.title,
          date: record.dateDisplay || '',
          warning: verification?.code === 'disputed' ? verification.label : '',
          matchFields: JSON.stringify(fields),
        },
        filters: { world: [worldId] },
      };
    }));
  });
}
