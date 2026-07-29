const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadModule(relativePath) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, relativePath)],
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

function loadArchiveModule() {
  return loadModule('src/js/modules/world-archive.js');
}

test('chronicle and dossier lenses expose the same canonical record', () => {
  const { createWorldArchive } = loadArchiveModule();
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [{
      id: 'if-integrated',
      name: '集成战略',
      subBranches: [{
        id: 'if-mizuki',
        name: '水月与深蓝之树',
        endings: [{
          id: 'if-mizuki-ending-1',
          endingNumber: 1,
          title: '平凡即是喜乐',
          description: '水月保留了人的身份。',
        }],
      }],
    }],
    archive: {
      dossiers: [{
        id: 'deep-blue',
        title: '深蓝观测记录',
        contextId: 'if-mizuki',
        recordIds: ['if-mizuki-ending-1'],
      }],
    },
  });

  const chronicle = archive.explore({ lens: 'chronicle' });
  const dossier = archive.explore({ lens: 'dossier', dossierId: 'deep-blue' });

  assert.strictEqual(
    dossier.recordsById['if-mizuki-ending-1'],
    chronicle.recordsById['if-mizuki-ending-1'],
  );
  assert.equal(dossier.recordsById['if-mizuki-ending-1'].title, '平凡即是喜乐');
});

test('chronicle lens preserves recursive context metadata and ordered record sections', () => {
  const { createWorldArchive } = loadArchiveModule();
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [{
      id: 'if-integrated',
      name: '集成战略',
      description: '可能性记录合集。',
      status: 'observing',
      subBranches: [{
        id: 'if-mizuki',
        name: '水月与深蓝之树',
        description: '深海危机的多种观测结果。',
        parentBranchId: 'if-integrated',
        eras: [{
          title: '共同前提',
          events: [{ id: 'mizuki-premise', title: '大静谧逼近' }],
        }],
        endings: [{ endingNumber: 1, title: '平凡即是喜乐' }],
      }],
    }],
  });

  const snapshot = archive.explore({ lens: 'chronicle' });
  const parent = snapshot.contexts.find(context => context.id === 'if-integrated');
  const child = snapshot.contexts.find(context => context.id === 'if-mizuki');
  const childSections = snapshot.sections.filter(section => section.contextId === child.id);

  assert.deepEqual(snapshot.rootContextIds, ['if-integrated']);
  assert.equal(parent.description, '可能性记录合集。');
  assert.equal(parent.status, 'observing');
  assert.deepEqual(parent.childIds, ['if-mizuki']);
  assert.equal(child.parentId, 'if-integrated');
  assert.equal(child.description, '深海危机的多种观测结果。');
  assert.deepEqual(childSections.map(section => section.kind), ['era', 'endings']);
  assert.deepEqual(childSections[0].recordIds, ['mizuki-premise']);
  assert.deepEqual(childSections[1].recordIds, ['if-mizuki-ending-1']);
  assert.equal(snapshot.recordsById['if-mizuki-ending-1'].id, 'if-mizuki-ending-1');
});

test('dossier lens rejects references that are not in the canonical record set', () => {
  const { createWorldArchive } = loadArchiveModule();
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [],
    archive: {
      dossiers: [{
        id: 'broken-dossier',
        title: '失效档案',
        recordIds: ['missing-record'],
      }],
    },
  });

  assert.throws(
    () => archive.explore({ lens: 'dossier', dossierId: 'broken-dossier' }),
    /references unknown record "missing-record"/,
  );
});

test('timeline adapter projects recursive contexts without copying record content', () => {
  const { createWorldArchive } = loadArchiveModule();
  const { projectChronicleTimeline } = loadModule('src/js/modules/timeline-adapter.js');
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [{
      id: 'if-integrated',
      name: '集成战略',
      description: '可能性记录合集。',
      status: 'observing',
      subBranches: [{
        id: 'if-mizuki',
        name: '水月与深蓝之树',
        description: '深海危机的多种观测结果。',
        endings: [{ id: 'if-mizuki-ending-1', endingNumber: 1, title: '平凡即是喜乐' }],
      }],
    }],
  });
  const snapshot = archive.explore({ lens: 'chronicle' });

  const projected = projectChronicleTimeline(snapshot);
  const parent = projected.branches[0];
  const child = parent.subBranches[0];

  assert.equal(parent.description, '可能性记录合集。');
  assert.equal(parent.status, 'observing');
  assert.equal(child.description, '深海危机的多种观测结果。');
  assert.strictEqual(child.endings[0], snapshot.recordsById['if-mizuki-ending-1']);
  assert.strictEqual(child.events[0], snapshot.recordsById['if-mizuki-ending-1']);
});

