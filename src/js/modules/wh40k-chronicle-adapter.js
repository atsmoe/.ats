export const DEFAULT_UNSUPPORTED_WH40K_RECORD_IDS = Object.freeze([
  'wh-001',
  'wh-007',
  'wh-009',
]);

function eraRank(era) {
  const value = era?.chronologyRank ?? era?.order;
  if (value === undefined || value === null || value === '') return null;
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : null;
}

function prepareBranch(branch, unsupportedIds, preserveIds) {
  const eras = (branch.eras || [])
    .map((era, index) => ({
      era: {
        ...era,
        events: (era.events || []).filter(record => (
          !unsupportedIds.has(record.id) || preserveIds.has(record.id)
        )),
      },
      index,
      rank: eraRank(era),
    }))
    .sort((left, right) => {
      if (left.rank === null && right.rank === null) return left.index - right.index;
      if (left.rank === null) return 1;
      if (right.rank === null) return -1;
      return left.rank - right.rank || left.index - right.index;
    })
    .map(entry => entry.era)
    .filter(era => era.events.length > 0);
  const endings = (branch.endings || [])
    .filter(record => !unsupportedIds.has(record.id) || preserveIds.has(record.id));
  const subBranches = (branch.subBranches || [])
    .map(child => prepareBranch(child, unsupportedIds, preserveIds));

  return {
    ...branch,
    eras,
    endings,
    events: [
      ...eras.flatMap(era => era.events),
      ...endings,
    ],
    ...(branch.subBranches ? { subBranches } : {}),
  };
}

function prepareEntities(entities, unsupportedIds, preserveIds) {
  return (entities || []).map(entity => {
    if (!entity.timeline?.branches) return entity;
    return {
      ...entity,
      timeline: {
        ...entity.timeline,
        branches: entity.timeline.branches
          .map(branch => prepareBranch(branch, unsupportedIds, preserveIds)),
      },
    };
  });
}

/**
 * Creates a structurally independent, chronologically ordered WH40K data view.
 * Record objects remain canonical references; only containers are rebuilt.
 */
export function prepareWh40kChronicle(data, options = {}) {
  const unsupportedIds = new Set(
    options.unsupportedRecordIds
      ?? data?.coverage?.excludedRecordIds
      ?? data?.archive?.coverage?.excludedRecordIds
      ?? DEFAULT_UNSUPPORTED_WH40K_RECORD_IDS,
  );
  const preserveIds = new Set(options.preserveRecordIds || []);
  const prepared = { ...data };

  if (Array.isArray(data?.branches)) {
    prepared.branches = data.branches
      .map(branch => prepareBranch(branch, unsupportedIds, preserveIds));
  }
  if (Array.isArray(data?.subEntities)) {
    prepared.subEntities = prepareEntities(data.subEntities, unsupportedIds, preserveIds);
  }

  return prepared;
}
