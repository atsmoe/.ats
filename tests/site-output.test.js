const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isReleaseVersion } = require('../scripts/check-release-notes.js');

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

test('only three-part versions are eligible for GitHub deployment', () => {
  assert.equal(isReleaseVersion('2.5.6'), true);
  assert.equal(isReleaseVersion('2.5.6.1'), false);
  assert.equal(isReleaseVersion('2.5.6.12'), false);
});

test('GitHub deployment checks the complete pushed commit range', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

  assert.match(
    workflow,
    /fetch-depth:\s*0/,
    'release-note verification needs full history when one push contains multiple commits',
  );
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
    arknights: 895,
    wh40k: 115,
    ff14: 433,
  };

  assert.ok(locations.length >= 1440, `event index unexpectedly shrank to ${locations.length} events`);
  assert.ok(index['ff14-s1-001'], 'FF14 first-shard cross-reference target must be indexed');
  assert.ok(index['ff14-s13-001'], 'FF14 thirteenth-shard cross-reference target must be indexed');

  for (const [worldId, minimum] of Object.entries(minimumEvents)) {
    const count = locations.filter(location => location.worldId === worldId).length;
    assert.ok(count >= minimum, `${worldId} event index unexpectedly shrank to ${count}`);
  }

  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    const data = JSON.parse(readDist(`data/${worldId}.json`));
    assert.equal(data.world.id, worldId);
    assert.ok(Array.isArray(data.branches) && data.branches.length > 0, `${worldId} needs branches`);
  }

  const arknights = JSON.parse(readDist('data/arknights.json'));
  const wh40k = JSON.parse(readDist('data/wh40k.json'));
  assert.ok(
    arknights.branches.find(branch => branch.id === 'if-other')?.endings?.length > 0,
    'Arknights top-level IF endings must survive the build',
  );
  assert.ok(
    wh40k.branches.find(branch => branch.id === 'if-heresy')?.endings?.length > 0,
    'WH40K top-level IF endings must survive the build',
  );
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

  const arknights = readDist('arknights.html');
  assert.match(arknights, /class="tl-cover-grid"/, 'Arknights needs the editorial cover layout');
  assert.match(arknights, /class="tl-cover-art/, 'Arknights needs original cover artwork');
  assert.match(arknights, /class="tl-cover-code"/, 'Arknights needs archive metadata');

  for (const page of ['wh40k.html', 'ff14.html']) {
    assert.doesNotMatch(readDist(page), /class="tl-cover-grid"/, `${page} keeps its existing cover`);
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
