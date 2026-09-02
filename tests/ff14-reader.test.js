const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'src', '_data', 'ff14.json');
const CHAPTER_PATH = path.join(ROOT, 'src', 'assets', 'data', 'ff14-chapters.json');

function loadReaderModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/ff14-reader.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

function collectRecords(branch, rows = []) {
  for (const era of branch.eras || []) rows.push(...era.events);
  for (const child of branch.subBranches || []) collectRecords(child, rows);
  return rows;
}

test('FFXIV chapter map preserves every record id exactly once and reports all four roots', () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const map = JSON.parse(fs.readFileSync(CHAPTER_PATH, 'utf8'));
  const branches = data.subEntities[0].timeline.branches;
  const sourceIds = branches.flatMap(branch => collectRecords(branch).map(record => record.id));
  const mappedIds = map.chapters.flatMap(chapter => chapter.eventIds);

  assert.equal(new Set(mappedIds).size, mappedIds.length);
  assert.deepEqual(mappedIds.sort(), sourceIds.sort());
  assert.deepEqual(map.branchStats.map(row => row.branchId), ['mainline', 'shards', 'anecdotes', 'lore']);
  assert.equal(map.branchStats.reduce((sum, row) => sum + row.eventCount, 0), 439);
});

test('chapter summaries are traceable verbatim to their declared records', () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const map = JSON.parse(fs.readFileSync(CHAPTER_PATH, 'utf8'));
  const records = new Map(data.subEntities[0].timeline.branches
    .flatMap(branch => collectRecords(branch))
    .map(record => [record.id, record]));

  for (const chapter of map.chapters) {
    assert.ok(chapter.summarySourceEventIds.length > 0);
    for (const fragment of chapter.summary.split(' ')) {
      assert.ok(
        chapter.summarySourceEventIds.some(id => {
          const normalized = records.get(id).description.replace(/\s+/g, ' ').trim();
          return normalized.includes(fragment.replace(/…$/, ''));
        }),
        `${chapter.id} summary fragment is not traceable`,
      );
    }
  }
  assert.doesNotMatch(
    map.chapters.map(chapter => chapter.summary).join('\n'),
    /消歧义|词条|该页面|参阅|编辑本段|页面分类/,
  );
});

test('long record segmentation never truncates or rewrites canonical text', () => {
  const { splitLongText } = loadReaderModule();
  const text = `第一段。${'水晶记录延续。'.repeat(420)}\n\n终章保持原文。`;
  const chunks = splitLongText(text, 500);
  assert.ok(chunks.length > 4);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length <= 500));
});

test('four branch progress entries remain independent across rapid writes', () => {
  const { createProgressStore } = loadReaderModule();
  const memory = new Map();
  const storage = {
    getItem: key => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
  };
  const store = createProgressStore(storage);
  for (const [branchId, eventId] of [
    ['mainline', 'ff14-337'],
    ['shards', 'ff14-s1-013'],
    ['anecdotes', 'ff14-a-061'],
    ['lore', 'ff14-l-027'],
  ]) store.write(branchId, { eventId });

  assert.equal(store.read('mainline').eventId, 'ff14-337');
  assert.equal(store.read('shards').eventId, 'ff14-s1-013');
  assert.equal(store.read('anecdotes').eventId, 'ff14-a-061');
  assert.equal(store.read('lore').eventId, 'ff14-l-027');
});

test('mirror-world navigation keeps a browser-back snapshot of the origin record', () => {
  const { createCrossWorldHistoryState } = loadReaderModule();
  const origin = { rootBranchId: 'mainline', eventId: 'ff14-323' };
  const state = createCrossWorldHistoryState(origin, { retained: true });
  assert.deepEqual(state.originEntry, { retained: true, ff14ReaderSnapshot: origin });
  assert.deepEqual(state.targetEntry, { ff14ReaderReturn: origin });
});

test('reader declares keyboard, focus, narrow-screen and reduced-motion affordances', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src/js/modules/ff14-reader.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/css/ff14-reader.css'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'src/ff14-chronicle.njk'), 'utf8');
  assert.match(js, /ArrowLeft.*ArrowRight/);
  assert.match(js, /\.focus\(\{ preventScroll: true \}\)/);
  assert.match(js, /aria-label="章节目录"/);
  assert.match(js, /role="progressbar"/);
  assert.match(js, /aria-valuetext/);
  assert.match(js, /navigationToken/);
  assert.match(js, /listenerController\.abort\(\)/);
  assert.doesNotMatch(js, /element\('main'/);
  assert.match(css, /content-visibility/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(page, /ff-reader-root/);
});
