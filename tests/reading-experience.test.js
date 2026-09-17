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

test('open readers keep other preference fields when saving a single changed setting', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const ark = createReadingStore(storage, 'arknights');
  const ff = createReadingStore(storage, 'ff14');
  ark.savePreferences({ size: 'larger' });
  ff.savePreferences({ leading: 'relaxed' });
  assert.deepEqual(createReadingStore(storage, 'wh40k').preferences(), {
    ...READER_DEFAULTS, size: 'larger', leading: 'relaxed',
  });
});

test('preference reload handles updates, resets, removals and malformed storage without writing', () => {
  const key = 'ats.reader.preferences.v1';
  const memory = new Map();
  let writes = 0;
  const storage = { getItem: key => memory.get(key), setItem(key, value) { writes++; memory.set(key, value); } };
  const first = createReadingStore(storage, 'arknights');
  const second = createReadingStore(storage, 'ff14');
  first.savePreferences({ size: 'larger', spoilers: 'titles' });
  second.reloadPreferences();
  assert.deepEqual(second.preferences(), first.preferences());
  assert.equal(writes, 1);
  second.savePreferences({ leading: 'relaxed' });
  first.savePreferences(READER_DEFAULTS);
  second.reloadPreferences();
  assert.deepEqual(second.preferences(), READER_DEFAULTS);
  for (const invalid of ['{', '["large"]', '{"size":"1px","width":"unsafe"}', null]) {
    if (invalid === null) memory.delete(key); else memory.set(key, invalid);
    second.reloadPreferences();
    assert.deepEqual(second.preferences(), READER_DEFAULTS);
  }
  assert.equal(writes, 3, 'passive reloads must not write back or create cross-tab loops');
});

test('temporary preferences survive reloads and later edits after storage fails', () => {
  const saved = JSON.stringify({ ...READER_DEFAULTS, size: 'large' });
  for (const failure of ['read', 'write', 'missing']) {
    let failRead = false;
    const storage = failure === 'missing' ? null : {
      getItem() { if (failRead) throw Error('denied'); return saved; },
      setItem() { throw Error('quota'); },
    };
    const store = createReadingStore(storage, 'arknights');
    failRead = failure === 'read';
    assert.equal(store.savePreferences({ size: 'larger' }), false);
    store.reloadPreferences();
    store.savePreferences({ leading: 'relaxed' });
    store.reloadPreferences();
    assert.deepEqual(store.preferences(), { ...READER_DEFAULTS, size: 'larger', leading: 'relaxed' });
    assert.equal(store.available, false);
  }
});

test('bookmark writes merge the latest saved list across open readers', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const chronicle = createReadingStore(storage, 'arknights');
  const topic = createReadingStore(storage, 'arknights');
  chronicle.setBookmark('evt-375', true);
  topic.setBookmark('if-sarkaz-endless-ending-2', true);
  assert.deepEqual(createReadingStore(storage, 'arknights').bookmarks(), ['evt-375', 'if-sarkaz-endless-ending-2']);
  chronicle.setBookmark('evt-375', false);
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
  store.setBookmark('if-sarkaz-endless-ending-2', true);
  store.reloadBookmarks();
  store.setBookmark('evt-375', false);
  assert.deepEqual(store.bookmarks(), ['if-sarkaz-endless-ending-2']);
  assert.equal(store.available, false);
});

