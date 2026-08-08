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

test('star-map worlds are real links and the detail overlay is an inert dialog', () => {
  const html = readDist('index.html');
  const css = read('src/css/star-map.css');
  const interaction = read('src/js/modules/star-map.js');
  const markers = [...html.matchAll(
    /<a\b[^>]*class="galaxy-marker"[^>]*data-world="([^"]+)"[^>]*href="([^"]+)"/g,
  )].map(match => [match[1], match[2]]);

  assert.deepEqual(markers, [
    ['arknights', './arknights.html'],
    ['wh40k', './wh40k.html'],
    ['ff14', './ff14.html'],
  ]);
  assert.match(html, /<h1\b[^>]*class="sr-only"/);
  assert.match(
    html,
    /id="galaxy-detail"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"[^>]*\binert\b/s,
  );
  assert.match(
    css,
    /\.galaxy-marker\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    'keyboard-focusable world markers need a real hit box',
  );
  assert.match(interaction, /new AbortController\(\)/);
  assert.match(interaction, /export function destroyStarMap\(\)/);
  assert.match(interaction, /listen\(window, 'pagehide', destroyStarMap/);
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

test('Arknights ending cards expose a native keyboard selection action', () => {
  const topic = read('src/js/modules/arknights-integrated-strategies.js');
  const css = read('src/css/arknights-world.css');

  assert.match(topic, /element\(\s*'button',\s*'is-ending-select'/);
  assert.match(topic, /selectButton\.type = 'button'/);
  assert.match(topic, /selectButton\.setAttribute\('aria-pressed'/);
  assert.match(topic, /event\.target\.closest\('a, button'\)/);
  assert.match(css, /\.is-ending-select:focus-visible/);
});
