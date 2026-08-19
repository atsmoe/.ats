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

test('formal star map adds semantic local motion without moving its authored scenes', () => {
  const template = read('src/index.njk');
  const stylesheet = read('src/css/star-map.css');
  const entry = read('src/js/modules/star-map-entry.js');
  const tokens = read('src/js/modules/anim-tokens.js');

  assert.equal((template.match(/class="star-map-world-motion"/g) ?? []).length, 1);
  assert.match(template, /class="star-map-world-motion"[^>]*viewBox="0 0 1672 941"[^>]*aria-hidden="true"/);
  assert.match(template, /data-motion-world="arknights"/);
  assert.match(template, /data-motion-world="wh40k"/);
  assert.equal((template.match(/class="terra-grid-activation"/g) ?? []).length, 3);
  assert.doesNotMatch(template, /class="terra-survey-trace"/);
  assert.equal((template.match(/--flow-angle:/g) ?? []).length, 7);
  assert.match(template, /M-32 474 C88 512 150 572 244 640 C348 716 454 777 555 814 C650 850 752 905 872 962/);
  assert.match(stylesheet, /body\[data-world="arknights"\][^\{]*\[data-motion-world="arknights"\]/);
  assert.match(stylesheet, /body\[data-world="wh40k"\][^\{]*\[data-motion-world="wh40k"\]/);
  assert.match(stylesheet, /@keyframes terra-grid-activate/);
  assert.match(stylesheet, /@keyframes wh40k-rift-flow/);
  assert.match(stylesheet, /@keyframes ff14-return-flow/);
  assert.match(stylesheet, /@keyframes star-map-acquire/);
  assert.match(stylesheet, /\.star-map-world-motion \[data-motion-world\] \*[\s\S]*animation-play-state:\s*paused/);
  assert.match(stylesheet, /body\[data-world="ff14"\][\s\S]*animation-play-state:\s*running/);
  assert.match(stylesheet, /--motion-terra-/);
  assert.match(stylesheet, /--motion-wh40k-/);
  assert.match(stylesheet, /--motion-ff14-/);
  assert.doesNotMatch(template, /stop-color="#/);
  assert.match(stylesheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.star-map-world-motion\s*\{\s*display:\s*none;/);
  assert.match(stylesheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.star-map-scanline\s*\{\s*display:\s*none;/);
  assert.match(entry, /--motion-acquire/);
  assert.match(tokens, /acquire:\s*\d+/);
  assert.match(tokens, /survey:\s*\d+/);
  assert.match(tokens, /rift:\s*\d+/);
  assert.match(tokens, /reflection:\s*\d+/);
  assert.match(tokens, /returnFlow:\s*\d+/);
  assert.doesNotMatch(entry, /pointermove|pointerleave|wheel|requestAnimationFrame/);
  assert.doesNotMatch(stylesheet, /(?:^|\})\s*[^{}]*\.star-map-scene[^{}]*\{[^{}]*animation(?:-name)?\s*:/s);
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