test('archive-to-WH40K chronicle pipeline preserves coverage filters and era chronology', () => {
  const { createWorldArchive } = loadArchiveModule();
  const { projectChronicleTimeline } = loadModule('src/js/modules/timeline-adapter.js');
  const { prepareWh40kChronicle } = loadModule('src/js/modules/wh40k-chronicle-adapter.js');
  const dropped = { id: 'wh-dropped', title: 'Downgraded record' };
  const ancient = { id: 'wh-ancient', title: 'Ancient record' };
  const modern = { id: 'wh-modern', title: 'Modern record' };
  const data = {
    world: { id: 'wh40k', name: 'Warhammer 40,000' },
    branches: [{
      id: 'mainline',
      name: 'Mainline',
      eras: [
        {
          id: 'modern',
          title: 'Modern',
          chronologyRank: 90,
          events: [modern],
        },
        {
          id: 'ancient',
          title: 'Ancient',
          chronologyRank: 10,
          events: [dropped, ancient],
        },
      ],
    }],
    archive: {
      coverage: {
        excludedRecordIds: ['wh-dropped'],
      },
    },
  };

  const snapshot = createWorldArchive(data).explore({ lens: 'chronicle' });
  const projected = projectChronicleTimeline(snapshot);
  const prepared = prepareWh40kChronicle(projected);

  assert.strictEqual(projected.coverage, snapshot.coverage);
  assert.deepEqual(
    prepared.branches[0].eras.map(era => era.id),
    ['ancient', 'modern'],
  );
  assert.deepEqual(
    prepared.branches[0].events.map(record => record.id),
    ['wh-ancient', 'wh-modern'],
  );
});

test('dossier lens returns one semantic snapshot for coverage, context, focus, and alternatives', () => {
  const { createWorldArchive } = loadArchiveModule();
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [{
      id: 'if-mizuki',
      name: '水月与深蓝之树',
      description: '共同观测背景。',
      endings: [
        { id: 'ending-1', endingNumber: 1, title: '结果一' },
        { id: 'ending-2', endingNumber: 2, title: '结果二' },
      ],
    }],
    archive: {
      schemaVersion: 1,
      sourceVersion: 'ARK-TEST',
      coverage: { status: '观测中' },
      dossiers: [{
        id: 'deep-blue',
        title: '深蓝观测记录',
        contextId: 'if-mizuki',
        recordIds: ['ending-1', 'ending-2'],
        defaultRecordId: 'ending-1',
        relation: 'alternate-outcomes',
      }],
    },
  });

  const snapshot = archive.explore({
    lens: 'dossier',
    dossierId: 'deep-blue',
    focusId: 'ending-2',
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.sourceVersion, 'ARK-TEST');
  assert.equal(snapshot.world.name, '明日方舟');
  assert.equal(snapshot.coverage.status, '观测中');
  assert.equal(snapshot.context.id, 'if-mizuki');
  assert.equal(snapshot.context.description, '共同观测背景。');
  assert.equal(snapshot.focusId, 'ending-2');
  assert.deepEqual(snapshot.sections[0].recordIds, ['ending-1', 'ending-2']);
  assert.deepEqual(snapshot.relations, [{
    type: 'alternate-outcomes',
    recordIds: ['ending-1', 'ending-2'],
  }]);
});