test('repeated bookmark intents are idempotent across stale stores and preserve unrelated saves', () => {
  const key = 'ats.arknights.reader.bookmarks.v1';
  const memory = new Map([[key, '["evt-375"]']]);
  let writes = 0;
  const storage = { getItem: key => memory.get(key), setItem(key, value) { writes++; memory.set(key, value); } };
  const first = createReadingStore(storage, 'arknights'), second = createReadingStore(storage, 'arknights');
  assert.equal(first.setBookmark('evt-375', false), true);
  assert.equal(second.setBookmark('evt-375', false), true);
  assert.deepEqual(second.bookmarks(), []);
  assert.equal(writes, 1, 'a repeated cancellation must not save the record again');
  assert.equal(first.setBookmark('evt-375', true), true);
  assert.equal(second.setBookmark('evt-375', true), true);
  assert.deepEqual(second.bookmarks(), ['evt-375']);
  assert.equal(writes, 2, 'a repeated collection must not cancel the record');
  second.setBookmark('future-record', true);
  first.setBookmark('evt-375', false);
  assert.deepEqual(first.bookmarks(), ['future-record']);
  second.reloadBookmarks();
  assert.deepEqual(second.bookmarks(), ['future-record']);
});

test('bookmark intents retain unresolved IDs, enforce capacity and reject invalid requests', () => {
  const key = 'ats.arknights.reader.bookmarks.v1';
  const ids = Array.from({ length: 30 }, (_, index) => `unresolved-${index}`);
  const memory = new Map([[key, JSON.stringify(ids)]]);
  let writes = 0;
  const storage = { getItem: key => memory.get(key), setItem(key, value) { writes++; memory.set(key, value); } };
  const store = createReadingStore(storage, 'arknights');
  assert.deepEqual(store.bookmarks(), ids);
  assert.equal(writes, 0);
  assert.equal(store.setBookmark(ids[0], true), true, 'already saved succeeds even at capacity');
  assert.equal(store.setBookmark('missing', false), true, 'already absent remains absent');
  assert.equal(store.setBookmark('evt-375', true), false);
  for (const [id, saved] of [[null, true], ['javascript:alert(1)', true], ['x'.repeat(101), false], ['evt-375', undefined], ['evt-375', 'false']]) {
    assert.equal(store.setBookmark(id, saved), false);
  }
  assert.equal(writes, 0);
  store.setBookmark(ids[0], false);
  assert.equal(store.setBookmark('evt-375', true), true);
  assert.deepEqual(store.bookmarks(), [...ids.slice(1), 'evt-375']);
});

test('reader preferences accept only known options and tolerate damaged storage', () => {
  for (const bad of [null, [], {}, 'bad', { size: '1px', width: '<script>' }]) assert.deepEqual(normalizePreferences(bad), READER_DEFAULTS);
  const denied = createReadingStore({ getItem() { throw Error(); }, setItem() { throw Error(); } }, 'arknights');
  assert.deepEqual(denied.preferences(), READER_DEFAULTS);
  assert.equal(denied.available, false, 'blocked storage must be reported before the first write');
  assert.equal(denied.savePreferences({ size: 'larger' }), false);
  assert.equal(denied.preferences().size, 'larger');
  assert.equal(denied.available, false);
  assert.equal(denied.setBookmark('evt-003', true), true);
  assert.deepEqual(denied.bookmarks(), ['evt-003']);
  const damaged = createReadingStore({ getItem: () => '{', setItem() {} }, 'arknights');
  assert.equal(damaged.available, true, 'invalid JSON does not mean storage access was denied');
});

test('preferences cross worlds while bounded bookmarks stay separate and removable', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const ark = createReadingStore(storage, 'arknights');
  ark.savePreferences({ size: 'large', leading: 'relaxed' });
  for (let i = 0; i < 30; i++) assert.equal(ark.setBookmark(`evt-${i}`, true), true);
  assert.equal(ark.setBookmark('evt-31', true), false);
  assert.equal(ark.setBookmark('javascript:alert(1)', true), false);
  const wh = createReadingStore(storage, 'wh40k');
  assert.equal(wh.preferences().size, 'large');
  assert.deepEqual(wh.bookmarks(), []);
  ark.setBookmark('evt-0', false);
  assert.equal(ark.setBookmark('evt-31', true), true);
  assert.equal(createReadingStore(storage, 'arknights').bookmarks().length, 30);
  for (const id of ark.bookmarks()) if (id !== 'evt-31') ark.setBookmark(id, false);
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
