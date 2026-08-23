const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'scripts', 'data', 'terra-territory-regions.json');
const SOURCE = path.join(
  ROOT,
  'src',
  'assets',
  'images',
  'arknights',
  'terra-community-administrative-map.png',
);
const OUTPUT = path.join(
  ROOT,
  'src',
  'assets',
  'images',
  'star-map',
  'scenes',
  'terra-territory-projection.svg',
);
const EXPECTED_PUBLISHED_REGIONS = [
  'higashi',
  'kazimierz',
  'kjerag',
  'laterano',
  'minos',
  'sami',
  'ursus',
  'victoria',
  'yan',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function boundaryEdges(cells, grid) {
  const edges = new Map();
  for (const cellId of cells) {
    const compactMatch = /^r(-?\d+)c(-?\d+)$/.exec(cellId);
    const [row, column] = compactMatch
      ? compactMatch.slice(1).map(Number)
      : cellId.split(':').map(Number);
    assert.equal(Number.isInteger(row) && Number.isInteger(column), true, `invalid cell id ${cellId}`);
    const parity = ((row % 2) + 2) % 2;
    const centerX = (parity ? grid.oddRowOriginX : grid.evenRowOriginX)
      + column * grid.horizontalPeriod;
    const centerY = grid.originY + row * grid.rowStep;
    const vertices = [
      [centerX, centerY - grid.radius],
      [centerX + grid.horizontalPeriod / 2, centerY - grid.radius / 2],
      [centerX + grid.horizontalPeriod / 2, centerY + grid.radius / 2],
      [centerX, centerY + grid.radius],
      [centerX - grid.horizontalPeriod / 2, centerY + grid.radius / 2],
      [centerX - grid.horizontalPeriod / 2, centerY - grid.radius / 2],
    ];
    vertices.forEach((point, index) => {
      const next = vertices[(index + 1) % vertices.length];
      const left = `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
      const right = `${next[0].toFixed(3)},${next[1].toFixed(3)}`;
      const key = left < right ? `${left}|${right}` : `${right}|${left}`;
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, [point, next]);
    });
  }
  return edges;
}

test('curated Terra regions are pinned to the reviewed source image and exact hex lattice', () => {
  assert.equal(fs.existsSync(MANIFEST), true);
  const manifest = readJson(MANIFEST);
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex');

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.path, 'src/assets/images/arknights/terra-community-administrative-map.png');
  assert.equal(manifest.source.sha256, sourceHash);
  assert.deepEqual(manifest.source.size, [4081, 5488]);
  assert.deepEqual(manifest.grid, {
    horizontalPeriod: 50,
    radius: 86 / 3,
    rowStep: 43,
    evenRowOriginX: 24,
    oddRowOriginX: -1,
    originY: 29,
  });
});

test('every published territory is manually reviewed, non-overlapping and topologically closed', () => {
  const manifest = readJson(MANIFEST);
  const globallyOwnedCells = new Map();
  const publishedRegionIds = manifest.regions.map((region) => region.id).sort();

  assert.deepEqual(publishedRegionIds, EXPECTED_PUBLISHED_REGIONS);
  for (const region of manifest.regions) {
    assert.match(region.id, /^[a-z0-9-]+$/);
    assert.ok(region.labelZh);
    assert.match(region.color, /^#[0-9a-f]{6}$/i);
    assert.equal(region.review.status, 'manual-verified');
    assert.ok(region.selectedCellIds.length > 0);
    assert.equal(new Set(region.selectedCellIds).size, region.selectedCellIds.length);
    const computedBoundaryEdges = boundaryEdges(region.selectedCellIds, manifest.grid).size;
    assert.ok(computedBoundaryEdges >= 6);
    assert.equal(
      region.review.visibleBoundaryEdges + region.review.inferredOccludedEdges,
      computedBoundaryEdges,
      `${region.id} review edge counts must match its selected cells`,
    );

    for (const cellId of region.selectedCellIds) {
      assert.equal(globallyOwnedCells.has(cellId), false,
        `${cellId} belongs to both ${globallyOwnedCells.get(cellId)} and ${region.id}`);
      globallyOwnedCells.set(cellId, region.id);
    }
  }

  assert.ok(manifest.exclusions.some((entry) => entry.id === 'kazdel-activity-range'));
  assert.ok(manifest.exclusions.some((entry) => entry.id === 'aegir'));
  for (const blockedRegionId of manifest.blocked) {
    assert.equal(
      publishedRegionIds.includes(blockedRegionId),
      false,
      `${blockedRegionId} cannot be both published and blocked`,
    );
  }
});

test('the generated observation overlay is vector, region-tagged and explicitly non-geodetic', () => {
  assert.equal(fs.existsSync(OUTPUT), true);
  const manifest = readJson(MANIFEST);
  const svg = fs.readFileSync(OUTPUT, 'utf8');

  assert.match(svg, /<svg[^>]*viewBox="0 0 1672 941"/);
  assert.equal((svg.match(/data-region="/g) ?? []).length, manifest.regions.length);
  for (const region of manifest.regions) {
    assert.match(svg, new RegExp(`data-region="${region.id}"`));
  }
  assert.match(svg, /data-projection="visual-reprojection"/);
  assert.match(svg, /Official hex topology manually reviewed/);
  assert.doesNotMatch(svg, /filter=|<filter\b|GaussianBlur/);
});
