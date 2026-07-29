import { createWorldArchive } from './world-archive.js';

function catalog(data, key) {
  const value = data?.[key] ?? data?.archive?.[key] ?? [];
  if (!Array.isArray(value)) {
    throw new Error(`Warhammer archive catalog "${key}" must be an array`);
  }
  return value;
}

function validateCatalog(items, label, recordsById) {
  const ids = new Set();

  for (const item of items) {
    if (!item?.id) throw new Error(`${label} is missing an ID`);
    if (ids.has(item.id)) throw new Error(`Duplicate ${label.toLowerCase()} ID "${item.id}"`);
    ids.add(item.id);

    for (const recordId of item.recordIds || []) {
      if (!recordsById[recordId]) {
        throw new Error(`${label} "${item.id}" references unknown record "${recordId}"`);
      }
    }
  }
}

function projectCatalogItem(item, recordsById) {
  return {
    ...item,
    recordIds: [...(item.recordIds || [])],
    records: (item.recordIds || []).map(recordId => recordsById[recordId]),
  };
}

function recordsFor(items, recordsById) {
  const selected = Object.create(null);
  for (const item of items) {
    for (const recordId of item.recordIds || []) {
      selected[recordId] = recordsById[recordId];
    }
  }
  return selected;
}

/**
 * Adds Warhammer-specific reference-catalog lenses to the canonical world archive.
 * Catalog projections retain the exact record objects owned by WorldArchive.
 */
export function createWh40kArchive(data) {
  const canonicalArchive = createWorldArchive(data);
  const chronicle = canonicalArchive.explore({ lens: 'chronicle' });
  const factionFamilies = catalog(data, 'factionFamilies');
  const warZones = catalog(data, 'warZones');

  validateCatalog(factionFamilies, 'Faction', chronicle.recordsById);
  validateCatalog(warZones, 'War zone', chronicle.recordsById);

  function snapshotBase(lens) {
    return {
      schemaVersion: chronicle.schemaVersion,
      sourceVersion: chronicle.sourceVersion,
      lens,
      world: chronicle.world,
      coverage: chronicle.coverage,
    };
  }

  return Object.freeze({
    explore(request = {}) {
      const lens = request.lens || 'chronicle';

      if (lens === 'faction') {
        const selected = request.factionId
          ? factionFamilies.filter(item => item.id === request.factionId)
          : factionFamilies;
        if (request.factionId && selected.length === 0) {
          throw new Error(`Faction "${request.factionId}" was not found`);
        }
        const projected = selected.map(item => projectCatalogItem(
          item,
          chronicle.recordsById,
        ));

        return {
          ...snapshotBase('faction'),
          faction: request.factionId ? projected[0] : null,
          factions: projected,
          records: projected.flatMap(item => item.records),
          recordsById: recordsFor(selected, chronicle.recordsById),
          relations: [],
        };
      }

      if (lens === 'war-zones') {
        const selected = request.warZoneId
          ? warZones.filter(item => item.id === request.warZoneId)
          : warZones;
        if (request.warZoneId && selected.length === 0) {
          throw new Error(`War zone "${request.warZoneId}" was not found`);
        }
        const projected = selected.map(item => projectCatalogItem(
          item,
          chronicle.recordsById,
        ));

        return {
          ...snapshotBase('war-zones'),
          warZone: request.warZoneId ? projected[0] : null,
          warZones: projected,
          records: projected.flatMap(item => item.records),
          recordsById: recordsFor(selected, chronicle.recordsById),
          relations: [],
        };
      }

      return canonicalArchive.explore(request);
    },
  });
}
