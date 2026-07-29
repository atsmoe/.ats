const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadDataAccessModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/data-access.js')],
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

test('data-access resolves events from nested branch contexts', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      world: { id: 'nested-test', name: 'Nested test' },
      branches: [{
        id: 'root-context',
        subBranches: [{
          id: 'nested-context',
          eras: [{
            title: 'Nested era',
            events: [{ id: 'nested-event', title: 'Nested event' }],
          }],
        }],
      }],
    }),
  });

  try {
    const { getBranchEvents } = loadDataAccessModule();
    const events = await getBranchEvents('nested-test', 'nested-context');

    assert.deepEqual(
      events.map(event => event.id),
      ['nested-event'],
    );
  } finally {
    global.fetch = originalFetch;
  }
});
