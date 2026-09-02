const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('all three chronicle worlds share the full-viewport dossier structure', () => {
  const css = read('src/css/timeline.css');

  assert.match(
    css,
    /:is\(\.ark-chronicle-page, \.wh-chronicle-page, \.ff-chronicle-page\) \.event-modal-overlay/,
  );
  assert.match(
    css,
    /:is\(\.ark-chronicle-page, \.wh-chronicle-page, \.ff-chronicle-page\) \.event-modal-card/,
  );
  assert.match(css, /\.wh-chronicle-page\s*\{[^}]*--chronicle-accent:/s);
  assert.match(css, /\.ff-chronicle-page\s*\{[^}]*--chronicle-accent:/s);
});

test('Warhammer chronicle owns a galaxy telemetry composition', () => {
  const template = read('src/wh40k-chronicle.njk');
  const css = read('src/css/wh40k-world.css');

  assert.match(template, /class="wh-chronicle-telemetry"/);
  assert.match(css, /\.world-wh40k \.wh-chronicle-telemetry/);
});

test('FFXIV chronicle owns an aether telemetry composition', () => {
  const template = read('src/ff14-chronicle.njk');
  const css = read('src/css/ff14-world.css');

  assert.match(template, /class="ff-chronicle-telemetry"/);
  assert.match(css, /\.world-ff14 \.ff-chronicle-telemetry/);
  assert.match(css, /\.world-ff14\.ff-chronicle-page #main-content\s*\{[^}]*padding-top:\s*0/s);
});

test('chronicle edge telemetry remains inset at the 12px text floor', () => {
  const arknights = read('src/arknights-chronicle.njk');
  const wh40k = read('src/wh40k-chronicle.njk');
  const ff14 = read('src/ff14-chronicle.njk');
  const ff14Css = read('src/css/ff14-world.css');

  assert.match(arknights, /<text x="790" y="101" text-anchor="end">SIGNAL \/ 07<\/text>/);
  assert.match(arknights, /<text x="790" y="350" text-anchor="end">ORIGINIUM DENSITY 0\.71<\/text>/);
  assert.match(wh40k, /<text x="850" y="258" text-anchor="end">EASTERN FRINGE<\/text>/);
  assert.match(ff14, /<text x="875" y="470" text-anchor="end">REFLECTION ARRAY \/ I—XIII<\/text>/);
  assert.match(
    ff14Css,
    /\.world-ff14 \.ff-telemetry-lock\s*\{[^}]*bottom:\s*104px;/s,
  );
  assert.match(
    ff14Css,
    /@media \(max-width:\s*900px\)[\s\S]*?\.world-ff14 \.ff-telemetry-lock\s*\{\s*display:\s*none;/,
  );
});
