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
