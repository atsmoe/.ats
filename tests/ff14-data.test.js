const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DATA_PATH = path.join(__dirname, '..', 'src', '_data', 'ff14.json');
const CATALOG_PATH = path.join(__dirname, '..', 'src', '_data', 'ff14Catalog.js');

function loadData() {
  delete require.cache[require.resolve(DATA_PATH)];
  return require(DATA_PATH);
}

function collectRecords(branch, records = []) {
  for (const era of branch.eras || []) records.push(...(era.events || []));
  records.push(...(branch.endings || []));
  for (const child of branch.subBranches || []) collectRecords(child, records);
  return records;
}

test('FFXIV archive declares an exact current coverage boundary', () => {
  const { archive } = loadData();

  assert.equal(archive.coverage.asOf, '2026-07-29');
  assert.equal(archive.coverage.currentPatch, '7.55');
  assert.equal(archive.coverage.storyThrough, '7.5 Part 1');
  assert.match(archive.coverage.notice, /7\.55.*7\.56/);
  assert.ok(
    archive.coverage.sources.some(source => /Patch 7\.55 Notes/.test(source.title)),
    'the current patch boundary needs an official release source',
  );
  assert.ok(archive.coverage.sources.some(source => /^https:\/\//.test(source.url)));
});

test('FFXIV current chronicle separates the old-star finale from the new adventure', () => {
  const data = loadData();
  const mainline = data.subEntities[0].timeline.branches.find(branch => branch.id === 'mainline');
  const latestEra = mainline.eras.at(-1);
  const latestIds = latestEra.events.map(record => record.id);

  assert.equal(latestEra.id, 'newfound-adventure');
  assert.deepEqual(latestIds, [
    'ff14-332',
    'ff14-333',
    'ff14-334',
    'ff14-335',
    'ff14-336',
    'ff14-337',
  ]);
  assert.match(latestEra.events[0].title, /崭新的冒险/);
  assert.match(latestEra.events.at(-1).title, /向天之路/);
});

test('FFXIV 6.0 era contains Endwalker events rather than reclassified earlier dialogue', () => {
  const data = loadData();
  const mainline = data.subEntities[0].timeline.branches.find(branch => branch.id === 'mainline');
  const endwalker = mainline.eras.find(era => era.id === 'endwalker');

  assert.deepEqual(endwalker.events.map(record => record.id), [
    'ff14-327',
    'ff14-328',
    'ff14-329',
    'ff14-330',
    'ff14-331',
  ]);
  for (const record of endwalker.events) {
    assert.match(record.dateDisplay, /6\.0/);
    assert.ok(record.tags.includes('6.0'));
    assert.doesNotMatch(record.description, /那布里亚勒斯|暗之战士我想你们应该听说过|## 虚无界之门/);
  }
});

test('FFXIV reflection histories are canonical records, not mislabeled endings', () => {
  const data = loadData();
  const reflections = data.subEntities[0].timeline.branches.find(branch => branch.id === 'shards');

  for (const reflection of reflections.subBranches) {
    assert.equal(reflection.endings, undefined, `${reflection.id} must not model history as endings`);
    assert.ok(reflection.eras?.[0]?.events.length > 0, `${reflection.id} needs a history era`);
    for (const record of reflection.eras[0].events) {
      assert.ok(record.id);
      assert.ok(record.dateDisplay);
    }
  }

  assert.equal(reflections.name, '镜像世界');
  assert.doesNotMatch(JSON.stringify(reflections), /第一碎片|第十三碎片/);
  const thirteenth = reflections.subBranches.find(branch => branch.id === 'shard-13');
  const record = thirteenth.eras[0].events.find(item => item.id === 'ff14-s13-001');
  assert.doesNotMatch(record.description, /唯一保留了自我/);
  assert.deepEqual(record.characters, ['零']);
});

test('every published FFXIV record has a traceable source', () => {
  const data = loadData();
  const records = data.subEntities[0].timeline.branches.flatMap(branch => collectRecords(branch));

  assert.ok(records.length >= 439);
  for (const record of records) {
    assert.ok(
      record.sources?.some(source => /^https:\/\//.test(source.url)),
      `${record.id} needs a traceable source`,
    );
  }
});

test('FFXIV catalog exposes only admitted clear media alongside fourteen reflections and eight journey constellations', async () => {
  delete require.cache[require.resolve(CATALOG_PATH)];
  const catalog = await require(CATALOG_PATH)();
  const recordIds = new Set(
    loadData().subEntities[0].timeline.branches.flatMap(branch => (
      collectRecords(branch).map(record => record.id)
    )),
  );

  assert.equal(catalog.reflections.length, 14);
  assert.deepEqual(
    catalog.reflections.filter(reflection => reflection.recordIds.length > 0).map(item => item.id),
    ['source', 'reflection-1', 'reflection-9', 'reflection-13'],
  );
  assert.equal(catalog.journeys.length, 8);
  assert.deepEqual(
    catalog.journeys.map(journey => journey.id),
    ['legacy', 'reborn', 'heavensward', 'stormblood', 'shadowbringers', 'endwalker', 'newfound', 'dawntrail'],
  );

  for (const entry of [
    ...catalog.reflections.filter(reflection => reflection.recordIds.length > 0),
    ...catalog.journeys,
  ]) {
    assert.ok(entry.sources?.some(source => /^https:\/\//.test(source.url)), `${entry.id} needs a source`);
    assert.ok(entry.recordIds.every(recordId => recordIds.has(recordId)), `${entry.id} has a dangling record`);
  }

  for (const reflection of catalog.reflections.filter(item => item.recordIds.length === 0)) {
    assert.deepEqual(reflection.sources, [], `${reflection.id} must not imply per-node evidence`);
  }

  const rawEntries = [
    ...loadData().archive.reflections,
    ...loadData().archive.journeys,
  ];
  for (const entry of rawEntries) {
    assert.equal(entry.records, undefined, `${entry.id} must not embed record copies`);
    assert.equal(entry.events, undefined, `${entry.id} must not embed event copies`);
  }

  const visibleImages = catalog.chronicleSections
    .flatMap(section => section.events)
    .flatMap(record => record.images || []);
  assert.ok(visibleImages.length > 0, 'the catalog should expose admitted local originals');
  for (const image of visibleImages) {
    assert.match(image.src, /^\.\/assets\/images\/ff14\//);
    assert.ok(image.displayWidth * 1.5 <= image.width);
    assert.ok(image.displayHeight * 1.5 <= image.height);
  }
});
