const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DATA_PATH = path.join(__dirname, '..', 'src', '_data', 'wh40k.json');

function loadData() {
  delete require.cache[require.resolve(DATA_PATH)];
  return require(DATA_PATH);
}

test('WH40K archive declares reviewed coverage and nine stable faction families', () => {
  const data = loadData();
  const archive = data.archive;
  const mainline = data.subEntities[0].timeline.branches.find(branch => branch.id === 'mainline');
  const recordIds = new Set(mainline.eras.flatMap(era => era.events.map(event => event.id)));

  assert.equal(archive.coverage.asOf, '2026-07-23');
  assert.match(archive.coverage.edition, /11/);
  assert.equal(archive.factionFamilies.length, 9);
  assert.deepEqual(archive.factionFamilies.map(faction => faction.id), [
    'imperium',
    'chaos',
    'aeldari',
    'necrons',
    'orks',
    'tyranids',
    'genestealer-cults',
    'tau-empire',
    'leagues-of-votann',
  ]);

  for (const faction of archive.factionFamilies) {
    assert.ok(faction.name && faction.summary, `${faction.id} needs visible copy`);
    assert.ok(faction.recordIds.length > 0, `${faction.id} needs canonical record references`);
    assert.ok(
      faction.recordIds.every(recordId => recordIds.has(recordId)),
      `${faction.id} has a dangling record`,
    );
    assert.ok(faction.sources.some(source => /^https:\/\//.test(source.url)), `${faction.id} needs a source`);
  }
});

test('WH40K publishes six current, sourced war zones backed by canonical records', () => {
  const data = loadData();
  const archive = data.archive;
  const mainline = data.subEntities[0].timeline.branches.find(branch => branch.id === 'mainline');
  const recordIds = new Set(mainline.eras.flatMap(era => era.events.map(event => event.id)));

  assert.equal(archive.warZones.length, 6);
  for (const zone of archive.warZones) {
    assert.equal(zone.asOf, '2026-07-23');
    assert.ok(zone.recordIds.length > 0, `${zone.id} needs at least one canonical record`);
    assert.ok(zone.recordIds.every(recordId => recordIds.has(recordId)), `${zone.id} has a dangling record`);
    assert.ok(zone.sources.some(source => /^https:\/\//.test(source.url)), `${zone.id} needs a source`);
  }
});

test('WH40K source data excludes uncited fan IF branches and redundant top-level eras', () => {
  const data = loadData();
  const branches = data.subEntities[0].timeline.branches;

  assert.equal(branches.some(branch => branch.id === 'if-heresy'), false);
  assert.equal(Object.hasOwn(data, 'eras'), false);
});

test('newly indexed factions use sourced canonical records rather than placeholder copy', () => {
  const data = loadData();
  const mainline = data.subEntities[0].timeline.branches.find(branch => branch.id === 'mainline');
  const records = new Map(mainline.eras.flatMap(era => era.events.map(record => [record.id, record])));

  for (const recordId of ['wh-121', 'wh-122', 'wh-123']) {
    const record = records.get(recordId);
    assert.ok(record, `${recordId} must exist in the canonical chronicle`);
    assert.ok(record.sources.some(source => /^https:\/\/www\.warhammer-community\.com\//.test(source.url)));
  }

  assert.doesNotMatch(JSON.stringify(data.archive.factionFamilies), /下一轮|后续核验/);
});

test('every published WH40K chronicle record has a traceable source', () => {
  const data = loadData();
  const mainline = data.subEntities[0].timeline.branches.find(branch => branch.id === 'mainline');

  for (const era of mainline.eras) {
    for (const record of era.events) {
      assert.ok(
        record.sources?.some(source => /^https:\/\//.test(source.url)),
        `${record.id} in ${era.title} needs a traceable source`,
      );
    }
  }
});
