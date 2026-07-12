const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function readDist(relativePath) {
  return fs.readFileSync(path.join(DIST, relativePath), 'utf8');
}

function collectAssetReferences(value, references = new Set()) {
  if (typeof value === 'string' && value.startsWith('./assets/')) {
    references.add(value.slice(2));
    return references;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectAssetReferences(item, references);
    return references;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssetReferences(item, references);
  }

  return references;
}

test('production build contains every public page and data file', () => {
  const required = [
    'index.html',
    'arknights.html',
    'wh40k.html',
    'ff14.html',
    'about.html',
    'changelog.html',
    'data/arknights.json',
    'data/wh40k.json',
    'data/ff14.json',
    'data/event-index.json',
    'js/bundle.js',
    'js/star-map-3d.js',
    'js/virtual-timeline.js',
  ];

  for (const relativePath of required) {
    assert.ok(fs.existsSync(path.join(DIST, relativePath)), `missing dist/${relativePath}`);
  }
});

test('the current project version is documented for visitors and maintainers', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const versionLabel = `V${pkg.version}`;
  const changelog = fs.readFileSync(path.join(ROOT, 'docs', '更新日志.md'), 'utf8');
  const developmentLog = fs.readFileSync(path.join(ROOT, 'docs', '开发日志.md'), 'utf8');

  assert.match(changelog, new RegExp(`^## ${versionLabel}\\b`, 'm'));
  assert.match(developmentLog, new RegExp(`^.*${versionLabel}：`, 'm'));
});

test('the star map and world pages load separate JavaScript bundles', () => {
  const index = readDist('index.html');
  assert.match(index, /src="\.\/js\/star-map-3d\.js"/);
  assert.doesNotMatch(index, /src="\.\/js\/bundle\.js"/);

  for (const page of ['arknights.html', 'wh40k.html', 'ff14.html']) {
    const html = readDist(page);
    assert.match(html, /src="\.\/js\/bundle\.js"/, `${page} must load the world bundle`);
    assert.match(html, /src="\.\/js\/virtual-timeline\.js"/, `${page} must load the timeline engine`);
    assert.doesNotMatch(html, /src="\.\/js\/star-map-3d\.js"/, `${page} must not load Three.js`);
  }
});

test('world data and the global event index are valid build artifacts', () => {
  const index = JSON.parse(readDist('data/event-index.json'));
  const locations = Object.values(index);
  const minimumEvents = {
    arknights: 880,
    wh40k: 110,
    ff14: 430,
  };

  assert.ok(locations.length >= 1420, `event index unexpectedly shrank to ${locations.length} events`);

  for (const [worldId, minimum] of Object.entries(minimumEvents)) {
    const count = locations.filter(location => location.worldId === worldId).length;
    assert.ok(count >= minimum, `${worldId} event index unexpectedly shrank to ${count}`);
  }

  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    const data = JSON.parse(readDist(`data/${worldId}.json`));
    assert.equal(data.world.id, worldId);
    assert.ok(Array.isArray(data.branches) && data.branches.length > 0, `${worldId} needs branches`);
  }
});

test('public pages retain the critical navigation and interaction containers', () => {
  const index = readDist('index.html');
  assert.match(index, /id="galaxy-markers"/);
  assert.match(index, /data-world="arknights"/);
  assert.match(index, /data-world="wh40k"/);
  assert.match(index, /data-world="ff14"/);

  for (const page of ['arknights.html', 'wh40k.html', 'ff14.html']) {
    const html = readDist(page);
    assert.match(html, /id="tl-container"/, `${page} needs the timeline container`);
    assert.match(html, /id="event-modal"/, `${page} needs the event modal`);
    assert.match(html, /id="tl-branches"/, `${page} needs branch navigation`);
  }
});

test('every media file referenced by production data exists', () => {
  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    const data = JSON.parse(readDist(`data/${worldId}.json`));
    const references = collectAssetReferences(data);
    for (const relativePath of references) {
      assert.ok(
        fs.existsSync(path.join(DIST, relativePath)),
        `${worldId} references missing dist/${relativePath}`,
      );
    }
  }
});

test('bundle sizes stay within the intended page budgets', () => {
  const worldBundle = fs.statSync(path.join(DIST, 'js', 'bundle.js')).size;
  const starMapBundle = fs.statSync(path.join(DIST, 'js', 'star-map-3d.js')).size;

  assert.ok(worldBundle <= 180 * 1024, `world bundle is ${(worldBundle / 1024).toFixed(1)} KiB`);
  assert.ok(starMapBundle <= 600 * 1024, `star map bundle is ${(starMapBundle / 1024).toFixed(1)} KiB`);
});
