const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { validateReleaseHistory, releaseSections } = require('../scripts/check-release-notes');

function load(name) {
  const result = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/js/modules', name)], bundle: true, format: 'cjs', platform: 'node', write: false });
  const loaded = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(loaded, loaded.exports);
  return loaded.exports;
}
const { createReadingStore, normalizePreferences, READER_DEFAULTS } = load('reader-preferences.js');
const { queryGroups, aliasExplanation, matchLocations } = load('archive-search-aliases.js');

test('reader preferences accept only known options and tolerate damaged storage', () => {
  for (const bad of [null, [], {}, 'bad', { size: '1px', width: '<script>' }]) assert.deepEqual(normalizePreferences(bad), READER_DEFAULTS);
  const denied = createReadingStore({ getItem() { throw Error(); }, setItem() { throw Error(); } }, 'arknights');
  assert.deepEqual(denied.preferences(), READER_DEFAULTS);
  assert.equal(denied.available, false, 'blocked storage must be reported before the first write');
  assert.equal(denied.savePreferences({ size: 'larger' }), false);
  assert.equal(denied.preferences().size, 'larger');
  assert.equal(denied.available, false);
  assert.equal(denied.toggleBookmark('evt-003'), true);
  assert.deepEqual(denied.bookmarks(), ['evt-003']);
  const damaged = createReadingStore({ getItem: () => '{', setItem() {} }, 'arknights');
  assert.equal(damaged.available, true, 'invalid JSON does not mean storage access was denied');
});

test('preferences cross worlds while bounded bookmarks stay separate and removable', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const ark = createReadingStore(storage, 'arknights');
  ark.savePreferences({ size: 'large', leading: 'relaxed' });
  for (let i = 0; i < 30; i++) assert.equal(ark.toggleBookmark(`evt-${i}`), true);
  assert.equal(ark.toggleBookmark('evt-31'), false);
  assert.equal(ark.toggleBookmark('javascript:alert(1)'), false);
  const wh = createReadingStore(storage, 'wh40k');
  assert.equal(wh.preferences().size, 'large');
  assert.deepEqual(wh.bookmarks(), []);
  ark.toggleBookmark('evt-0');
  assert.equal(ark.toggleBookmark('evt-31'), true);
  assert.equal(createReadingStore(storage, 'arknights').bookmarks().length, 30);
  ark.pruneBookmarks(id => id === 'evt-31');
  assert.deepEqual(ark.bookmarks(), ['evt-31']);
});

test('aliases preserve exact phrases, combine terms, and report actual match fields', () => {
  assert.deepEqual(queryGroups('小刻 手铳'), [['小刻', '刻俄柏'], ['手铳']]);
  assert.deepEqual(queryGroups('FFXIV'), [['FFXIV', '最终幻想XIV']]);
  assert.deepEqual(queryGroups('水月'), [['水月']]);
  assert.equal(aliasExplanation('萨米肉鸽'), '萨米肉鸽 → 探索者的银凇止境');
  assert.deepEqual(matchLocations(JSON.stringify([['正文', '水晶与卫月'], ['路线步骤', '持有手铳'], ['标题', '刻俄柏的灰蕈迷境']]), '小刻 手铳'), ['路线步骤', '标题']);
  assert.deepEqual(matchLocations('{', '水月'), []);
});

test('story dossiers resolve original records and preserve the uncertain construction date', () => {
  const stories = require('../src/_data/storyDossiers')();
  const steps = stories[0].steps;
  assert.deepEqual(steps.map(step => step.record.id), ['evt-291', 'evt-375', 'evt-546', 'evt-552']);
  assert.equal(steps[0].record.dateRaw, '1082');
  assert.match(steps[0].dateNote, /待复核/);
  assert.ok(steps.every(step => step.record.prtsSources.length > 0));
  const text = JSON.stringify(require('../src/_data/arknightsStories.json')) + JSON.stringify(require('../src/_data/readingEntrances'));
  assert.doesNotMatch(text, /(?:不是|并非|不再是)[^。！？]{0,80}而是|与其[^。！？]{0,80}不如|不仅[^。！？]{0,80}还|规范记录|信息架构/);
});

test('release history rejects missing versions, fewer historical items and duplicates', () => {
  const before = '## V2.8.0 / #abc\n- new\n## V2.7.0 / #abc\n- old one\n- old two\n';
  assert.throws(() => validateReleaseHistory(before, '## V2.8.0\n- merged\n'), /removed: 2.7.0/);
  assert.throws(() => validateReleaseHistory(before, before.replace('- old two', '')), /items were removed/);
  assert.throws(() => releaseSections(before + '\n## V2.7.0\n'), /Duplicate/);
  assert.doesNotThrow(() => validateReleaseHistory(before, '## V2.9.0\n- added\n' + before));
  const changelog = fs.readFileSync(path.join(__dirname, '../docs/更新日志.md'), 'utf8');
  const actual = releaseSections(changelog);
  assert.equal(actual.get('2.7.0').items, 8);
  assert.equal(actual.get('2.8.0').items, 9);
});
