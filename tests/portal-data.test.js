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

test('portal arrival can locate and render a nested reflection history', () => {
  const portal = loadPortalModule();
  portal.setData({
    branches: [{
      id: 'shards',
      name: '碎片世界',
      subBranches: [{
        id: 'shard-1',
        name: '第一世界',
        description: '第一世界的可追溯历史，不是结局分支。',
        eras: [{
          title: '光之泛滥',
          events: [{ id: 'ff14-s1-001', title: '英雄之死' }],
        }],
        events: [{ id: 'ff14-s1-001', title: '英雄之死' }],
      }],
    }],
  });

  assert.deepEqual(portal.findEventLocation('ff14-s1-001'), {
    branchId: 'shard-1',
    branchName: '第一世界',
    eventIndex: 0,
  });

  const groups = portal.buildBranchEraGroups('shard-1');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].type, 'notice');
  assert.equal(groups[0].data.title, '第一世界');
  assert.equal(groups[1].type, 'era');
  assert.equal(groups[1].events[0].id, 'ff14-s1-001');
});
