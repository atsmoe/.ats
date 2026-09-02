const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { createB4BuildOptions } = require('../scripts/build-b4-prototype.js');
const { createB5BuildOptions } = require('../scripts/build-b5-prototype.js');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'src', 'star-map-b4-prototype.njk');
const CONTROLLER = path.join(ROOT, 'src', 'js', 'prototypes', 'star-map-b4-prototype.js');
const STAGE = path.join(ROOT, 'src', 'js', 'prototypes', 'b4-cosmic-stage.js');
const FORMAL_HOME = path.join(ROOT, 'src', 'index.njk');
const B5_TEMPLATE = path.join(ROOT, 'src', 'star-map-b5-prototype.njk');
const B5_CONTROLLER = path.join(ROOT, 'src', 'js', 'prototypes', 'star-map-b5-prototype.js');

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

test('formal star map retains its production entry and exposes both reviewed previews', () => {
  const formalHome = read(FORMAL_HOME);
  const prototype = read(TEMPLATE);
  const b5Prototype = read(B5_TEMPLATE);
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  assert.match(formalHome, /scriptFile:\s*star-map-3d\.js/);
  assert.match(formalHome, /id="galaxy-markers"/);
  assert.match(formalHome, /data-star-map-version-switch/);
  assert.match(formalHome, /href="\.\/star-map-b4-prototype\.html"/);
  assert.match(formalHome, /href="\.\/star-map-b5-prototype\.html"/);
  assert.match(prototype, /header-version-switch/);
  assert.match(prototype, /href="\.\/index\.html"[^>]*aria-label="切换至正式星图"/);
  assert.match(b5Prototype, /href="\.\/index\.html"[^>]*aria-label="返回正式星图首页"/);
  assert.match(pkg.scripts.build, /build-b4-prototype/);
  assert.match(pkg.scripts.build, /build-b5-prototype/);
});

test('B5 observation prototype owns an independent two-dimensional source chain', () => {
  for (const filePath of [B5_TEMPLATE, B5_CONTROLLER]) {
    assert.ok(fs.existsSync(filePath), `missing ${path.relative(ROOT, filePath)}`);
  }

  const template = read(B5_TEMPLATE);
  const controller = read(B5_CONTROLLER);
  assert.match(template, /permalink:\s*\.\/star-map-b5-prototype\.html/);
  assert.match(template, /scriptFile:\s*star-map-b5-prototype\.js/);
  assert.match(template, /star-map-b5-prototype\.css/);
  assert.match(template, /terra-observation-natural\.webp/);
  assert.match(template, /terra-territory-projection\.svg/);
  assert.match(controller, /const WORLDS = \[/);
  assert.doesNotMatch(`${template}\n${controller}`, /three|OrbitControls|WebGLRenderer/);
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

test('B5 controller bundles independently without Three.js', async () => {
  const result = await esbuild.build(createB5BuildOptions({
    write: false,
    minify: true,
    logLevel: 'silent',
  }));
  assert.equal(result.errors.length, 0);
  const bundle = result.outputFiles[0].contents;
  assert.ok(bundle.length > 5 * 1024, 'B5 bundle unexpectedly empty');
  assert.ok(bundle.length < 80 * 1024, 'B5 bundle exceeds local review budget');
  assert.equal(Buffer.from(bundle).includes(Buffer.from('WebGLRenderer')), false);
});

test('B5 keeps interactions alive when restored from the back-forward cache', () => {
  const source = read(B5_CONTROLLER);

  assert.match(source, /function handlePageHide\(event\)\s*\{\s*if \(!event\.persisted\) destroy\(\);/);
  assert.match(source, /listen\(window, 'pagehide', handlePageHide\)/);
  assert.doesNotMatch(source, /listen\(window, 'pagehide', destroy/);
});
