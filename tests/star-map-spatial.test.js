const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('formal star map owns three authored 2D scenes and three native world routes', () => {
  const template = read('src/index.njk');

  assert.match(template, /scriptFile: star-map-2d\.js/);
  assert.match(template, /id="star-map-stage"/);
  assert.match(template, /id="star-map-readout"/);
  assert.equal((template.match(/<img\b[^>]*data-world-scene=/g) ?? []).length, 3);
  assert.match(template, /terra-observation\.webp/);
  assert.match(template, /milky-way-rift\.webp/);
  assert.match(template, /fourteen-worlds\.webp/);
  assert.equal((template.match(/data-reflection="/g) ?? []).length, 13);
  assert.equal((template.match(/class="ff14-reflection is-surviving"/g) ?? []).length, 6);
  assert.equal((template.match(/class="ff14-reflection is-rejoined"/g) ?? []).length, 7);

  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    assert.match(template, new RegExp(`data-world-scene="${worldId}"`));
    assert.match(template, new RegExp(`data-world-signal="${worldId}"`));
  }
  assert.equal((template.match(/<a\b[^>]*class="star-map-signal"/g) ?? []).length, 3);
  assert.match(template, /六边形区划[^<]*官方公开信息/u);
  assert.match(template, /大陆轮廓与地形[^<]*社区地图/u);
  assert.match(template, /不代表官方地理投影/u);
});

test('formal star map keeps its observation plate stationary while worlds remain selectable', () => {
  const entry = read('src/js/modules/star-map-entry.js');
  const template = read('src/index.njk');
  const stylesheet = read('src/css/star-map.css');
  const build = read('build.js');

  assert.doesNotMatch(entry, /world-atlas-stage|from ['"]three['"]|WebGL|webglcontextlost/);
  assert.match(entry, /\[data-world-scene\]/);
  assert.match(entry, /function selectWorld\(/);
  assert.doesNotMatch(entry, /pointermove|pointerleave|wheel|updateParallax|updateObservationDepth/);
  assert.doesNotMatch(stylesheet, /--scene-(?:x|y|zoom)/);
  assert.doesNotMatch(stylesheet, /\.star-map-instruction span:first-child[^{]*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(template, /移动指针|滚轮|观察景深|观测距离/);
  assert.match(template, /方向键或数字键/);
  assert.match(entry, /prefers-reduced-motion/);
  assert.match(build, /star-map-2d\.js/);
  assert.doesNotMatch(build, /outfile:[^\n]*star-map-3d\.js/);
});

test('formal star map remains readable when images fail or scripting is disabled', () => {
  const template = read('src/index.njk');
  const stylesheet = read('src/css/star-map.css');
  const entry = read('src/js/modules/star-map-entry.js');

  assert.match(template, /id="star-map-fallback"/);
  assert.match(template, /class="star-map-frame"/);
  assert.match(template, /<noscript>[\s\S]*#star-map-fallback\s*\{\s*display:\s*grid/s);
  assert.match(stylesheet, /\.is-fallback/);
  assert.match(stylesheet, /@media \(max-width: 760px\)/);
  assert.match(stylesheet, /prefers-reduced-motion/);
  assert.match(entry, /function handleSceneError\(/);
  assert.match(entry, /new AbortController\(\)/);
  assert.match(entry, /function destroy\(\)/);
});
