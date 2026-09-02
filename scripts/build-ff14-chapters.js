const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', '_data', 'ff14.json');
const OUTPUT = path.join(ROOT, 'src', 'assets', 'data', 'ff14-chapters.json');
const BASELINE_SHA = 'b34e10cf79cc073c420610797466d226d70f166e';
const MAX_EVENTS_PER_CHAPTER = 12;
const PUBLICATION_ARTIFACT_PATTERN = /消歧义|词条|该页面|参阅|编辑本段|页面分类/;

function versionOf(record) {
  return (record.tags || []).find(tag => /^\d+\.\d+$/.test(tag)) || '';
}

function paragraphLead(text, maxLength = 96) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const sentence = compact.match(/^.*?[。！？](?:[”’」』])?/)?.[0] || compact;
  const lead = sentence.length <= maxLength ? sentence : `${sentence.slice(0, maxLength).trim()}…`;
  return PUBLICATION_ARTIFACT_PATTERN.test(lead) ? '' : lead;
}

function rangeLabel(records) {
  const versions = [...new Set(records.map(versionOf).filter(Boolean))];
  if (versions.length === 1) return versions[0];
  if (versions.length > 1) return `${versions[0]}～${versions.at(-1)}`;
  const dates = [...new Set(records.map(record => record.dateDisplay).filter(Boolean))];
  if (dates.length === 1) return dates[0];
  return dates.length > 1 ? `${dates[0]}～${dates.at(-1)}` : '';
}

function splitEra(era) {
  const runs = [];
  let current = [];
  let currentVersion = null;
  for (const record of era.events || []) {
    const version = versionOf(record);
    if (current.length && version && currentVersion && version !== currentVersion) {
      runs.push(current);
      current = [];
    }
    current.push(record);
    if (version) currentVersion = version;
  }
  if (current.length) runs.push(current);

  return runs.flatMap(run => {
    const chunks = [];
    for (let offset = 0; offset < run.length; offset += MAX_EVENTS_PER_CHAPTER) {
      chunks.push(run.slice(offset, offset + MAX_EVENTS_PER_CHAPTER));
    }
    return chunks;
  });
}

function chapterTitle(era, records, part, totalParts) {
  const range = rangeLabel(records);
  const base = range && !era.title.includes(range) ? `${era.title} · ${range}` : era.title;
  return totalParts > 1 ? `${base}（${part}）` : base;
}

function collectBranch(branch, rootBranchId, chapters) {
  for (const era of branch.eras || []) {
    const chunks = splitEra(era);
    const rangeCounts = new Map();
    const rangeSeen = new Map();
    for (const records of chunks) {
      const range = rangeLabel(records);
      rangeCounts.set(range, (rangeCounts.get(range) || 0) + 1);
    }
    chunks.forEach((records, index) => {
      const range = rangeLabel(records);
      const rangePart = (rangeSeen.get(range) || 0) + 1;
      rangeSeen.set(range, rangePart);
      const summarySourceEventIds = records.slice(0, 2).map(record => record.id);
      chapters.push({
        id: `${branch.id}--${era.id || 'era'}--${String(index + 1).padStart(2, '0')}`,
        rootBranchId,
        branchId: branch.id,
        branchName: branch.name,
        eraId: era.id || null,
        eraTitle: era.title,
        title: chapterTitle(era, records, rangePart, rangeCounts.get(range)),
        versionRange: range,
        eventIds: records.map(record => record.id),
        keyEventIds: records.filter(record => record.isKeyEvent || record.isLargeEvent).map(record => record.id),
        summarySourceEventIds,
        summary: summarySourceEventIds
          .map(id => paragraphLead(records.find(record => record.id === id)?.description))
          .filter(Boolean)
          .join(' '),
      });
    });
  }
  for (const child of branch.subBranches || []) collectBranch(child, rootBranchId, chapters);
}

function build() {
  const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const roots = source.subEntities[0].timeline.branches;
  const chapters = [];
  for (const branch of roots) collectBranch(branch, branch.id, chapters);
  const branchStats = roots.map(branch => {
    const branchChapters = chapters.filter(chapter => chapter.rootBranchId === branch.id);
    return {
      branchId: branch.id,
      branchName: branch.name,
      chapterCount: branchChapters.length,
      eventCount: branchChapters.reduce((sum, chapter) => sum + chapter.eventIds.length, 0),
    };
  });
  const output = {
    schemaVersion: 1,
    baselineSha: BASELINE_SHA,
    rules: {
      sourceOrder: 'branch.eras[].events[]',
      boundaries: ['world branch', 'era', 'version tag', `maximum ${MAX_EVENTS_PER_CHAPTER} events`],
      summary: 'verbatim leading sentence(s) from summarySourceEventIds',
    },
    branchStats,
    chapters,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${chapters.length} chapters for ${branchStats.reduce((sum, row) => sum + row.eventCount, 0)} records.`);
}

build();
