const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('formal star map exposes one spatial stage and three discoverable world signals', () => {
  const template = read('src/index.njk');

  assert.match(template, /id="star-map-stage"/);
  assert.match(template, /id="star-map-readout"/);
  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    assert.match(template, new RegExp(`data-world-signal="${worldId}"`));
  }
  assert.equal((template.match(/<a\b[^>]*class="star-map-signal"/g) ?? []).length, 3);
  assert.match(template, /六边形区划[^<]*官方公开信息/u);
  assert.match(template, /地形[^<]*社区补绘/u);
  assert.match(template, /不代表官方地理投影/u);
  assert.doesNotMatch(template, /id="galaxy-detail"/);
  assert.doesNotMatch(template, /id="galaxy-markers"/);
});

test('formal spatial stage uses authored Terra textures and owns all three world structures', () => {
  const entry = read('src/js/modules/star-map-entry.js');
  assert.match(entry, /world-atlas-stage\.js/);

  const stage = read('src/js/modules/world-atlas-stage.js');
  assert.match(stage, /terra-globe-albedo\.webp/);
  assert.match(stage, /terra-globe-relief\.png/);
  assert.match(stage, /planetMaterial\.bumpMap = relief/);
  assert.doesNotMatch(stage, /terra-globe-hex-overlay/);

  const assetBuilder = read('scripts/terra-globe-assets.js');
  assert.doesNotMatch(assetBuilder, /function createHexSvg/);
  assert.match(stage, /createTerraSystem/);
  assert.match(stage, /createBrokenGalaxy/);
  assert.match(stage, /createFourteenWorlds/);
  assert.match(stage, /focusWorld/);
  assert.match(stage, /screenPositions/);
});

test('formal star map keeps a readable non-WebGL fallback', () => {
  const template = read('src/index.njk');
  const stylesheet = read('src/css/star-map.css');
  const entry = read('src/js/modules/star-map-entry.js');
  const stage = read('src/js/modules/world-atlas-stage.js');

  assert.match(template, /id="star-map-fallback"/);
  assert.match(template, /<noscript>[\s\S]*#star-map-fallback\s*\{\s*display:\s*grid/s);
  assert.match(stylesheet, /\.is-fallback/);
  assert.match(stylesheet, /@media \(max-width: 760px\)/);
  assert.match(stylesheet, /prefers-reduced-motion/);
  assert.match(entry, /webglcontextlost/);
  assert.match(entry, /function requestFrame\(\)/);
  assert.match(entry, /if \(!reducedMotion\) requestFrame\(\)/);
  assert.ok((stage.match(/if \(reducedMotion\) return;/g) ?? []).length >= 3);
});
