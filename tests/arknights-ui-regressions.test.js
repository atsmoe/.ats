const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('Terra map viewer supports native download and deliberate 2x zoom', () => {
  const template = read('src/arknights.njk');
  const entry = read('src/js/modules/arknights-entry.js');
  const css = read('src/css/arknights-world.css');

  assert.match(template, /download[^>]*terra-community-administrative-map\.png|terra-community-administrative-map\.png[^>]*download/);
  assert.match(template, /terra-community-administrative-map-preview\.webp/);
  assert.match(template, /terra-community-administrative-map\.png" width="4081" height="5488"/);
  assert.match(template, /data-terra-map-zoom/);
  assert.match(entry, /addEventListener\('dblclick'/);
  assert.match(entry, /is-zoomed/);
  assert.match(css, /\.terra-map-viewport\.is-zoomed/);
  assert.match(
    css,
    /\.terra-map-viewport\.is-zoomed img\s*\{[^}]*width:\s*auto;[^}]*height:\s*200%;/s,
    '2x zoom must preserve the portrait map aspect ratio',
  );
});

test('Terra home keeps only the route that actually leaves the page', () => {
  const template = read('src/arknights.njk');

  assert.doesNotMatch(template, /class="terra-entry-grid"/);
  assert.match(template, /class="terra-chronicle-launch"[^>]*href="\.\/arknights-chronicle\.html"/);
});

test('Arknights chronicle cover owns a themed telemetry layer', () => {
  const template = read('src/arknights-chronicle.njk');
  const css = read('src/css/timeline.css');

  assert.match(template, /class="tl-cover-telemetry"/);
  assert.match(css, /\.ark-chronicle-page \.tl-cover-telemetry/);
});

test('Arknights event dossier fills the viewport below navigation', () => {
  const css = read('src/css/timeline.css');

  assert.match(css, /:is\(\.ark-chronicle-page, \.wh-chronicle-page, \.ff-chronicle-page\) \.event-modal-overlay\s*\{[^}]*inset:\s*var\(--nav-h\)\s+0\s+0/s);
  assert.match(css, /:is\(\.ark-chronicle-page, \.wh-chronicle-page, \.ff-chronicle-page\) \.event-modal-card\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
});

test('era dividers are painted above neighboring event cards', () => {
  const css = read('src/css/timeline.css');

  assert.match(css, /\.tl-era-header\s*\{[^}]*z-index:\s*4/s);
  assert.match(css, /\.tl-era-header\s*\{[^}]*height:\s*140px;[^}]*margin:\s*0\s+0\s+0/s);
  assert.match(css, /\.tl-era-header\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(css, /\.tl-event\s*\{[^}]*z-index:\s*1/s);
});
