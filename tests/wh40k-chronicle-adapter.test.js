const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadAdapterModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/wh40k-chronicle-adapter.js')],
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

test('chronicle preparation filters unsupported records and stably orders ranked eras', () => {
  const { prepareWh40kChronicle } = loadAdapterModule();
  const unsupported = { id: 'wh-001', title: 'unsupported hand entry' };
  const ancient = { id: 'wh-ancient', title: 'War in Heaven' };
  const middle = { id: 'wh-middle', title: 'Age of Strife' };
  const modern = { id: 'wh-modern', title: 'Era Indomitus' };
  const source = {
    world: { id: 'wh40k' },
    branches: [{
      id: 'mainline',
      eras: [
        { id: 'modern', chronologyRank: 30, title: 'Modern', events: [modern] },
        { id: 'ancient', chronologyRank: 10, title: 'Ancient', events: [unsupported, ancient] },
        { id: 'middle', order: 20, title: 'Middle', events: [middle] },
      ],
      events: [modern, unsupported, ancient, middle],
    }],
  };

  const prepared = prepareWh40kChronicle(source);
  const branch = prepared.branches[0];

  assert.deepEqual(branch.eras.map(era => era.id), ['ancient', 'middle', 'modern']);
  assert.deepEqual(branch.events.map(record => record.id), [
    'wh-ancient',
    'wh-middle',
    'wh-modern',
  ]);
  assert.strictEqual(branch.eras[0].events[0], ancient);
  assert.strictEqual(branch.eras[1].events[0], middle);
  assert.strictEqual(branch.eras[2].events[0], modern);
  assert.deepEqual(source.branches[0].eras.map(era => era.id), ['modern', 'ancient', 'middle']);
  assert.deepEqual(source.branches[0].events.map(record => record.id), [
    'wh-modern',
    'wh-001',
    'wh-ancient',
    'wh-middle',
  ]);
});

test('unsupported record IDs are explicit and caller-overridable', () => {
  const {
    DEFAULT_UNSUPPORTED_WH40K_RECORD_IDS,
    prepareWh40kChronicle,
  } = loadAdapterModule();
  const handEntry = { id: 'wh-007', title: 'unsupported hand entry' };
  const reviewed = { id: 'wh-reviewed', title: 'reviewed record' };
  const source = {
    world: { id: 'wh40k' },
    branches: [{
      id: 'mainline',
      eras: [{ title: 'Era', events: [handEntry, reviewed] }],
    }],
  };

  assert.deepEqual([...DEFAULT_UNSUPPORTED_WH40K_RECORD_IDS], [
    'wh-001',
    'wh-007',
    'wh-009',
  ]);
  assert.deepEqual(
    prepareWh40kChronicle(source).branches[0].events.map(record => record.id),
    ['wh-reviewed'],
  );
  assert.deepEqual(
    prepareWh40kChronicle(source, { unsupportedRecordIds: [] })
      .branches[0].events
      .map(record => record.id),
    ['wh-007', 'wh-reviewed'],
  );
});

test('production coverage can define the default downgrade list', () => {
  const { prepareWh40kChronicle } = loadAdapterModule();
  const wh001 = { id: 'wh-001', title: 'kept when production overrides defaults' };
  const dropped = { id: 'drop-me', title: 'coverage downgrade' };
  const source = {
    world: { id: 'wh40k' },
    archive: { coverage: { excludedRecordIds: ['drop-me'] } },
    branches: [{
      id: 'mainline',
      eras: [{ title: 'Era', events: [wh001, dropped] }],
    }],
  };

  assert.deepEqual(
    prepareWh40kChronicle(source).branches[0].events.map(record => record.id),
    ['wh-001'],
  );
});

test('empty eras are removed while a deep-linked downgraded record can be preserved', () => {
  const { prepareWh40kChronicle } = loadAdapterModule();
  const downgraded = { id: 'wh-hidden', title: 'Downgraded record' };
  const source = {
    world: { id: 'wh40k' },
    branches: [{
      id: 'mainline',
      eras: [{ id: 'empty-after-filter', title: 'Filtered era', events: [downgraded] }],
    }],
  };

  const filtered = prepareWh40kChronicle(source, { unsupportedRecordIds: ['wh-hidden'] });
  assert.deepEqual(filtered.branches[0].eras, []);
  assert.deepEqual(filtered.branches[0].events, []);

  const preserved = prepareWh40kChronicle(source, {
    unsupportedRecordIds: ['wh-hidden'],
    preserveRecordIds: ['wh-hidden'],
  });
  assert.equal(preserved.branches[0].eras[0].events[0], downgraded);
  assert.equal(preserved.branches[0].events[0], downgraded);
});

test('chronicle preparation recursively rebuilds event lists without copying records', () => {
  const { prepareWh40kChronicle } = loadAdapterModule();
  const parentRecord = { id: 'wh-parent', title: 'Parent' };
  const childRecord = { id: 'wh-child', title: 'Child' };
  const ending = { id: 'wh-ending', title: 'Ending' };
  const source = {
    world: { id: 'wh40k' },
    branches: [{
      id: 'mainline',
      eras: [{ title: 'Parent era', events: [parentRecord] }],
      endings: [ending],
      subBranches: [{
        id: 'nested',
        eras: [{ title: 'Child era', events: [childRecord] }],
      }],
    }],
  };

  const prepared = prepareWh40kChronicle(source, { unsupportedRecordIds: [] });
  const parent = prepared.branches[0];
  const child = parent.subBranches[0];

  assert.strictEqual(parent.events[0], parentRecord);
  assert.strictEqual(parent.events[1], ending);
  assert.strictEqual(child.events[0], childRecord);
  assert.notStrictEqual(parent, source.branches[0]);
  assert.notStrictEqual(child, source.branches[0].subBranches[0]);
});
