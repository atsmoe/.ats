'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { sha256Json } = require('../scripts/lib/ff14-media-admission.js');
const { createMediaRecoveryManifest } = require('../scripts/lib/ff14-media-recovery.js');
const { loadFf14AdmittedData } = require('../scripts/lib/load-ff14-admitted-data.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function image(seed, format) {
  const width = 96;
  const height = 64;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 3) {
    const pixel = index / 3;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const noise = ((x * (seed * 89 + 13)) ^ (y * (seed * 47 + 19)) ^ (x * y * (seed + 5))) >>> 0;
    raw[index] = (noise + x * x + seed * 11) % 256;
    raw[index + 1] = ((noise >>> 2) + y * y + seed * 23) % 256;
    raw[index + 2] = ((noise >>> 6) + x * y + seed * 41) % 256;
  }
  const pipeline = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png' ? pipeline.png().toBuffer() : pipeline.webp().toBuffer();
}

function dataFixture() {
  return {
    world: { id: 'ff14' },
    subEntities: [{ timeline: { branches: [{
      id: 'mainline',
      eras: [{ id: 'era', events: [
        { id: 'ff14-001', title: '第一条记录', images: [{ src: 'legacy.jpg' }] },
        { id: 'ff14-002', title: '第二条记录', images: [{ src: 'untrusted.jpg' }] },
      ] }],
      endings: [],
      subBranches: [],
    }] } }],
  };
}

async function createFixture(t, configure = ({ data, manifest }) => ({ data, manifest })) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ff14-loader-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const assetRoot = path.join(workspaceRoot, 'src');
  const assetDirectory = path.join(assetRoot, 'assets', 'images', 'ff14');
  const evidenceRoot = path.join(workspaceRoot, 'scripts', 'data', 'ff14-media-thumbnails');
  fs.mkdirSync(assetDirectory, { recursive: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });

  const [matched, other] = await Promise.all([image(1, 'png'), image(9, 'webp')]);
  const digest = sha256(matched);
  const originalSha1 = crypto.createHash('sha1').update(matched).digest('hex');
  const evidencePath = `scripts/data/ff14-media-thumbnails/${digest}.png`;
  const source = {
    id: 'evidence-1',
    recordId: 'ff14-001',
    sourcePage: {
      pageId: 123,
      title: '历史',
      url: 'https://ff14.huijiwiki.com/wiki/历史',
      wikitextSha256: 'a'.repeat(64),
    },
    sourceFileTitle: '历史.txt',
    sectionPath: ['第一条记录'],
    sectionTrail: [{ title: '第一条记录', level: 2, position: 1 }],
    fileTitle: '第一张图.png',
    originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/example.png',
    originalSha1,
    originalWidth: 96,
    originalHeight: 64,
    caption: '原始图注',
    ordinal: 1,
    thumbnail: {
      width: 96,
      height: 64,
      sha256: digest,
      url: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/example.png',
      bytes: matched.length,
      mime: 'image/png',
      evidencePath,
    },
  };
  fs.writeFileSync(path.join(workspaceRoot, evidencePath), matched);
  fs.writeFileSync(path.join(assetDirectory, 'matched.png'), matched);
  fs.writeFileSync(path.join(assetDirectory, 'other.webp'), other);
  const publicOriginalDirectory = path.join(assetDirectory, 'public-originals');
  const publicOriginalName = `${originalSha1}.png`;
  fs.mkdirSync(publicOriginalDirectory, { recursive: true });
  fs.writeFileSync(path.join(publicOriginalDirectory, publicOriginalName), matched);
  source.publicOriginal = {
    path: `./assets/images/ff14/public-originals/${publicOriginalName}`,
    originalUrl: source.originalUrl,
    originalSha1,
    sha1: originalSha1,
    sha256: digest,
    width: 96,
    height: 64,
    bytes: matched.length,
    mime: 'image/png',
    requestedUrl: source.originalUrl,
    finalUrl: source.originalUrl,
    contentEncoding: 'identity',
    declaredLength: matched.length,
    downloadedAt: '2026-08-25T08:00:00.000Z',
  };
  const recovery = await createMediaRecoveryManifest({
    sourceImages: [{ ...source, buffer: matched }],
    localImages: [
      { path: './assets/images/ff14/matched.png', role: 'content', buffer: matched },
      { path: './assets/images/ff14/other.webp', role: 'content', buffer: other },
    ],
  });
  const data = dataFixture();
  const manifest = {
    ...recovery,
    generation: {
      sourceCatalogSha256: 'c'.repeat(64),
      wikiCaptureSha256: 'd'.repeat(64),
      imageInfoCaptureSha256: '1'.repeat(64),
      thumbnailIndexSha256: '2'.repeat(64),
      ff14DataSha256: sha256Json(data),
      generatedAt: '2026-08-24T08:00:00.000Z',
      thumbnailBytes: matched.length,
    },
  };
  const configured = configure({ data, manifest });
  const dataPath = path.join(workspaceRoot, 'ff14.json');
  const manifestPath = path.join(workspaceRoot, 'manifest.json');
  fs.writeFileSync(dataPath, JSON.stringify(configured.data));
  fs.writeFileSync(manifestPath, JSON.stringify(configured.manifest));
  return { workspaceRoot, assetRoot, evidenceRoot, dataPath, manifestPath, originalSha1 };
}