test('archive compilation rejects duplicate record IDs across contexts', () => {
  const { createWorldArchive } = loadArchiveModule();
  const duplicated = { id: 'same-record', title: '重复记录' };

  assert.throws(() => createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [
      { id: 'context-a', name: '语境 A', eras: [{ title: 'A', events: [duplicated] }] },
      { id: 'context-b', name: '语境 B', eras: [{ title: 'B', events: [{ ...duplicated }] }] },
    ],
  }), /Duplicate record ID "same-record"/);
});

test('production chronicle snapshots exactly match the global event index', () => {
  const { createWorldArchive } = loadArchiveModule();
  const { projectChronicleTimeline } = loadModule('src/js/modules/timeline-adapter.js');
  const eventIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/data/event-index.json'), 'utf8'));

  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, `dist/data/${worldId}.json`), 'utf8'));
    const snapshot = createWorldArchive(data).explore({ lens: 'chronicle' });
    const timeline = projectChronicleTimeline(snapshot);
    const indexedIds = Object.entries(eventIndex)
      .filter(([, location]) => location.worldId === worldId)
      .map(([eventId]) => eventId)
      .sort();
    const snapshotIds = Object.keys(snapshot.recordsById).sort();
    const timelineIds = [];

    function collect(branches) {
      for (const branch of branches) {
        timelineIds.push(...branch.events.map(record => record.id));
        collect(branch.subBranches || []);
      }
    }
    collect(timeline.branches);

    assert.deepEqual(snapshotIds, indexedIds, `${worldId} snapshot drifted from event-index`);
    assert.deepEqual(timelineIds.sort(), indexedIds, `${worldId} timeline Adapter dropped records`);
  }
});

test('archive rejects unsupported observation lenses', () => {
  const { createWorldArchive } = loadArchiveModule();
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [],
  });

  assert.throws(
    () => archive.explore({ lens: 'worldline-tree' }),
    /Unsupported archive lens "worldline-tree"/,
  );
});

test('archive compilation rejects duplicate context IDs', () => {
  const { createWorldArchive } = loadArchiveModule();
  assert.throws(() => createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [
      { id: 'same-context', name: '语境 A' },
      { id: 'same-context', name: '语境 B' },
    ],
  }), /Duplicate context ID "same-context"/);
});

test('archive compilation requires a stable ID or ending number for every ending', () => {
  const { createWorldArchive } = loadArchiveModule();
  assert.throws(() => createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [{
      id: 'if-mizuki',
      name: '水月与深蓝之树',
      endings: [{ title: '无法定位的结局' }],
    }],
  }), /Ending in context "if-mizuki" needs an id or endingNumber/);
});

test('collection lens returns ordered integrated-strategy topics without copying records', () => {
  const { createWorldArchive } = loadArchiveModule();
  const ending = { id: 'if-second-ending-1', title: '结局记录' };
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [{
      id: 'if-integrated',
      name: '集成战略世界线',
      subBranches: [
        {
          id: 'if-second',
          order: 2,
          name: '第二主题',
          type: 'integrated-strategy',
          lastReviewedAt: '2026-07-22',
          endings: [ending],
        },
        {
          id: 'if-first',
          order: 1,
          name: '第一主题',
          type: 'integrated-strategy',
          endings: [{ id: 'if-first-ending-1', title: '另一结局' }],
        },
      ],
    }],
  });

  const collection = archive.explore({ lens: 'collection', contextId: 'if-integrated' });
  const topic = archive.explore({ lens: 'context', contextId: 'if-second' });

  assert.deepEqual(collection.contexts.map(context => context.id), ['if-first', 'if-second']);
  assert.equal(collection.contexts[1].recordCount, 1);
  assert.equal(collection.contexts[1].lastReviewedAt, '2026-07-22');
  assert.strictEqual(topic.recordsById['if-second-ending-1'], ending);
  assert.deepEqual(topic.sections.map(section => section.kind), ['endings']);
});

test('context lens rejects an unknown topic instead of returning an empty page', () => {
  const { createWorldArchive } = loadArchiveModule();
  const archive = createWorldArchive({
    world: { id: 'arknights', name: '明日方舟' },
    branches: [],
  });

  assert.throws(
    () => archive.explore({ lens: 'context', contextId: 'if-missing' }),
    /Archive context "if-missing" was not found/,
  );
});
