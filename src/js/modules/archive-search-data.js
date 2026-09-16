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

function storyReferences(stories) {
  const ids = new Set();
  const references = new Map();
  for (const story of stories) {
    if (typeof story.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(story.id)
      || typeof story.title !== 'string' || !story.title.trim() || !Array.isArray(story.steps) || !story.steps.length) {
      throw new Error(`Invalid search story: ${story.id}`);
    }
    if (ids.has(story.id)) throw new Error(`Duplicate search story: ${story.id}`);
    ids.add(story.id);
    story.steps.forEach((step, index) => {
      if (references.has(step.eventId)) throw new Error(`Duplicate story search reference: ${step.eventId}`);
      references.set(step.eventId, { story, step, position: `${index + 1} / ${story.steps.length}` });
    });
  }
  return references;
}

// Editorial context enriches the existing result; original text and destinations stay intact.
export function buildSearchRecords(worlds, stories = []) {
  const seen = new Set();
  const storyByRecord = storyReferences(stories);
  const unresolvedStories = new Set(storyByRecord.keys());
  const results = worlds.flatMap(data => {
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
      const guide = worldId === 'arknights' ? storyByRecord.get(recordId) : null;
      if (guide) unresolvedStories.delete(recordId);
      const title = guide?.step.title || record.title;
      const verification = worldId === 'wh40k'
        ? getWh40kVerificationState(record, excludedIds)
        : null;
      const fields = [
        ['标题', title], ['原记录标题', guide ? record.title : ''], ['正文', record.description],
        ['时间', record.dateDisplay], ['人物与地点', textValues([record.location, record.characters, record.tags]).join(' ')],
        ['结局条件', record.conditions], ['后续', record.aftermath],
        ['路线步骤', textValues(record.routeGuide).join(' ')],
        ['所属专题', [context.name, section.title, data.world.name].join(' ')],
        ['故事导读', guide ? [guide.story.title, guide.step.label, guide.step.summary].join('\n') : ''],
        ['日期提示', guide?.step.dateNote],
      ].filter(([, value]) => typeof value === 'string' && value);
      return {
        url: worldRecordHref({ worldId, eventId: recordId, branchId: context.id }),
        language: 'zh',
        content: textValues([
          record.title, record.description, record.dateDisplay, record.location,
          record.characters, record.tags, record.conditions, record.aftermath, record.routeGuide,
          context.name, section.title, data.world.name,
          ...(guide ? [title, guide.story.title, guide.step.label, guide.step.summary, guide.step.dateNote] : []),
        ]).join('\n').normalize('NFC'),
        meta: {
          title,
          recordId,
          world: data.world.name,
          worldId,
          context: context.name,
          section: section.title,
          date: record.dateDisplay || '',
          warning: verification?.code === 'disputed' ? verification.label : '',
          matchFields: JSON.stringify(fields),
          ...(guide ? {
            storyId: guide.story.id,
            storyTitle: guide.story.title,
            storyPosition: guide.position,
            storyLabel: guide.step.label,
            storySummary: guide.step.summary,
            dateNote: guide.step.dateNote || '',
          } : {}),
        },
        filters: { world: [worldId] },
      };
    }));
  });
  if (unresolvedStories.size) throw new Error(`Unresolved Arknights story search reference: ${[...unresolvedStories].join(', ')}`);
  return results;
}
