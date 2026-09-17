const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../src/js/modules/reader-progress.js')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const readerModule = { exports: {} };
new Function('module', 'exports', result.outputFiles[0].text)(readerModule, readerModule.exports);
const { createReaderProgressStore } = readerModule.exports;

test('damaged progress is ignored and a new position repairs the entry', () => {
  for (const initial of ['null', '[]', 'true', '12', '"text"', '{', '{"mainline":null}', '{"mainline":{"eventId":4}}']) {
    let value = initial;
    const store = createReaderProgressStore({ getItem: () => value, setItem: (_key, next) => { value = next; } }, 'reader');
    assert.equal(store.read('mainline'), null, initial);
    store.write('mainline', { eventId: 'evt-480' });
    assert.equal(store.read('mainline').eventId, 'evt-480');
    assert.equal(store.read('toString'), null);
  }
});

test('worlds and contexts keep independent positions and tolerate denied storage', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const ark = createReaderProgressStore(storage, 'ark');
  const ff = createReaderProgressStore(storage, 'ff');
  ark.write('mainline', { eventId: 'evt-480' });
  ff.write('mainline', { eventId: 'ff14-001' });
  ff.write('shards', { eventId: 'ff14-s1-013' });
  assert.equal(ark.read('mainline').eventId, 'evt-480');
  assert.equal(ff.read('mainline').eventId, 'ff14-001');
  assert.equal(ff.read('shards').eventId, 'ff14-s1-013');
  const denied = createReaderProgressStore({
    getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); },
  }, 'reader');
  assert.equal(denied.read('mainline'), null);
  assert.doesNotThrow(() => denied.write('mainline', { eventId: 'evt-480' }));
});

test('removing a reading position changes only the matching context and preserves unrelated values', () => {
  const original = { mainline: { eventId: 'ff14-001', offset: 23 }, shards: { eventId: 'ff14-s1-013' }, future: { data: true } };
  let value = JSON.stringify(original), writes = 0;
  const store = createReaderProgressStore({ getItem: () => value, setItem: (_key, next) => { writes++; value = next; } }, 'reader');
  assert.equal(store.remove('mainline', 'ff14-001'), 'removed');
  assert.deepEqual(JSON.parse(value), { shards: original.shards, future: original.future });
  assert.equal(writes, 1);
  assert.equal(store.remove('mainline', 'ff14-001'), 'missing');
  assert.equal(writes, 1);
  assert.equal(store.remove('shards', 'ff14-s1-013'), 'removed');
  assert.deepEqual(JSON.parse(value), { future: original.future });
});

test('stale removal refuses a newer position and inherited keys without writing', () => {
  let value = '{"mainline":{"eventId":"evt-380"}}', writes = 0;
  const store = createReaderProgressStore({ getItem: () => value, setItem: () => { writes++; } }, 'reader');
  assert.equal(store.remove('mainline', 'evt-375'), 'changed');
  assert.equal(store.read('mainline').eventId, 'evt-380');
  assert.equal(store.remove('toString', 'evt-375'), 'missing');
  assert.equal(writes, 0);
});

test('failed position removal retains saved content and can be retried', () => {
  let value = '{"mainline":{"eventId":"evt-375"}}', denied = true;
  const store = createReaderProgressStore({
    getItem: () => value,
    setItem: (_key, next) => { if (denied) throw Error('denied'); value = next; },
  }, 'reader');
  assert.equal(store.remove('mainline', 'evt-375'), 'unavailable');
  assert.equal(store.read('mainline').eventId, 'evt-375');
  denied = false;
  assert.equal(store.remove('mainline', 'evt-375'), 'removed');
  assert.equal(store.read('mainline'), null);
  assert.equal(createReaderProgressStore(undefined, 'reader').remove('mainline', 'evt-375'), 'unavailable');
  for (const raw of ['{', 'null', '[]']) {
    const broken = createReaderProgressStore({ getItem: () => raw, setItem: () => assert.fail('must not rewrite damaged storage') }, 'reader');
    assert.ok(['missing', 'unavailable'].includes(broken.remove('mainline', 'evt-375')));
  }
  const unreadable = createReaderProgressStore({ getItem() { throw Error('denied'); }, setItem() { assert.fail('must not write after a failed read'); } }, 'reader');
  assert.equal(unreadable.remove('mainline', 'evt-375'), 'unavailable');
});
