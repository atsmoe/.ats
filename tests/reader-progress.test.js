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
