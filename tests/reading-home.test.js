const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/js/modules/reading-home-model.js')], bundle: true, format: 'cjs', platform: 'node', write: false });
const loaded = { exports: {} };
new Function('module', 'exports', output.outputFiles[0].text)(loaded, loaded.exports);
const { readSavedReading, resolveSavedReading } = loaded.exports;

test('saved home entries are read-only, bounded and tolerate missing or damaged storage', () => {
  const empty = { positions: [], bookmarks: [] };
  for (const storage of [undefined, { getItem() { throw Error('denied'); } }, { getItem: () => '{' }, { getItem: () => 'null' }]) {
    assert.deepEqual(readSavedReading(storage, 'ff14'), empty);
  }
  const values = {
    'ats.ff14.reader.progress.v1': JSON.stringify({ mainline: { eventId: 'ff14-001', href: 'https://evil.test' }, bad: { eventId: 'javascript:bad' }, missing: {}, invalid: [] }),
    'ats.ff14.reader.bookmarks.v1': JSON.stringify(['ff14-002', 'ff14-002', 'bad#id', ...Array.from({ length: 40 }, (_, i) => `ff14-${i}`)]),
  };
  const storage = { getItem: key => values[key], setItem() { assert.fail('home must never rewrite saved content'); } };
  const saved = readSavedReading(storage, 'ff14');
  assert.deepEqual(saved.positions, [{ contextId: 'mainline', eventId: 'ff14-001' }]);
  assert.equal(saved.bookmarks.length, 30);
  assert.equal(new Set(saved.bookmarks).size, 30);
  assert.deepEqual(readSavedReading(storage, 'wh40k'), empty);
  assert.deepEqual(readSavedReading(storage, '../../ff14'), empty);
});

test('home positions follow actual root membership and canonical titles, dates and routes', () => {
  const data = { world: { id: 'ff14' }, branches: [
    { id: 'mainline', name: '原初世界·主线', eras: [{ events: [{ id: 'ff14-001', title: '主线标题', dateDisplay: '年代待考' }] }] },
    { id: 'shards', name: '镜像世界', subBranches: [{ id: 'shard-1', eras: [{ events: [{ id: 'ff14-002', title: '镜像标题', dateRaw: '100' }] }] }] },
  ] };
  const saved = { positions: [
    { contextId: 'shards', eventId: 'ff14-002' },
    { contextId: 'mainline', eventId: 'ff14-001', title: '伪造标题' },
    { contextId: 'unknown', eventId: 'ff14-001' },
  ], bookmarks: ['ff14-002', 'wh-017', 'missing'] };
  const before = JSON.stringify([data, saved]);
  const result = resolveSavedReading(data, saved);
  assert.deepEqual(result.positions.map(item => item.eventId), ['ff14-001', 'ff14-002', 'ff14-001']);
  assert.equal(result.positions[0].title, '主线标题');
  assert.equal(result.positions[0].date, '年代待考');
  assert.equal(result.positions[1].context, '镜像世界');
  assert.deepEqual(result.positions[2], { rootId: 'unknown', eventId: 'ff14-001', title: '暂时无法读取的阅读位置 3', context: '', unavailable: true });
  assert.equal(result.bookmarks[0].href, './ff14-chronicle.html#ff14-002');
  assert.deepEqual(result.bookmarks.slice(1), [
    { eventId: 'wh-017', title: '暂时无法读取的书签 2', unavailable: true },
    { eventId: 'missing', title: '暂时无法读取的书签 3', unavailable: true },
  ]);
  assert.equal(result.unavailable, 3);
  assert.equal(JSON.stringify([data, saved]), before);
  const mismatched = resolveSavedReading(data, { positions: [{ contextId: 'mainline', eventId: 'ff14-002' }], bookmarks: [] });
  assert.equal(mismatched.positions.length, 1);
  assert.equal(mismatched.positions[0].unavailable, true);
  assert.equal(mismatched.positions[0].href, undefined);
  assert.equal(mismatched.positions[0].context, '原初世界·主线');
});

test('home bookmarks retain Arknights topic URLs and isolate world records', () => {
  const data = { world: { id: 'arknights' }, branches: [{ id: 'if-integrated', name: '集成战略世界线', subBranches: [
    { id: 'if-sarkaz-endless', endings: [{ id: 'if-sarkaz-endless-ending-2', title: '双王记' }] },
  ] }] };
  const saved = { positions: [], bookmarks: ['if-sarkaz-endless-ending-2', 'ff14-001'] };
  const result = resolveSavedReading(data, saved);
  assert.equal(result.bookmarks.length, 2);
  assert.deepEqual(result.bookmarks[1], { eventId: 'ff14-001', title: '暂时无法读取的书签 2', unavailable: true });
  assert.equal(result.bookmarks[0].href, './arknights-is-sarkaz.html?record=if-sarkaz-endless-ending-2#if-sarkaz-endless-ending-2');
  assert.equal(result.unavailable, 1);
  assert.deepEqual(resolveSavedReading({ world: { id: 'unknown' } }, saved), { positions: [], bookmarks: [], unavailable: 0 });
});
