'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {
  PRODUCTION_MATCH_OPTIONS,
  applyFf14MediaAdmission,
  defaultAssetInspector,
  deriveClearDisplayDimensions,
  isSafeEvidencePath,
  isSafePublicImagePath,
  readImageDimensions,
  sha256Json,
} = require('../scripts/lib/ff14-media-admission.js');
const {
  createMediaRecoveryManifest,
  evaluateMediaMatchEvidence,
} = require('../scripts/lib/ff14-media-recovery.js');

sharp.cache(false);

test('clear display limits keep original media within the initial modal envelope', () => {
  assert.deepEqual(
    deriveClearDisplayDimensions({ width: 2000, height: 886 }),
    { displayWidth: 640, displayHeight: 283 },
  );
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixtureData() {
  return {
    world: { id: 'ff14' },
    subEntities: [{
      timeline: {
        branches: [{
          id: 'mainline',
          eras: [{
            id: 'era-1',
            events: [
              { id: 'ff14-001', title: '第一条记录', images: [{ src: './assets/images/ff14/legacy.jpg' }] },
              { id: 'ff14-002', title: '第二条记录', images: [{ src: './assets/images/ff14/untrusted.jpg' }] },
            ],
          }],
          endings: [{ id: 'ff14-ending-1', title: '结局记录', images: [{ src: './assets/images/ff14/old.jpg' }] }],
          subBranches: [],
        }],
      },
    }],
  };
}

async function patternedImage(seed, format, width = 96, height = 64) {
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 3) {
    const pixel = index / 3;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const noise = ((x * (seed * 97 + 17)) ^ (y * (seed * 53 + 31)) ^ (x * y * (seed + 3))) >>> 0;
    raw[index] = (noise + x * x + seed * 17) % 256;
    raw[index + 1] = ((noise >>> 3) + y * y + seed * 29) % 256;
    raw[index + 2] = ((noise >>> 7) + x * y + seed * 43) % 256;
  }
  const pipeline = sharp(raw, { raw: { width, height, channels: 3 } });
  if (format === 'png') return pipeline.png().toBuffer();
  if (format === 'jpeg') return pipeline.jpeg({ quality: 92 }).toBuffer();
  if (format === 'webp') return pipeline.webp({ quality: 92 }).toBuffer();
  throw new Error(`unsupported fixture format ${format}`);
}

function mimeFor(format) {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function extensionFor(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

function completeSource({ digest, bytes, format, originalSha1, evidenceId = 'evidence-1', recordId = 'ff14-001', ordinal = 1 }) {
  return {
    id: evidenceId,
    recordId,
    sourcePage: {
      pageId: 123,
      title: '历史',
      url: 'https://ff14.huijiwiki.com/wiki/历史',
      wikitextSha256: 'a'.repeat(64),
    },
    sourceFileTitle: '历史.txt',
    sectionPath: ['第一条记录'],
    sectionTrail: [{ title: '第一条记录', level: 2, position: 1 }],
    fileTitle: `${evidenceId}.${extensionFor(format)}`,
    originalUrl: `https://huiji-public.huijistatic.com/ff14/uploads/${evidenceId}.${extensionFor(format)}`,
    originalSha1,
    originalWidth: 96,
    originalHeight: 64,
    caption: '原始图注',
    ordinal,
    thumbnail: {
      width: 96,
      height: 64,
      sha256: digest,
      url: `https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/${evidenceId}.${extensionFor(format)}`,
      bytes: bytes.length,
      mime: mimeFor(format),
      evidencePath: `scripts/data/ff14-media-thumbnails/${digest}.${extensionFor(format)}`,
    },
  };
}

async function createFixture(t, { sourceFormat = 'png' } = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ff14-admission-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const assetRoot = path.join(workspaceRoot, 'src');
  const assetDirectory = path.join(assetRoot, 'assets', 'images', 'ff14');
  const evidenceRoot = path.join(workspaceRoot, 'scripts', 'data', 'ff14-media-thumbnails');
  fs.mkdirSync(assetDirectory, { recursive: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });

  const sourceBytes = await patternedImage(1, sourceFormat);
  const otherJpeg = await patternedImage(7, 'jpeg');
  const otherWebp = await patternedImage(13, 'webp');
  const digest = sha256(sourceBytes);
  const source = completeSource({
    digest,
    bytes: sourceBytes,
    format: sourceFormat,
    originalSha1: crypto.createHash('sha1').update(sourceBytes).digest('hex'),
  });
  fs.writeFileSync(path.join(evidenceRoot, path.basename(source.thumbnail.evidencePath)), sourceBytes);

  const localImages = [
    { path: `./assets/images/ff14/matched.${extensionFor(sourceFormat)}`, role: 'content', buffer: sourceBytes },
    { path: './assets/images/ff14/distractor.jpg', role: 'content', buffer: otherJpeg },
    // Production contains a few legacy names whose extension does not describe
    // the bytes. Admission binds the decoded format recorded by the manifest,
    // not the filename suffix.
    { path: './assets/images/ff14/another.png', role: 'content', buffer: otherWebp },
  ];
  for (const image of localImages) {
    fs.writeFileSync(path.join(assetDirectory, path.basename(image.path)), image.buffer);
  }
  const originalDirectory = path.join(assetDirectory, 'public-originals');
  fs.mkdirSync(originalDirectory, { recursive: true });
  const originalName = `${source.originalSha1}.${extensionFor(sourceFormat)}`;
  fs.writeFileSync(path.join(originalDirectory, originalName), sourceBytes);
  source.publicOriginal = {
    path: `./assets/images/ff14/public-originals/${originalName}`,
    originalUrl: source.originalUrl,
    originalSha1: source.originalSha1,
    sha1: source.originalSha1,
    sha256: digest,
    width: 96,
    height: 64,
    bytes: sourceBytes.length,
    mime: mimeFor(sourceFormat),
    downloadedAt: '2026-08-25T00:00:00.000Z',
  };
  const recovery = await createMediaRecoveryManifest({
    sourceImages: [{ ...source, buffer: sourceBytes }],
    localImages,
  });
  const data = fixtureData();
  const manifest = {
    ...recovery,
    generation: {
      sourceCatalogSha256: 'c'.repeat(64),
      wikiCaptureSha256: 'd'.repeat(64),
      imageInfoCaptureSha256: '1'.repeat(64),
      thumbnailIndexSha256: '2'.repeat(64),
      ff14DataSha256: sha256Json(data),
      generatedAt: '2026-08-24T08:00:00.000Z',
      thumbnailBytes: sourceBytes.length,
    },
  };
  return {
    workspaceRoot,
    assetRoot,
    evidenceRoot,
    assetDirectory,
    sourceBytes,
    data,
    manifest,
    options: { workspaceRoot, assetRoot, evidenceRoot },
  };
}

function rebuildStoredMatch(record, candidates) {
  record.match = evaluateMediaMatchEvidence({
    sourceDHash: record.sourceDHash,
    sourceMeanRgb: record.sourceMeanRgb,
    sourceWidth: record.source.thumbnail.width,
    sourceHeight: record.source.thumbnail.height,
    candidates,
  }, PRODUCTION_MATCH_OPTIONS);
}

test('only byte-verified high-confidence evidence is exposed and every legacy image is removed', async (t) => {
  const fixture = await createFixture(t);
  const rejected = structuredClone(fixture.manifest.records[0]);
  rejected.source.id = 'evidence-2';
  rejected.source.recordId = 'ff14-002';
  rejected.source.ordinal = 2;
  rejected.match.distance += 1;
  fixture.manifest.records.push(rejected);

  const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
  const events = result.data.subEntities[0].timeline.branches[0].eras[0].events;
  assert.deepEqual(events[0].images, [{
    src: fixture.manifest.records[0].source.publicOriginal.path,
      alt: '原始图注',
      width: 96,
      height: 64,
      displayWidth: 64,
      displayHeight: 42,
      evidenceId: 'evidence-1',
  }]);
  assert.equal(events[1].images, undefined);
  assert.equal(result.summary.removedLegacyImages, 3);
  assert.equal(result.summary.admittedImages, 1);
  assert.equal(result.summary.rejectedRecords, 1);
  assert.deepEqual(result.errors, []);
  assert.ok(result.rejections[0].reasonCodes.includes('stored-match-mismatch'));
});

test('a mutually forged candidate and source fingerprint is rejected after recomputing both from bytes', async (t) => {
  const fixture = await createFixture(t);
  const record = fixture.manifest.records[0];
  const candidate = fixture.manifest.candidatePool.contentImages[0];
  candidate.dHash = '0'.repeat(16);
  candidate.meanRgb = { r: 1, g: 2, b: 3 };
  record.sourceDHash = candidate.dHash;
  record.sourceMeanRgb = { ...candidate.meanRgb };
  rebuildStoredMatch(record, fixture.manifest.candidatePool.contentImages);

  const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
  assert.equal(result.summary.admittedImages, 0);
  assert.ok(result.errors.some(message => /candidatePool.*fingerprint/iu.test(message)));
  assert.ok(result.errors.some(message => /source\.thumbnail.*fingerprint/iu.test(message)));
});

test('candidate bytes are bound to SHA, dimensions, decoded format, dHash and mean RGB', async (t) => {
  const mutations = [
    ['SHA-256', candidate => { candidate.fileSha256 = '9'.repeat(64); }],
    ['dimensions', candidate => { candidate.width += 1; }],
    ['format', candidate => { candidate.format = candidate.format === 'png' ? 'jpeg' : 'png'; }],
    ['fingerprint', candidate => { candidate.dHash = candidate.dHash === '0'.repeat(16) ? 'f'.repeat(16) : '0'.repeat(16); }],
    ['fingerprint', candidate => { candidate.meanRgb.r = (candidate.meanRgb.r + 1) % 256; }],
  ];
  for (const [expected, mutate] of mutations) {
    const fixture = await createFixture(t);
    mutate(fixture.manifest.candidatePool.contentImages[0]);
    const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
    assert.equal(result.summary.admittedImages, 0, expected);
    assert.ok(result.errors.some(message => message.includes(expected)), expected);
  }
});

test('source evidence failures are global for path, missing file, hash, byte count, dimensions, MIME and fingerprint', async (t) => {
  const cases = [
    ['non-content-addressed evidence path', fixture => { fixture.manifest.records[0].source.thumbnail.evidencePath = '../escape.png'; }],
    ['local file is missing', fixture => { fs.unlinkSync(path.join(fixture.evidenceRoot, path.basename(fixture.manifest.records[0].source.thumbnail.evidencePath))); }],
    ['SHA-256', fixture => {
      const thumbnail = fixture.manifest.records[0].source.thumbnail;
      thumbnail.sha256 = '9'.repeat(64);
      thumbnail.evidencePath = `scripts/data/ff14-media-thumbnails/${thumbnail.sha256}.png`;
      fs.copyFileSync(
        path.join(fixture.evidenceRoot, `${sha256(fixture.sourceBytes)}.png`),
        path.join(fixture.evidenceRoot, path.basename(thumbnail.evidencePath)),
      );
    }],
    ['byte count', fixture => { fixture.manifest.records[0].source.thumbnail.bytes += 1; }],
    ['dimensions', fixture => { fixture.manifest.records[0].source.thumbnail.width += 1; }],
    ['MIME', fixture => {
      const thumbnail = fixture.manifest.records[0].source.thumbnail;
      thumbnail.mime = 'image/jpeg';
      thumbnail.evidencePath = `scripts/data/ff14-media-thumbnails/${thumbnail.sha256}.jpg`;
      fs.copyFileSync(
        path.join(fixture.evidenceRoot, `${thumbnail.sha256}.png`),
        path.join(fixture.evidenceRoot, `${thumbnail.sha256}.jpg`),
      );
    }],
    ['fingerprint', fixture => { fixture.manifest.records[0].sourceDHash = 'f'.repeat(16); }],
  ];
  for (const [expected, mutate] of cases) {
    const fixture = await createFixture(t);
    mutate(fixture);
    const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
    assert.equal(result.summary.admittedImages, 0, expected);
    assert.ok(result.errors.some(message => message.includes(expected)), expected);
  }
});

test('evidence root is fixed inside the workspace and symlinked files fail closed', async (t) => {
  const outsideRoot = await createFixture(t);
  const moved = path.join(outsideRoot.workspaceRoot, 'other-evidence');
  fs.mkdirSync(moved);
  const outside = await applyFf14MediaAdmission(outsideRoot.data, outsideRoot.manifest, {
    ...outsideRoot.options,
    evidenceRoot: moved,
  });
  assert.ok(outside.errors.some(message => /evidence root/iu.test(message)));

  const fixture = await createFixture(t);
  const evidenceFile = path.join(fixture.evidenceRoot, path.basename(fixture.manifest.records[0].source.thumbnail.evidencePath));
  const target = path.join(fixture.workspaceRoot, 'thumbnail-target.png');
  fs.renameSync(evidenceFile, target);
  try {
    fs.symlinkSync(target, evidenceFile, 'file');
  } catch (error) {
    t.diagnostic(`symlink creation unavailable: ${error.code}`);
    return;
  }
  const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
  assert.equal(result.summary.admittedImages, 0);
  assert.ok(result.errors.some(message => /symbolic link/iu.test(message)));
});

test('an inspector-reported symbolic link fails globally even when the platform cannot create one', async (t) => {
  const fixture = await createFixture(t);
  const evidenceInspector = async (...args) => ({
    ...await defaultAssetInspector(...args),
    isSymbolicLink: true,
  });
  const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, {
    ...fixture.options,
    evidenceInspector,
  });
  assert.equal(result.summary.admittedImages, 0);
  assert.ok(result.errors.some(message => /symbolic link/iu.test(message)));
});

test('production policy, generation hash, duplicate IDs and unknown records fail closed', async (t) => {
  const policy = await createFixture(t);
  policy.manifest.matching.maxDistance = 64;
  assert.ok((await applyFf14MediaAdmission(policy.data, policy.manifest, policy.options)).errors.some(message => /fixed production/iu.test(message)));

  const stale = await createFixture(t);
  stale.manifest.generation.ff14DataSha256 = '9'.repeat(64);
  assert.ok((await applyFf14MediaAdmission(stale.data, stale.manifest, stale.options)).errors.some(message => /stale/iu.test(message)));

  const duplicate = await createFixture(t);
  duplicate.manifest.records.push(structuredClone(duplicate.manifest.records[0]));
  assert.ok((await applyFf14MediaAdmission(duplicate.data, duplicate.manifest, duplicate.options)).errors.some(message => /Duplicate evidence id/iu.test(message)));

  const unknown = await createFixture(t);
  unknown.manifest.records[0].source.recordId = 'ff14-999';
  const result = await applyFf14MediaAdmission(unknown.data, unknown.manifest, unknown.options);
  assert.equal(result.errors.length, 0);
  assert.ok(result.rejections[0].reasonCodes.includes('unknown-or-duplicate-record-id'));
});

test('source provenance requires scoped upload URLs and safe ordered heading evidence', async (t) => {
  const mutations = [
    source => { source.originalUrl = 'https://huiji-public.huijistatic.com/ff14/other/example.png'; },
    source => { source.thumbnail.url = 'https://huiji-thumb.huijistatic.com/ff14/uploads/example.png'; },
    source => { source.sourcePage.pageId = Number.MAX_SAFE_INTEGER + 1; },
    source => { source.ordinal = 0; },
    source => { source.sectionTrail[0].title = '另一标题'; },
    source => { source.sectionTrail[0].level = 0; },
    source => { source.sectionTrail[0].position = 0; },
    source => {
      source.sectionPath = ['第一条记录', '子标题'];
      source.sectionTrail = [
        { title: '第一条记录', level: 2, position: 2 },
        { title: '子标题', level: 3, position: 1 },
      ];
    },
  ];
  for (const mutate of mutations) {
    const fixture = await createFixture(t);
    mutate(fixture.manifest.records[0].source);
    const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
    assert.equal(result.errors.length, 0);
    assert.equal(result.summary.admittedImages, 0);
    assert.ok(result.rejections[0].reasonCodes.includes('incomplete-source-provenance'));
  }
});

test('stored matching claims are still compared against the byte-recomputed result', async (t) => {
  const fixture = await createFixture(t);
  fixture.manifest.records[0].match.distance += 1;
  const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.admittedImages, 0);
  assert.ok(result.rejections[0].reasonCodes.includes('stored-match-mismatch'));
});

test('a visually matched preview is never promoted when it lacks a source-original asset', async (t) => {
  const fixture = await createFixture(t);
  delete fixture.manifest.records[0].source.publicOriginal;
  fixture.manifest.records[0].source.originalWidth = 960;
  fixture.manifest.records[0].source.originalHeight = 640;
  const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
  assert.equal(result.summary.admittedImages, 0);
  assert.ok(result.rejections[0].reasonCodes.includes('local-preview-not-original-sized'));
  assert.ok(result.rejections[0].reasonCodes.includes('original-asset-missing'));
});

test('a public original must match its declared SHA-1 and original dimensions', async (t) => {
  for (const mutate of [
    source => { source.publicOriginal.sha1 = 'f'.repeat(40); },
    source => { source.publicOriginal.width = 95; },
  ]) {
    const fixture = await createFixture(t);
    mutate(fixture.manifest.records[0].source);
    const result = await applyFf14MediaAdmission(fixture.data, fixture.manifest, fixture.options);
    assert.equal(result.summary.admittedImages, 0);
    assert.ok(result.rejections[0].reasonCodes.some(code => code.startsWith('original-asset-')));
  }
});

test('public and evidence paths remain inside their fixed namespaces', () => {
  const digest = 'a'.repeat(64);
  assert.equal(isSafePublicImagePath('./assets/images/ff14/a.webp'), true);
  assert.equal(isSafePublicImagePath('./assets/images/ff14/sub/a.png'), true);
  assert.equal(isSafePublicImagePath('./assets/images/wh40k/a.webp'), false);
  assert.equal(isSafePublicImagePath('./assets/images/ff14/../wh40k/a.webp'), false);
  assert.equal(isSafePublicImagePath('./assets/images/ff14/%2e%2e/a.webp'), false);
  assert.equal(isSafePublicImagePath('./assets/images/ff14/a.webp?x=1'), false);
  assert.equal(isSafeEvidencePath(`scripts/data/ff14-media-thumbnails/${digest}.png`, digest, 'image/png'), true);
  assert.equal(isSafeEvidencePath(`scripts/data/ff14-media-thumbnails/${digest}.jpg`, digest, 'image/png'), false);
  assert.equal(isSafeEvidencePath(`scripts/data/ff14-media-thumbnails/../${digest}.png`, digest, 'image/png'), false);
  assert.equal(isSafeEvidencePath(`tmp/${digest}.png`, digest, 'image/png'), false);
});

test('default inspection exposes real PNG, JPEG and WebP bytes and decoded metadata', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff14-inspector-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const format of ['png', 'jpeg', 'webp']) {
    const bytes = await patternedImage(5, format, 32, 18);
    const filePath = path.join(root, `fixture.${extensionFor(format)}`);
    fs.writeFileSync(filePath, bytes);
    const inspected = await defaultAssetInspector(filePath, null, { rootPath: root });
    assert.equal(inspected.exists, true);
    assert.equal(inspected.isFile, true);
    assert.equal(inspected.isSymbolicLink, false);
    assert.deepEqual(inspected.buffer, bytes);
    assert.equal(inspected.sha256, sha256(bytes));
    assert.deepEqual(readImageDimensions(bytes), { format, width: 32, height: 18 });
  }
});
