const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readDist(relativePath) {
  return fs.readFileSync(path.join(DIST, relativePath), 'utf8');
}

test('navigation positioning is scoped to the site header', () => {
  const css = read('src/css/nav.css');

  assert.match(css, /^#nav\s*\{/m);
  assert.match(css, /^#nav\.visible\s*\{/m);
  assert.doesNotMatch(css, /^nav(?:\.visible)?\s*\{/m);
});

test('integrated-strategy card metadata remains readable', () => {
  const css = read('src/css/arknights-world.css');
  assert.match(
    css,
    /\.is-index-runtime-meta\s*\{[^}]*font:\s*11px\/1\.25/s,
    'card result metadata must not regress to the former 9px size',
  );
});

test('mobile navigation is hidden from assistive navigation until opened', () => {
  const html = readDist('arknights.html');

  assert.match(
    html,
    /id="nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="nav-mobile-menu"/,
  );
  assert.match(
    html,
    /id="nav-mobile-menu"[^>]*aria-hidden="true"[^>]*\binert\b/,
  );
});

test('star-map world signals have keyboard controls and a linked scene fallback', () => {
  const html = readDist('index.html');
  const css = read('src/css/star-map.css');
  const interaction = read('src/js/modules/star-map-entry.js');
  const signals = [...html.matchAll(/<a\b(?=[^>]*class="star-map-signal")(?=[^>]*data-world-signal="([^"]+)")(?=[^>]*href="\.\/(arknights|wh40k|ff14)\.html")[^>]*>/g)]
    .map(match => match[1]);
  const fallback = html.match(/<nav id="star-map-fallback"[\s\S]*?<\/nav>/)?.[0] || '';

  assert.deepEqual(signals, ['arknights', 'wh40k', 'ff14']);
  assert.match(fallback, /href="\.\/arknights\.html"/);
  assert.match(fallback, /href="\.\/wh40k\.html"/);
  assert.match(fallback, /href="\.\/ff14\.html"/);
  assert.match(html, /<h1\b[^>]*class="sr-only"/);
  assert.match(html, /id="star-map-readout"[^>]*aria-live="polite"/);
  assert.match(
    css,
    /\.star-map-signal\s*\{[^}]*min-height:\s*66px;/s,
    'keyboard-focusable world signals need a real hit box',
  );
  assert.match(interaction, /new AbortController\(\)/);
  assert.match(interaction, /function destroy\(\)/);
  assert.match(interaction, /listen\(window, 'pagehide', destroy/);
});

test('FFXIV no-script lenses remove inactive selector controls', () => {
  const reflections = readDist('ff14-reflections.html');
  const journeys = readDist('ff14-journeys.html');

  assert.match(reflections, /<noscript><style>[^<]*\.ff-prism-map\{display:none!important\}/);
  assert.match(journeys, /<noscript><style>[^<]*\.ff-constellation\{display:none!important\}/);
});

test('FFXIV full no-script chronicle stays within the PC-first transfer budget', () => {
  const html = fs.readFileSync(path.join(DIST, 'ff14-chronicle.html'));
  const data = fs.readFileSync(path.join(DIST, 'data', 'ff14.json'));
  const combinedGzipBytes = zlib.gzipSync(html).length + zlib.gzipSync(data).length;

  assert.ok(
    combinedGzipBytes < 1100 * 1024,
    `FFXIV chronicle + canonical data grew to ${(combinedGzipBytes / 1024).toFixed(1)} KiB gzip`,
  );
});

test('timeline records expose a native keyboard action for their detail dialog', () => {
  const timeline = read('src/js/lib/virtual-timeline.js');
  const timelineUi = read('src/js/modules/timeline-ui.js');
  const css = read('src/css/timeline.css');

  assert.ok(
    (timeline.match(/className = 'event-card-open'/g) || []).length >= 2,
    'virtual and legacy renderers must both expose the detail action',
  );
  assert.match(timelineUi, /className = 'event-card-open'/);
  assert.match(timelineUi, /setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(
    timelineUi,
    /<button type="button" class="event-ref cross-world-link"/,
    'direct-rendered cross-world references must remain keyboard operable',
  );
  assert.match(css, /\.event-card-open:focus-visible\s*\{/);
});

test('a single chronicle branch does not render a redundant navigation rail', () => {
  const timelineUi = read('src/js/modules/timeline-ui.js');
  const css = read('src/css/timeline.css');

  assert.match(timelineUi, /container\.hidden = !hasMultipleBranches/);
  assert.match(timelineUi, /aria-hidden', String\(!hasMultipleBranches\)/);
  assert.match(css, /\.tl-branches\[hidden\]\s*\{\s*display:\s*none;/);
});

test('Arknights ending cards expose a native keyboard selection action', () => {
  const topic = read('src/js/modules/arknights-integrated-strategies.js');
  const css = read('src/css/arknights-world.css');

  assert.match(topic, /element\(\s*'button',\s*'is-ending-select'/);
  assert.match(topic, /selectButton\.type = 'button'/);
  assert.match(topic, /selectButton\.setAttribute\('aria-pressed'/);
  assert.match(topic, /event\.target\.closest\('a, button'\)/);
  assert.match(css, /\.is-ending-select:focus-visible/);
});
