import { createReadingStore } from './reader-preferences.js';
import { createReaderProgressStore } from './reader-progress.js';
import { worldRecordHref } from './world-routing.js';

const WORLDS = new Set(['arknights', 'wh40k', 'ff14']);
const validId = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);

export function readSavedReading(storage, worldId) {
  if (!WORLDS.has(worldId)) return { positions: [], bookmarks: [] };
  const positions = createReaderProgressStore(storage, `ats.${worldId}.reader.progress.v1`)
    .entries().filter(([contextId, progress]) => validId(contextId) && validId(progress.eventId))
    .slice(0, 30).map(([contextId, progress]) => ({ contextId, eventId: progress.eventId }));
  return { positions, bookmarks: createReadingStore(storage, worldId).bookmarks() };
}

// Resolve saved IDs against the current world's records, never against stored titles or URLs.
export function resolveSavedReading(data, saved) {
  const worldId = data?.world?.id;
  if (!WORLDS.has(worldId)) return { positions: [], bookmarks: [], unavailable: 0 };
  const records = new Map();
  const roots = new Map((data.branches || []).map(branch => [branch.id, branch.name]));
  function index(branches, rootId) {
    for (const branch of branches || []) {
      const root = rootId || branch.id;
      const entries = [...(branch.eras || []).flatMap(era => era.events || []), ...(branch.endings || [])];
      for (const record of entries) {
        if (!validId(record.id)) continue;
        records.set(record.id, {
          eventId: record.id, title: record.title, date: record.dateDisplay || record.dateRaw || '',
          rootId: root, context: roots.get(root),
          href: worldRecordHref({ worldId, eventId: record.id, branchId: branch.id }),
        });
      }
      index(branch.subBranches, root);
    }
  }
  index(data.branches);
  // No timestamp exists in the older progress format: keep branch order, not a guessed recency order.
  const orderedPositions = [...new Set([...roots.keys(), ...saved.positions.map(position => position.contextId)])]
    .map(rootId => saved.positions.find(position => position.contextId === rootId)).filter(Boolean);
  const positions = orderedPositions.map(({ contextId, eventId }, index) => {
    const record = records.get(eventId);
    return record?.rootId === contextId ? record : {
      rootId: contextId, eventId, title: `暂时无法读取的阅读位置 ${index + 1}`,
      context: roots.get(contextId) || '', unavailable: true,
    };
  });
  const bookmarks = saved.bookmarks.map((id, index) => records.get(id) || {
    eventId: id, title: `暂时无法读取的书签 ${index + 1}`, unavailable: true,
  });
  return { positions, bookmarks, unavailable: [...positions, ...bookmarks].filter(item => item.unavailable).length };
}
