const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
sharp.cache(false);

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(
  ROOT,
  'src',
  'assets',
  'images',
  'arknights',
  'terra-community-administrative-map.png',
);

test('production build refreshes the authored Terra globe assets', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['assets:terra'], 'node scripts/terra-globe-assets.js');
  assert.match(pkg.scripts.build, /npm run assets:terra/);
  assert.match(pkg.scripts.dev, /npm run assets:terra/);
});

test('community cartography builds one aligned globe asset set with an explicit provenance manifest', async (t) => {
  const { buildTerraGlobeAssets } = require('../scripts/terra-globe-assets.js');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terra-globe-'));
  t.after(async () => {
    await fs.promises.rm(outputDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
  });

  const result = await buildTerraGlobeAssets({
    sourcePath: SOURCE,
    outputDir,
    width: 512,
  });

  assert.deepEqual(Object.keys(result.files).sort(), [
    'albedo',
    'landMask',
    'manifest',
    'relief',
  ]);

  for (const key of ['albedo', 'landMask', 'relief']) {
    const filePath = path.join(outputDir, result.files[key]);
    assert.ok(fs.existsSync(filePath), `${key} output must exist`);
    const metadata = await sharp(filePath).metadata();
    assert.equal(metadata.width, 512, `${key} width`);
    assert.equal(metadata.height, 256, `${key} must use a 2:1 equirectangular canvas`);
  }

  const albedoStats = await sharp(path.join(outputDir, result.files.albedo)).stats();
  assert.ok(
    albedoStats.sharpness > 0.9,
    `albedo must preserve readable terrain structure (sharpness ${albedoStats.sharpness.toFixed(3)})`,
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, result.files.manifest), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.provenance.classification, 'community-cartography');
  assert.match(manifest.provenance.notice, /地形.*社区/u);
  assert.equal(manifest.projection.type, 'equirectangular-authored');
  assert.equal(manifest.projection.outputAspectRatio, '2:1');
  assert.equal(manifest.hexGrid.method, 'source-map-cells-baked-into-albedo');
  assert.match(manifest.hexGrid.claim, /源图/u);
  assert.ok(manifest.projection.longitudeSpanDegrees < 360);
  assert.ok(manifest.projection.latitudeNorthDegrees <= 90);
  assert.ok(manifest.projection.latitudeSouthDegrees >= -90);
  assert.ok(manifest.metrics.landCoverage > 0.08 && manifest.metrics.landCoverage < 0.72);
});
