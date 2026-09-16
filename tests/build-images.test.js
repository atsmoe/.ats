const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { buildImages } = require('../build');
const { refreshFingerprints } = require('../scripts/refresh-ff14-media-fingerprints');

test('fingerprint refresh verifies source bytes and preserves every published event/image pair', async () => {
  const manifestPath = path.resolve(__dirname, '../scripts/data/ff14-media-manifest.json');
  const before = fs.readFileSync(manifestPath);
  const result = await refreshFingerprints();
  assert.equal(result.verifiedCandidateFiles, 160);
  assert.equal(result.verifiedSourceRecords, 130);
  assert.equal(result.admittedImages, 16);
  assert.equal(result.affectedEvents, 15);
  assert.equal(result.written, false);
  assert.deepEqual(fs.readFileSync(manifestPath), before);
});

test('image build generates WebP sizes while preserving admitted originals and source files', async t => {
  const testOutput = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(testOutput, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(testOutput, 'ats-image-build-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporaryRoot)), testOutput);
    assert.ok(path.basename(temporaryRoot).startsWith('ats-image-build-'));
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
  });
  const distDir = path.join(temporaryRoot, 'dist');
  const sourceDir = path.join(temporaryRoot, 'source');
  const dataDir = path.join(distDir, 'data');
  const outputDir = path.join(distDir, 'assets', 'images');
  const admittedPath = 'ff14/public-originals/retained.png';
  for (const folder of [dataDir, sourceDir, path.join(outputDir, 'ff14/public-originals')]) fs.mkdirSync(folder, { recursive: true });
  const bytes = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#4578a0' } }).png().toBuffer();
  fs.writeFileSync(path.join(sourceDir, 'sample.png'), bytes);
  fs.writeFileSync(path.join(outputDir, 'sample.png'), bytes);
  fs.writeFileSync(path.join(outputDir, admittedPath), bytes);
  const records = [
    { id: 'sample', title: '示例', dateDisplay: '日期未载', src: './assets/images/sample.png' },
    { id: 'original', src: `./assets/images/${admittedPath}` },
  ];
  fs.writeFileSync(path.join(dataDir, 'world.json'), JSON.stringify(records));
  await buildImages({ distDir, sourceDir });
  // The ESM sharp entry loaded by Eleventy Image initializes the shared native
  // cache. Disable it after that import so Windows releases fixture file handles.
  sharp.cache(false);
  for (const width of [320, 640, 960]) {
    const metadata = await sharp(path.join(outputDir, `sample-${width}w.webp`)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, width / 2);
  }
  const output = JSON.parse(fs.readFileSync(path.join(dataDir, 'world.json'), 'utf8'));
  assert.deepEqual(output, [{ ...records[0], src: './assets/images/./sample-960w.webp' }, records[1]]);
  assert.deepEqual(fs.readFileSync(path.join(sourceDir, 'sample.png')), bytes);
  assert.deepEqual(fs.readFileSync(path.join(outputDir, admittedPath)), bytes);
  assert.equal(fs.existsSync(path.join(outputDir, 'sample.png')), false);
});
