const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadVirtualTimeline({ scrollY = 0 } = {}) {
  const source = fs.readFileSync(
    path.join(ROOT, 'src/js/lib/virtual-timeline.js'),
    'utf8',
  );
  const context = {
    document: {
      getElementById: () => null,
      querySelector: () => null,
    },
    requestAnimationFrame: () => {},
    setTimeout: () => {},
    window: {
      addEventListener: () => {},
      innerHeight: 800,
      scrollTo: () => {},
      scrollY,
    },
  };
  context.globalThis = context;

  vm.runInNewContext(
    `${source}\n;globalThis.__virtualTimeline = VirtualTimeline;`,
    context,
    { filename: 'virtual-timeline.js' },
  );

  return context.__virtualTimeline;
}

test('timeline coordinates convert a container-local item top to document space', () => {
  const timeline = loadVirtualTimeline();

  assert.equal(timeline.coordinates.toDocument(240, 780), 1020);
});

test('timeline coordinates convert a document viewport top to container-local space', () => {
  const timeline = loadVirtualTimeline();

  assert.equal(timeline.coordinates.toLocal(1020, 780), 240);
});

test('timeline resolves an item top against the UI-provided document origin', () => {
  const timeline = loadVirtualTimeline();
  timeline.setContainerDocumentTop(1160);

  assert.equal(timeline.documentTopForLocal(400), 1560);
});

test('timeline resolves a document viewport top into UI-provided local space', () => {
  const timeline = loadVirtualTimeline();
  timeline.setContainerDocumentTop(1160);

  assert.equal(timeline.localTopForDocument(1560), 400);
});

test('timeline flattens a standalone branch notice before era records', () => {
  const timeline = loadVirtualTimeline();
  timeline.container = { style: {} };

  timeline.load([
    {
      type: 'notice',
      data: { title: '第一世界', description: '碎片世界记录。' },
    },
    {
      type: 'era',
      eraTitle: '光之泛滥',
      events: [{ id: 'ff14-s1-001', title: '光之泛滥' }],
    },
  ]);

  assert.deepEqual(
    Array.from(timeline.items, item => item.type),
    ['notice', 'era-header', 'event'],
  );
  assert.equal(timeline.items[0].data.title, '第一世界');
  assert.equal(timeline.items[2].data.id, 'ff14-s1-001');
});

test('timeline reserves its full height before a deep-link scroll is attempted', () => {
  const timeline = loadVirtualTimeline();
  timeline.container = { style: {} };
  timeline.setContainerDocumentTop(700);
  const events = Array.from({ length: 20 }, (_, index) => ({
    id: `nested-${index + 1}`,
    title: `Nested record ${index + 1}`,
  }));

  const reservedHeight = timeline.load([
    { type: 'era', eraTitle: 'Nested history', events },
  ]);

  assert.equal(reservedHeight, timeline.estimatedTotalHeight);
  assert.equal(timeline.container.style.height, undefined);
  assert.ok(
    timeline.estimateScrollTopByEventId('nested-20') > 2500,
    'the last record should be reachable before the first render pass',
  );
});