function loadFixture(paths, options = {}) {
  return loadFf14AdmittedData({ ...paths, ...options });
}

test('the async loader strips legacy images and exposes only byte-admitted media', async (t) => {
  const paths = await createFixture(t);
  const result = await loadFixture(paths);
  const events = result.data.subEntities[0].timeline.branches[0].eras[0].events;
  assert.deepEqual(events[0].images, [{
    src: `./assets/images/ff14/public-originals/${paths.originalSha1}.png`,
    alt: '原始图注',
    width: 96,
    height: 64,
    displayWidth: 64,
    displayHeight: 42,
    evidenceId: 'evidence-1',
  }]);
  assert.equal(events[1].images, undefined);
  assert.equal(result.summary.removedLegacyImages, 2);
});

test('global admission errors reject without exposing raw or partially sanitised data', async (t) => {
  const paths = await createFixture(t, ({ data, manifest }) => {
    manifest.generation.ff14DataSha256 = '9'.repeat(64);
    return { data, manifest };
  });
  await assert.rejects(
    loadFixture(paths),
    error => error.code === 'FF14_MEDIA_ADMISSION_FAILED'
      && error.details.some(message => /incomplete or stale/iu.test(message))
      && !Object.hasOwn(error, 'data')
      && !error.message.includes('legacy.jpg'),
  );
});

test('missing data or manifest files reject with an input error', async (t) => {
  for (const missing of ['dataPath', 'manifestPath']) {
    const paths = await createFixture(t);
    fs.unlinkSync(paths[missing]);
    await assert.rejects(
      loadFixture(paths),
      error => error.code === 'FF14_MEDIA_INPUT_UNAVAILABLE' && error.message.includes(paths[missing]),
      missing,
    );
  }
});

test('ordinary record rejection does not block the sanitised dataset', async (t) => {
  const paths = await createFixture(t, ({ data, manifest }) => {
    manifest.records[0].match.distance += 1;
    return { data, manifest };
  });
  const result = await loadFixture(paths);
  const events = result.data.subEntities[0].timeline.branches[0].eras[0].events;
  assert.equal(result.summary.admittedImages, 0);
  assert.equal(result.summary.rejectedRecords, 1);
  assert.ok(result.rejections[0].reasonCodes.includes('stored-match-mismatch'));
  assert.equal(events[0].images, undefined);
});

test('loader forwards a shared async inspector and repeated loads remain stable', async (t) => {
  const paths = await createFixture(t);
  const { defaultAssetInspector } = require('../scripts/lib/ff14-media-admission.js');
  let calls = 0;
  const inspector = async (...args) => {
    calls += 1;
    return defaultAssetInspector(...args);
  };
  const first = await loadFixture(paths, { inspector });
  const second = await loadFixture(paths, { inspector });
  assert.deepEqual(first, second);
  assert.equal(calls, 8, 'both loads inspect evidence, local candidates, and the verified public original');
});
