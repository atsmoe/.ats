const fs = require('fs');
const path = require('path');
const { loadFf14AdmittedData } = require('../../scripts/lib/load-ff14-admitted-data.js');

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
    if (!record) throw new Error(`FFXIV catalog references missing record ${recordId}`);
    return record;
  });
}

function collectChronicleSections(branch, sections = []) {
  for (const era of branch.eras || []) {
    sections.push({
      contextId: branch.id,
      contextName: branch.name,
      id: era.id || `${branch.id}-${sections.length + 1}`,
      title: era.title,
      events: era.events || [],
    });
  }
  for (const child of branch.subBranches || []) collectChronicleSections(child, sections);
  return sections;
}

module.exports = async function () {
  // Keep the raw archive as the authority for text and chronology, while
  // replacing its legacy image list with the byte-admitted local originals.
  // A missing or invalid manifest fails the build closed rather than leaking
  // unverified artwork back into the page.
  const source = (await loadFf14AdmittedData({
    dataPath: path.join(__dirname, 'ff14.json'),
  })).data;
  const records = new Map();
  const branches = source.subEntities.flatMap(entity => entity.timeline?.branches || []);

  for (const branch of branches) collectBranchRecords(branch, records);

  const mainline = branches.find(branch => branch.id === 'mainline');
  const chronicleEras = mainline?.eras || [];
  const chronicleSections = branches.flatMap(branch => collectChronicleSections(branch));
  const imageCount = [...records.values()]
    .reduce((total, record) => total + (record.images?.length || 0), 0);

  return {
    coverage: source.archive.coverage,
    stats: {
      records: records.size,
      mainline: chronicleEras.reduce((total, era) => total + era.events.length, 0),
      reflections: branches
        .find(branch => branch.id === 'shards')
        ?.subBranches.reduce((total, branch) => (
          total + (branch.eras || []).reduce((sum, era) => sum + era.events.length, 0)
        ), 0) || 0,
      images: imageCount,
    },
    chronicleEras,
    chronicleSections,
    reflections: source.archive.reflections.map(reflection => ({
      ...reflection,
      records: resolveRecords(reflection.recordIds, records),
    })),
    journeys: source.archive.journeys.map(journey => ({
      ...journey,
      records: resolveRecords(journey.recordIds, records),
    })),
  };
};
