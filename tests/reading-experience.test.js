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

test('bookmark writes merge the latest saved list across open readers', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const chronicle = createReadingStore(storage, 'arknights');
  const topic = createReadingStore(storage, 'arknights');
  chronicle.toggleBookmark('evt-375');
  topic.toggleBookmark('if-sarkaz-endless-ending-2');
  assert.deepEqual(createReadingStore(storage, 'arknights').bookmarks(), ['evt-375', 'if-sarkaz-endless-ending-2']);
  chronicle.toggleBookmark('evt-375');
  assert.deepEqual(createReadingStore(storage, 'arknights').bookmarks(), ['if-sarkaz-endless-ending-2']);
  topic.reloadBookmarks();
  assert.deepEqual(topic.bookmarks(), ['if-sarkaz-endless-ending-2']);
  memory.delete('ats.arknights.reader.bookmarks.v1');
  topic.reloadBookmarks();
  assert.deepEqual(topic.bookmarks(), []);
});

test('failed bookmark writes keep the current session state and never erase it on reload', () => {
  const storage = { getItem: () => '["evt-375"]', setItem() { throw Error('quota'); } };
  const store = createReadingStore(storage, 'arknights');
  store.toggleBookmark('if-sarkaz-endless-ending-2');
  store.reloadBookmarks();
  store.toggleBookmark('evt-375');
  assert.deepEqual(store.bookmarks(), ['if-sarkaz-endless-ending-2']);
  assert.equal(store.available, false);
});

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

test('three story guides preserve fourteen original records, dates and sources', () => {
  const stories = require('../src/_data/storyDossiers')();
  const originals = new Map(require('../src/_data/arknightsChronicle')().eras.flatMap(era => era.events).map(record => [record.id, record]));
  assert.deepEqual(stories.map(story => [story.id, story.steps.length]), [['mansfield', 4], ['nearl', 6], ['siesta', 4]]);
  for (const story of stories) {
    for (const step of story.steps) {
      assert.deepEqual(step.record, originals.get(step.eventId));
      assert.ok(step.record.prtsSources.length > 0);
    }
  }
  const correction = stories.find(story => story.id === 'nearl').steps.at(-1);
  assert.equal(correction.record.dateRaw, '1097.11.6');
  assert.match(correction.dateNote, /11 月 7 日/);
});

test('story resolution rejects ambiguous navigation and missing references', () => {
  const { resolveStories } = require('../src/_data/storyDossiers');
  const story = { id: 'one', steps: [{ eventId: 'evt-1' }] };
  const record = { id: 'evt-1', description: 'Original', sources: ['Source'] };
  assert.throws(() => resolveStories([story, story], [record]), /Duplicate story:/);
  assert.throws(() => resolveStories([story, { ...story, id: 'two' }], [record]), /Duplicate story reference/);
  assert.throws(() => resolveStories([{ ...story, steps: [...story.steps, ...story.steps] }], [record]), /Duplicate story reference/);
  assert.throws(() => resolveStories([story], []), /Story reference missing/);
  assert.throws(() => resolveStories([{ id: 'empty', steps: [] }], []), /Story has no steps/);
  assert.equal(resolveStories([story], [record])[0].steps[0].record, record);
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

test('the six authorized release corrections preserve full sections and reject collisions', () => {
  const corrections = [
    ['2.9.0', '2.8.7'], ['2.9.1', '2.8.8'],
    ['2.10.0', '2.8.9'], ['2.10.1', '2.8.10'],
    ['2.11.0', '2.8.11'], ['2.11.1', '2.8.12'],
  ];
  for (const [previous, current] of corrections) {
    const before = `## V${previous} / 2026-09-17 / #abc\n\nSubtitle\n\n- one\n- two\n`;
    const after = before.replace(`V${previous}`, `V${current}`);
    assert.doesNotThrow(() => validateReleaseHistory(before, after));
    assert.doesNotThrow(() => validateReleaseHistory(before.replaceAll('\n', '\r\n'), after));
    for (const altered of [
      after.replace('- two\n', ''), after.replace('- two', '- rewritten'),
      after.replace('Subtitle', 'Changed subtitle'), after.replace('2026-09-17', '2026-09-16'),
      after.replace('#abc', '#def'),
    ]) {
      assert.throws(() => validateReleaseHistory(before, altered), /Renumbered changelog content was changed/);
    }
    assert.throws(() => validateReleaseHistory(before + after, after), /target already existed/);
    assert.throws(() => validateReleaseHistory(before, ''), /Historical changelog version was removed/);
    assert.throws(() => validateReleaseHistory(after, before), /Historical changelog version was removed/);
  }
});

test('release correction leaves ordinary patch additions and historical protection intact', () => {
  const before = '## V2.8.12\n- current\n## V2.8.6\n- earlier\n';
  assert.doesNotThrow(() => validateReleaseHistory(before, '## V2.8.13\n- next\n' + before));
  assert.throws(() => validateReleaseHistory(before, before.replace('V2.8.6', 'V2.8.5')), /removed: 2.8.6/);
  assert.throws(() => validateReleaseHistory(before, before.replace('- earlier', '')), /items were removed/);
});
