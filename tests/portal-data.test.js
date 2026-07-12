const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadPortalModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'js', 'modules', 'portal-transition.js')],
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

test('portal arrival can locate and render a branch ending', () => {
  const portal = loadPortalModule();
  portal.setData({
    branches: [{
      id: 'shards',
      name: '碎片世界',
      subBranches: [{
        id: 'shard-1',
        name: '第一世界',
        eras: [],
        events: [{ id: 'ff14-s1-001', title: '英雄之死', isEnding: true }],
        endings: [{ id: 'ff14-s1-001', endingNumber: 1, title: '英雄之死' }],
      }],
    }],
  });

  assert.deepEqual(portal.findEventLocation('ff14-s1-001'), {
    branchId: 'shard-1',
    branchName: '第一世界',
    eventIndex: 0,
  });

  const groups = portal.buildBranchEraGroups('shard-1');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, 'if-endings');
  assert.equal(groups[0].events[0].id, 'ff14-s1-001');
});
