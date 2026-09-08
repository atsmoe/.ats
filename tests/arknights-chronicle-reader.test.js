const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadModel() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/arknights-chronicle-model.js')],
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

function mainlineEras() {
  const data = JSON.parse(read('src/_data/arknights.json'));
  return data.subEntities
    .flatMap(entity => entity.timeline?.branches || [])
    .find(branch => branch.id === 'mainline').eras;
}

test('deterministic chapter grouping preserves all 876 records once and in source order', () => {
  const { buildArknightsChapters } = loadModel();
  const eras = mainlineEras();
  const sourceRecords = eras.flatMap(era => era.events);
  const first = buildArknightsChapters(eras);
  const second = buildArknightsChapters(eras);
  const groupedRecords = first.chapters.flatMap(chapter => chapter.entries.flatMap(entry => entry.records));

  assert.equal(first.chapters.length, 45);
  assert.equal(groupedRecords.length, 876);
  assert.equal(new Set(groupedRecords.map(record => record.id)).size, 876);
  assert.deepEqual(groupedRecords.map(record => record.id), sourceRecords.map(record => record.id));
  assert.deepEqual(
    first.chapters.map(chapter => ({ id: chapter.id, ids: chapter.records.map(record => record.id) })),
    second.chapters.map(chapter => ({ id: chapter.id, ids: chapter.records.map(record => record.id) })),
  );
});

test('short same-date records collapse while major records keep independent anchors', () => {
  const { groupArknightsChapterRecords, isMajorArknightsEvent } = loadModel();
  const records = [
    { id: 'evt-1', dateRaw: '1097.1', description: '短记录一', characters: [], prtsSources: [] },
    { id: 'evt-2', dateRaw: '1097.1', description: '短记录二', characters: [], prtsSources: [] },
    { id: 'evt-3', dateRaw: '1097.1', description: '重大转折', characters: [], isLargeEvent: true, prtsSources: [] },
    { id: 'evt-4', dateRaw: '1097.2', description: '另一个日期', characters: [], prtsSources: [] },
  ];
  const entries = groupArknightsChapterRecords(records);

  assert.equal(entries[0].type, 'concurrent');
  assert.deepEqual(entries[0].records.map(record => record.id), ['evt-1', 'evt-2']);
  assert.equal(entries[1].type, 'event');
  assert.equal(entries[1].records[0].id, 'evt-3');
  assert.equal(isMajorArknightsEvent(entries[1].records[0]), true);
  assert.equal(entries[2].type, 'event');
});

test('reader hashes and progress expose stable navigation behavior', () => {
  const { arknightsReaderProgress, arknightsReaderTarget } = loadModel();
  assert.deepEqual(arknightsReaderTarget('#evt-480'), { type: 'event', id: 'evt-480' });
  assert.deepEqual(arknightsReaderTarget('#ark-chapter-6-4'), { type: 'chapter', id: 'ark-chapter-6-4' });
  assert.equal(arknightsReaderTarget('#unknown'), null);
  assert.equal(arknightsReaderProgress(0, 876), 0);
  assert.equal(arknightsReaderProgress(875, 876), 100);
});

test('reader owns focus, keyboard, reduced motion, and no-script degradation contracts', () => {
  const template = read('src/arknights-chronicle.njk');
  const reader = read('src/js/modules/arknights-chronicle-reader.js');
  const css = read('src/css/arknights-chronicle.css');

  assert.match(template, /<noscript>[\s\S]*data-arknights-record=/);
  assert.match(template, /role="dialog"[^>]*aria-modal="true"/);
  assert.doesNotMatch(template, /<main id="ark-chronicle-directory"/);
  assert.match(reader, /event\.key === 'Escape'/);
  assert.match(reader, /event\.defaultPrevented \|\| event\.isComposing \|\| event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey/);
  assert.match(template, /aria-keyshortcuts="Escape"/);
  assert.match(reader, /event\.key !== 'Tab'/);
  assert.match(reader, /returnFocus\?\.isConnected/);
  assert.match(reader, /window\.scrollTo\(\{ top: pageScrollY, behavior: 'auto' \}\)/);
  assert.match(reader, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
});

test('reader keeps one browser-history boundary and releases long-lived observers', () => {
  const reader = read('src/js/modules/arknights-chronicle-reader.js');

  assert.equal((reader.match(/history\.pushState/g) || []).length, 1);
  assert.ok((reader.match(/history\.replaceState/g) || []).length >= 3);
  assert.match(reader, /getClientRects\(\)\.length/);
  assert.match(reader, /recordObserver\?\.disconnect\(\)/);
  assert.match(reader, /listenerController\.abort\(\)/);
  assert.match(reader, /return \{ \.\.\.model, recordCount: allRecords\.length, destroy \}/);
});
