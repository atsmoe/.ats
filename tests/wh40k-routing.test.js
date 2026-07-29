const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadRouting() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/wh40k-routing.js')],
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

test('legacy WH40K record hashes migrate to the canonical chronicle', () => {
  const { legacyWh40kDestination } = loadRouting();

  assert.equal(
    legacyWh40kDestination('', '#wh-115'),
    'wh40k-chronicle.html#wh-115',
  );
  assert.equal(legacyWh40kDestination('', '#imperium-nihilus'), null);
  assert.equal(legacyWh40kDestination('?zone=armageddon', '#wh-115'), null);
});
