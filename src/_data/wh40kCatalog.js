const fs = require('fs');
const path = require('path');

function collectBranchRecords(branch, records) {
  for (const era of branch.eras || []) {
    for (const record of era.events || []) records.set(record.id, record);
  }
  for (const record of branch.endings || []) records.set(record.id, record);
  for (const child of branch.subBranches || []) collectBranchRecords(child, records);
}

function resolveRecords(recordIds, records) {
  return (recordIds || []).map(recordId => {
    const record = records.get(recordId);
    if (!record) throw new Error(`WH40K catalog references missing record ${recordId}`);
    return {
      id: record.id,
      title: record.title,
      dateDisplay: record.dateDisplay || '',
    };
  });
}

module.exports = function () {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'wh40k.json'), 'utf8'));
  const records = new Map();
  const excludedRecordIds = new Set(source.archive.coverage.excludedRecordIds || []);

  for (const entity of source.subEntities || []) {
    for (const branch of entity.timeline?.branches || []) collectBranchRecords(branch, records);
  }

  const mainline = source.subEntities
    .flatMap(entity => entity.timeline?.branches || [])
    .find(branch => branch.id === 'mainline');
  const orderedChronicleEras = (mainline?.eras || [])
    .map((era, index) => ({
      ...era,
      sourceIndex: index,
    }))
    .sort((left, right) => {
      const leftRank = Number(left.chronologyRank ?? left.order ?? left.sourceIndex);
      const rightRank = Number(right.chronologyRank ?? right.order ?? right.sourceIndex);
      return leftRank - rightRank || left.sourceIndex - right.sourceIndex;
    });
  const chronicleEras = orderedChronicleEras
    .map(era => ({
      ...era,
      events: (era.events || []).filter(record => !excludedRecordIds.has(record.id)),
    }))
    .filter(era => era.events.length > 0);
  const excludedChronicleRecords = orderedChronicleEras.flatMap(era => (
    (era.events || [])
      .filter(record => excludedRecordIds.has(record.id))
      .map(record => ({ ...record, eraTitle: era.title }))
  ));

  return {
    coverage: source.archive.coverage,
    chronicleEras,
    excludedChronicleRecords,
    factions: source.archive.factionFamilies.map(faction => ({
      ...faction,
      records: resolveRecords(faction.recordIds, records),
    })),
    warZones: source.archive.warZones.map(zone => ({
      ...zone,
      records: resolveRecords(zone.recordIds, records),
    })),
  };
};
