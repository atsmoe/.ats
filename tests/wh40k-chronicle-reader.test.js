const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/_data/wh40k.json'), 'utf8'));
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/assets/data/wh40k-chapters.json'), 'utf8'));

function loadReaderModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/wh40k-chronicle-reader.js')],
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

function projectedData() {
  const branch = data.subEntities[0].timeline.branches[0];
  return {
    world: data.world,
    coverage: data.archive.coverage,
    branches: [{ ...branch, events: branch.eras.flatMap(era => era.events) }],
  };
}

test('chapter map covers every canonical WH40K record exactly once', () => {
  const { validateWh40kChapterMapping } = loadReaderModule();
  const validation = validateWh40kChapterMapping(projectedData(), mapping);
  assert.deepEqual(validation, {
    sourceCount: 123,
    mappedCount: 123,
    missing: [],
    unknown: [],
    duplicates: [],
  });
  assert.equal(mapping.eras.length, 11);
  assert.equal(mapping.eras.flatMap(era => era.chapters).length, 31);
});

test('chapter archive preserves source order and separates anchors from contemporaries', () => {
  const { buildWh40kChapterArchive } = loadReaderModule();
  const archive = buildWh40kChapterArchive(projectedData(), mapping);
  const biotransference = archive.chapterById.get('biotransference');
  assert.deepEqual(biotransference.events.map(event => event.id), [
    'wh-049', 'wh-050', 'wh-051', 'wh-052', 'wh-053', 'wh-054', 'wh-055', 'wh-056', 'wh-057',
  ]);
  assert.deepEqual(biotransference.anchors.map(event => event.id), [
    'wh-049', 'wh-051', 'wh-054', 'wh-056',
  ]);
  assert.deepEqual(biotransference.contemporaries.map(event => event.id), [
    'wh-050', 'wh-052', 'wh-053', 'wh-055', 'wh-057',
  ]);
  assert.equal(archive.chapters.flatMap(chapter => chapter.events).length, 123);
  assert.equal(archive.chapters.flatMap(chapter => chapter.unavailableEventIds).length, 0);
  assert.equal(archive.excludedIds.size, 7);
});

test('cross-chapter order follows the era dossier sequence', () => {
  const { buildWh40kChapterArchive } = loadReaderModule();
  const archive = buildWh40kChapterArchive(projectedData(), mapping);
  const heresyIndex = archive.chapters.findIndex(chapter => chapter.id === 'heresy-to-siege');
  assert.equal(archive.chapters[heresyIndex - 1].id, 'great-crusade-expands');
  assert.equal(archive.chapters[heresyIndex + 1].id, 'second-founding-to-m41');
  assert.equal(archive.eventToChapter.get('wh-013'), 'heresy-to-siege');
  assert.equal(archive.eventToChapter.get('wh-115'), 'armageddon');
});

test('verification and uncertain-date labels cannot be swallowed by summaries', () => {
  const { getWh40kVerificationState, isWh40kDateUncertain } = loadReaderModule();
  assert.deepEqual(
    getWh40kVerificationState({ id: 'wh-001' }, new Set(['wh-001'])),
    { code: 'disputed', label: '来源争议 / 复核中' },
  );
  assert.deepEqual(
    getWh40kVerificationState({ id: 'verified', sourceStatus: 'VERIFIED' }),
    { code: 'verified', label: 'VERIFIED' },
  );
  assert.deepEqual(
    getWh40kVerificationState({ id: 'ordinary' }),
    { code: 'reviewing', label: '逐条复核中' },
  );
  assert.equal(isWh40kDateUncertain('约M30'), true);
  assert.equal(isWh40kDateUncertain('M31.006'), false);
});

test('reader exposes focus, keyboard, reduced-motion and narrow-screen fallbacks', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/js/modules/wh40k-chronicle-reader.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/css/wh40k-world.css'), 'utf8');
  const template = fs.readFileSync(path.join(ROOT, 'src/wh40k-chronicle.njk'), 'utf8');
  assert.match(template, /id="wh40k-reader"/);
  assert.match(source, /setAttribute\('role', 'dialog'\)/);
  assert.match(source, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key === '\[' \|\| event\.key === '\]'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /returnFocus\?\.isConnected/);
  assert.match(source, /listenerController\.abort\(\)/);
  assert.doesNotMatch(source, /element\('main'/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.wh-reader-overlay\[hidden\]/);
});
