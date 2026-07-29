const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadEntryModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/arknights-routing.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  const execute = new Function('module', 'exports', 'require', result.outputFiles[0].text);
  execute(module, module.exports, require);
  return module.exports;
}

test('legacy deep-blue links migrate to the Mizuki topic and preserve record focus', () => {
  const { legacyArknightsDestination } = loadEntryModule();

  assert.equal(
    legacyArknightsDestination('?dossier=deep-blue-observation&record=if-mizuki-ending-2'),
    'arknights-is-mizuki.html?record=if-mizuki-ending-2',
  );
});

test('ordinary Terra home queries are not redirected', () => {
  const { legacyArknightsDestination } = loadEntryModule();
  assert.equal(legacyArknightsDestination('?record=evt-001'), null);
});

test('legacy Terra record hashes migrate to their canonical owners', () => {
  const { legacyArknightsDestination } = loadEntryModule();

  assert.equal(
    legacyArknightsDestination('', '#evt-001'),
    'arknights-chronicle.html#evt-001',
  );
  assert.equal(
    legacyArknightsDestination('', '#if-sami-ending-3'),
    'arknights-is-sami.html?record=if-sami-ending-3#if-sami-ending-3',
  );
  assert.equal(legacyArknightsDestination('', '#terra-atlas'), null);
});
