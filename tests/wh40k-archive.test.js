const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadArchiveModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/wh40k-archive.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });

  const module = { exports: {} };
  const execute = new Function('module', 'exports', 'require', result.outputFiles[0].text);
  execute(module, module.exports, require);
  return module.exports;
}

function sampleData(overrides = {}) {
  const imperator = { id: 'wh-operation-imperator', title: 'Operation Imperator' };
  const pariah = { id: 'wh-pariah-nexus', title: 'Pariah Nexus' };

  return {
    data: {
      world: { id: 'wh40k', name: '战锤40K' },
      branches: [{
        id: 'mainline',
        name: '银河编年',
        eras: [{
          title: '当代战区',
          events: [imperator, pariah],
        }],
      }],
      factionFamilies: [{
        id: 'imperium',
        name: '人类帝国',
        recordIds: ['wh-operation-imperator'],
      }],
      warZones: [{
        id: 'armageddon',
        name: '阿米吉多顿',
        recordIds: ['wh-operation-imperator', 'wh-pariah-nexus'],
      }],
      ...overrides,
    },
    imperator,
    pariah,
  };
}

test('faction and war-zones lenses return references from the canonical chronicle', () => {
  const { createWh40kArchive } = loadArchiveModule();
  const { data, imperator, pariah } = sampleData();
  const archive = createWh40kArchive(data);

  const chronicle = archive.explore({ lens: 'chronicle' });
  const faction = archive.explore({ lens: 'faction', factionId: 'imperium' });
  const warZones = archive.explore({ lens: 'war-zones' });

  assert.strictEqual(chronicle.recordsById[imperator.id], imperator);
  assert.strictEqual(faction.records[0], chronicle.recordsById[imperator.id]);
  assert.strictEqual(
    faction.recordsById[imperator.id],
    chronicle.recordsById[imperator.id],
  );
  assert.deepEqual(warZones.warZones.map(zone => zone.id), ['armageddon']);
  assert.strictEqual(warZones.warZones[0].records[0], imperator);
  assert.strictEqual(warZones.warZones[0].records[1], pariah);
  assert.strictEqual(warZones.recordsById[pariah.id], chronicle.recordsById[pariah.id]);
});

test('war-zones lens can focus one known zone and rejects an unknown selection', () => {
  const { createWh40kArchive } = loadArchiveModule();
  const { data } = sampleData();
  const archive = createWh40kArchive(data);

  const focused = archive.explore({
    lens: 'war-zones',
    warZoneId: 'armageddon',
  });

  assert.equal(focused.warZone.id, 'armageddon');
  assert.deepEqual(focused.records.map(record => record.id), [
    'wh-operation-imperator',
    'wh-pariah-nexus',
  ]);
  assert.throws(
    () => archive.explore({ lens: 'war-zones', warZoneId: 'missing-zone' }),
    /War zone "missing-zone" was not found/,
  );
});

test('catalog validation rejects dangling faction and war-zone record references eagerly', () => {
  const { createWh40kArchive } = loadArchiveModule();
  const { data: brokenFaction } = sampleData({
    factionFamilies: [{
      id: 'imperium',
      recordIds: ['missing-faction-record'],
    }],
  });
  const { data: brokenWarZone } = sampleData({
    warZones: [{
      id: 'armageddon',
      recordIds: ['missing-war-zone-record'],
    }],
  });

  assert.throws(
    () => createWh40kArchive(brokenFaction),
    /Faction "imperium" references unknown record "missing-faction-record"/,
  );
  assert.throws(
    () => createWh40kArchive(brokenWarZone),
    /War zone "armageddon" references unknown record "missing-war-zone-record"/,
  );
});
