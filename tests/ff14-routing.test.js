const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadModule(relativePath) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, relativePath)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(
    module,
    module.exports,
    require,
  );
  return module.exports;
}

test('every FFXIV canonical record routes to the chronicle page', () => {
  const { worldRecordHref } = loadModule('src/js/modules/world-routing.js');

  for (const [eventId, branchId] of [
    ['ff14-337', 'mainline'],
    ['ff14-s1-001', 'shard-1'],
    ['ff14-s13-001', 'shard-13'],
    ['ff14-a-001', 'anecdotes'],
    ['ff14-l-001', 'lore'],
  ]) {
    assert.equal(
      worldRecordHref({ worldId: 'ff14', eventId, branchId }),
      `./ff14-chronicle.html#${eventId}`,
    );
  }
});

test('other split world pages keep their canonical record destinations', () => {
  const { worldRecordHref } = loadModule('src/js/modules/world-routing.js');

  assert.equal(
    worldRecordHref({ worldId: 'wh40k', eventId: 'wh-115', branchId: 'mainline' }),
    './wh40k-chronicle.html#wh-115',
  );
  assert.equal(
    worldRecordHref({
      worldId: 'arknights',
      eventId: 'if-mizuki-ending-2',
      branchId: 'if-mizuki',
    }),
    './arknights-is-mizuki.html?record=if-mizuki-ending-2#if-mizuki-ending-2',
  );
  assert.equal(
    worldRecordHref({ worldId: 'arknights', eventId: 'main-001', branchId: 'mainline' }),
    './arknights-chronicle.html#main-001',
  );
  assert.equal(
    worldRecordHref({
      worldId: 'arknights',
      eventId: 'if-blackflow-ending-1',
    }),
    './arknights-is-blackflow.html?record=if-blackflow-ending-1#if-blackflow-ending-1',
  );
});

test('legacy FFXIV hashes migrate once while an ordinary portal URL stays put', () => {
  const { legacyFf14Destination } = loadModule('src/js/modules/ff14-routing.js');

  assert.equal(legacyFf14Destination('', ''), null);
  assert.equal(
    legacyFf14Destination('', '#ff14-a-001'),
    'ff14-chronicle.html#ff14-a-001',
  );
  assert.equal(legacyFf14Destination('', '#ff14-world'), null);
  assert.equal(
    legacyFf14Destination('?reflection=reflection-9', ''),
    null,
  );
});

test('selectable FFXIV lenses accept only known query or hash IDs', () => {
  const { resolveFf14Selection } = loadModule('src/js/modules/ff14-routing.js');
  const allowed = ['source', 'reflection-1', 'reflection-9'];

  assert.equal(
    resolveFf14Selection('?reflection=reflection-9', '', 'reflection', allowed),
    'reflection-9',
  );
  assert.equal(
    resolveFf14Selection('', '#reflection-1', 'reflection', allowed),
    'reflection-1',
  );
  assert.equal(
    resolveFf14Selection('?reflection=missing', '#missing', 'reflection', allowed),
    'source',
  );
});

test('FFXIV lens selections create shareable history entries and restore on back', () => {
  const { ff14SelectionUrl } = loadModule('src/js/modules/ff14-routing.js');
  const entrySource = require('node:fs').readFileSync(
    path.join(ROOT, 'src/js/modules/ff14-entry.js'),
    'utf8',
  );

  assert.equal(
    ff14SelectionUrl(
      'https://archive.test/ff14-reflections.html?reflection=source#source',
      'reflection',
      'reflection-9',
    ),
    '/ff14-reflections.html?reflection=reflection-9#reflection-9',
  );
  assert.match(entrySource, /history\.pushState\(/);
  assert.match(entrySource, /listen\(window, 'popstate'/);
  assert.match(entrySource, /select\(selection, \{ updateUrl: false, focus: false \}\)/);
});
