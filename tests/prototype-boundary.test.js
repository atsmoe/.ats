const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { createB4BuildOptions } = require('../scripts/build-b4-prototype.js');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'src', 'star-map-b4-prototype.njk');
const CONTROLLER = path.join(ROOT, 'src', 'js', 'prototypes', 'star-map-b4-prototype.js');
const STAGE = path.join(ROOT, 'src', 'js', 'prototypes', 'b4-cosmic-stage.js');
const FORMAL_HOME = path.join(ROOT, 'src', 'index.njk');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('B4 local prototype has one complete three-file source chain', () => {
  for (const filePath of [TEMPLATE, CONTROLLER, STAGE]) {
    assert.ok(fs.existsSync(filePath), `missing ${path.relative(ROOT, filePath)}`);
  }

  const template = read(TEMPLATE);
  const controller = read(CONTROLLER);
  assert.match(template, /<script defer src="\.\/js\/star-map-b4-prototype\.js"><\/script>/);
  assert.match(controller, /import \{ createCosmicStage \} from '\.\/b4-cosmic-stage\.js';/);

  const worldBlock = controller.match(/const WORLDS = \[([\s\S]*?)\n\];/)?.[1] || '';
  const worldIds = [...worldBlock.matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(worldIds, ['arknights', 'wh40k', 'ff14']);
  assert.doesNotMatch(`${template}\n${controller}`, /未解析信号|UNRESOLVED SIGNAL|signal-0[4-9]/i);
});

test('B4 source no longer carries removed observation-anchor or mother-crystal implementations', () => {
  const source = `${read(TEMPLATE)}\n${read(CONTROLLER)}\n${read(STAGE)}`;
  for (const removedMarker of [
    'cosmic-anchor-nav',
    'cosmic-anchor-detail',
    'ANCHOR_NOTES',
    'createFf14ScenePrevious',
    'motherCrystal',
    'wispGroup',
  ]) {
    assert.equal(source.includes(removedMarker), false, `B4 still contains ${removedMarker}`);
  }
});

test('formal and B4 star maps expose one local-only two-way switch', () => {
  const formalHome = read(FORMAL_HOME);
  const prototype = read(TEMPLATE);
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  assert.match(formalHome, /data-local-prototype-toggle/);
  assert.match(formalHome, /href="\.\/star-map-b4-prototype\.html"/);
  assert.match(prototype, /header-version-switch/);
  assert.match(prototype, /href="\.\/index\.html"[^>]*aria-label="切换至正式星图"/);
  assert.doesNotMatch(pkg.scripts.build, /build-b4-prototype|prototype:b4/i);
});

test('B4 controller bundles offline with the pinned Three.js dependency', async () => {
  const result = await esbuild.build(createB4BuildOptions({
    write: false,
    minify: true,
    logLevel: 'silent',
  }));
  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles[0].contents.length > 100 * 1024, 'B4 bundle unexpectedly empty');
  assert.ok(result.outputFiles[0].contents.length < 600 * 1024, 'B4 bundle exceeds local review budget');
});
