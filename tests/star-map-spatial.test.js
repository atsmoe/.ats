const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('formal star map keeps the remote 3D homepage and three world routes', () => {
  const template = read('src/index.njk');
  const entry = read('src/js/modules/star-map-entry.js');
  const build = read('build.js');
  const markers = [...template.matchAll(
    /<a\b[^>]*class="galaxy-marker"[^>]*data-world="([^"]+)"[^>]*href="([^"]+)"/g,
  )].map(match => [match[1], match[2]]);

  assert.equal(template.match(/scriptFile: star-map-3d\.js/)?.[0], 'scriptFile: star-map-3d.js');
  assert.deepEqual(markers, [
    ['arknights', './arknights.html'],
    ['wh40k', './wh40k.html'],
    ['ff14', './ff14.html'],
  ]);
  assert.match(template, /id="galaxy-detail"[^>]*role="dialog"/s);
  assert.match(entry, /initStarMap3D/);
  assert.match(entry, /initStarMap/);
  assert.match(build, /star-map-3d\.js/);
  assert.doesNotMatch(template, /star-map-2d\.js/);
  assert.doesNotMatch(entry, /star-map-2d\.js/);
});

test('formal star map retains independent B4 and B5 preview switches', () => {
  const template = read('src/index.njk');

  assert.match(template, /href="\.\/star-map-b4-prototype\.html"/);
  assert.match(template, /href="\.\/star-map-b5-prototype\.html"/);
  assert.match(template, /切换至 B4 星图原型/);
  assert.match(template, /切换至 B5 观测星图/);
});

test('legacy 2D scene contract is not present in the formal homepage', () => {
  const template = read('src/index.njk');
  const stylesheet = read('src/css/star-map.css');
  const entry = read('src/js/modules/star-map-entry.js');

  assert.doesNotMatch(template, /data-world-scene|star-map-stage|star-map-readout/);
  assert.doesNotMatch(stylesheet, /--scene-(?:x|y|zoom)|star-map-world-motion/);
  assert.doesNotMatch(entry, /pointermove|updateParallax|data-world-scene/);
});

test('three.js homepage assets remain available in the production source tree', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/js/modules/star-map-3d.js')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/js/modules/star-map.js')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/css/star-map.css')), true);
});
