const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
sharp.cache(false);

const {
  createDHash,
  hammingDistance,
  createMediaRecoveryManifest,
} = require('../scripts/lib/ff14-media-recovery.js');

function fixturePixels(seed, width = 90, height = 80) {
  const pixels = Buffer.alloc(width * height * 3);
  const firstX = 16 + (seed * 7) % 58;
  const firstY = 14 + (seed * 11) % 48;
  const secondX = 14 + (seed * 13) % 62;
  const secondY = 12 + (seed * 5) % 54;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let shade = 36 + Math.round(x * 0.82) + Math.round(y * 0.23);
      const firstDistance = (x - firstX) ** 2 + (y - firstY) ** 2;
      const secondDistance = (x - secondX) ** 2 + (y - secondY) ** 2;
      if (firstDistance < 16 ** 2) shade += 118 - Math.round(Math.sqrt(firstDistance) * 4);
      if (secondDistance < 11 ** 2) shade -= 72 - Math.round(Math.sqrt(secondDistance) * 3);
      if ((x * ((seed % 5) + 2) + y * ((seed % 7) + 3) + seed) % 47 < 5) shade += 26;
      shade = Math.max(0, Math.min(255, shade));
      const offset = (y * width + x) * 3;
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
    }
  }
  return { pixels, width, height };
}

async function fixtureImage(seed, format = 'png') {
  const { pixels, width, height } = fixturePixels(seed);
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  if (format === 'webp') return image.webp({ quality: 78 }).toBuffer();
  if (format === 'jpeg') return image.jpeg({ quality: 76 }).toBuffer();
  return image.png().toBuffer();
}

async function equalLuminanceColourImage(tint, width = 90, height = 80) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = Math.floor(x / 10) * 3 + Math.floor(y / 10) * 5;
      const luminance = cell % 7 < 3 ? 48 : 12;
      const offset = (y * width + x) * 3;
      if (tint === 'red') {
        pixels[offset] = Math.round(luminance / 0.2126);
      } else {
        pixels[offset + 1] = luminance;
        pixels[offset + 2] = Math.round(luminance * 3.9446);
      }
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test('dHash is stable across normal re-encoding and hamming distance is symmetric', async () => {
  const original = await fixtureImage(101, 'png');
  const reencoded = await fixtureImage(101, 'webp');
  const other = await fixtureImage(202, 'jpeg');
  const originalHash = await createDHash(original);
  const reencodedHash = await createDHash(reencoded);
  const otherHash = await createDHash(other);

  assert.equal(originalHash.bitLength, 64);
  assert.equal(originalHash.hex.length, 16);
  assert.ok(
    hammingDistance(originalHash, reencodedHash) <= 2,
    'normal thumbnail re-encoding should retain a near-identical dHash',
  );
  assert.equal(
    hammingDistance(originalHash, otherHash),
    hammingDistance(otherHash, originalHash),
  );
  assert.ok(hammingDistance(originalHash, otherHash) > 2);
});

test('the single fingerprint implementation reports decoded PNG, JPEG and WebP formats', async () => {
  const raw = Buffer.alloc(40 * 24 * 3, 91);
  for (const format of ['png', 'jpeg', 'webp']) {
    const pipeline = sharp(raw, { raw: { width: 40, height: 24, channels: 3 } });
    const bytes = await (format === 'png'
      ? pipeline.png()
      : format === 'jpeg'
        ? pipeline.jpeg()
        : pipeline.webp()).toBuffer();
    const fingerprint = await createDHash(bytes);
    assert.equal(fingerprint.format, format);
    assert.deepEqual([fingerprint.imageWidth, fingerprint.imageHeight], [40, 24]);
  }
});

test('manifest keeps source provenance and accepts only a unique, separated nearest visual match', async () => {
  const [sourceA, sourceB, localA, localB, localC] = await Promise.all([
    fixtureImage(101, 'jpeg'),
    fixtureImage(202, 'png'),
    fixtureImage(101, 'webp'),
    fixtureImage(202, 'webp'),
    fixtureImage(303, 'png'),
  ]);

  const manifest = await createMediaRecoveryManifest({
    sourceImages: [
      {
        id: 'source-a',
        section: '第一章',
        title: '第一张图',
        url: 'https://example.test/a',
        recordId: 'ff14-001',
        sourcePage: '第七星历',
        sourceFileTitle: '第一章.txt',
        caption: '原始图片说明',
        originalUrl: 'https://example.test/original-a',
        ordinal: 1,
        width: 640,
        height: 360,
        role: 'content',
        format: 'jpeg',
        metadata: { nested: 'safe', imageBuffer: sourceA },
        buffer: sourceA,
      },
      { id: 'source-b', section: '第二章', title: '第二张图', url: 'https://example.test/b', buffer: sourceB },
    ],
    localImages: [
      { path: 'z/local-b.webp', buffer: localB },
      {
        path: 'a/local-a.webp',
        recordId: 'ff14-001',
        sourceFileTitle: '第一章.txt',
        caption: '本地缓存',
        ordinal: 1,
        width: 640,
        height: 360,
        role: 'content',
        format: 'webp',
        buffer: localA,
      },
      { path: 'm/local-c.png', buffer: localC },
    ],
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.algorithm.bitLength, 64);
  assert.equal(manifest.records.length, 2);
  assert.deepEqual(manifest.records[0].source, {
    id: 'source-a',
    section: '第一章',
    title: '第一张图',
    url: 'https://example.test/a',
    recordId: 'ff14-001',
    sourcePage: '第七星历',
    sourceFileTitle: '第一章.txt',
    caption: '原始图片说明',
    originalUrl: 'https://example.test/original-a',
    ordinal: 1,
    width: 640,
    height: 360,
    role: 'content',
    format: 'jpeg',
    metadata: { nested: 'safe' },
  });
  assert.equal(manifest.records[0].match.path, 'a/local-a.webp');
  assert.equal(manifest.records[1].match.path, 'z/local-b.webp');
  assert.equal(manifest.records[0].match.nearest.recordId, 'ff14-001');
  assert.equal(manifest.records[0].match.nearest.caption, '本地缓存');

  for (const record of manifest.records) {
    assert.equal(record.match.accepted, true);
    assert.equal(record.match.uniqueNearest, true);
    assert.equal(record.match.confidence.level, 'high');
    assert.ok(record.match.distanceMargin >= 4);
    assert.ok(record.match.secondDistance > record.match.distance);
  }

  // Buffers must remain evidence inputs, never get serialized into the manifest.
  assert.doesNotMatch(JSON.stringify(manifest), /buffer/iu);
});

test('tied hashes remain visible as evidence but are never auto-accepted', async () => {
  const source = await fixtureImage(404, 'png');
  const duplicate = await fixtureImage(404, 'webp');
  const manifest = await createMediaRecoveryManifest({
    sourceImages: [{ section: '并列样本', title: '同一张图', url: 'https://example.test/tie', buffer: source }],
    localImages: [
      { path: 'z/duplicate-b.webp', buffer: duplicate },
      { path: 'a/duplicate-a.webp', buffer: duplicate },
    ],
  });

  const match = manifest.records[0].match;
  assert.equal(match.path, null);
  assert.equal(match.nearest.path, 'a/duplicate-a.webp');
  assert.equal(match.secondNearest.path, 'z/duplicate-b.webp');
  assert.equal(match.distance, match.secondDistance);
  assert.equal(match.distanceMargin, 0);
  assert.equal(match.uniqueNearest, false);
  assert.equal(match.accepted, false);
  assert.equal(match.confidence.level, 'ambiguous');
});

test('a high-looking single candidate is never accepted without a global second candidate', async () => {
  const source = await fixtureImage(505, 'png');
  const manifest = await createMediaRecoveryManifest({
    sourceImages: [{ section: '单一候选', title: '源图', url: 'https://example.test/single', buffer: source }],
    localImages: [{ path: 'only/exact.png', buffer: source }],
  });

  const match = manifest.records[0].match;
  assert.equal(match.distance, 0);
  assert.equal(match.hasGlobalSecondCandidate, false);
  assert.equal(match.path, null);
  assert.equal(match.accepted, false);
  assert.equal(match.confidence.level, 'low');
  assert.ok(match.confidence.score < 70);
});

test('same-greyscale but visibly different colours fail the colour guard', async () => {
  const [red, cyan, unrelated] = await Promise.all([
    equalLuminanceColourImage('red'),
    equalLuminanceColourImage('cyan'),
    fixtureImage(606, 'png'),
  ]);
  const [redHash, cyanHash] = await Promise.all([createDHash(red), createDHash(cyan)]);
  assert.equal(hammingDistance(redHash, cyanHash), 0);

  const manifest = await createMediaRecoveryManifest({
    sourceImages: [{ section: '颜色守卫', title: '红色源图', url: 'https://example.test/red', buffer: red }],
    localImages: [
      { path: 'content/cyan.png', buffer: cyan },
      { path: 'content/unrelated.png', buffer: unrelated },
    ],
  });

  const match = manifest.records[0].match;
  assert.equal(match.nearest.path, 'content/cyan.png');
  assert.equal(match.distance, 0);
  assert.equal(match.withinColorThreshold, false);
  assert.ok(match.nearest.colorDistance > manifest.matching.maxColorDistance);
  assert.equal(match.path, null);
  assert.equal(match.accepted, false);
  assert.equal(match.confidence.level, 'unmatched');
});

test('a visually identical but geometrically distorted candidate fails the aspect-ratio guard', async () => {
  const source = await fixtureImage(606, 'png');
  const distorted = await sharp(source).resize(180, 80, { fit: 'fill' }).png().toBuffer();
  const distractor = await fixtureImage(707, 'png');
  const manifest = await createMediaRecoveryManifest({
    sourceImages: [{ id: 'geometry-source', fileTitle: 'geometry.png', buffer: source }],
    localImages: [
      { path: 'content/distorted.png', buffer: distorted },
      { path: 'content/distractor.png', buffer: distractor },
    ],
  });

  const match = manifest.records[0].match;
  assert.equal(match.nearest.path, 'content/distorted.png');
  assert.ok(match.distance <= 1);
  assert.equal(match.hasAspectRatioEvidence, true);
  assert.equal(match.withinAspectRatioThreshold, false);
  assert.equal(match.accepted, false);
  assert.equal(match.path, null);
  assert.ok(match.confidence.reasonCodes.includes('outside-aspect-ratio-threshold'));
});

test('icon candidates are retained for audit but excluded from automatic content matching', async () => {
  const [source, contentA, contentB] = await Promise.all([
    fixtureImage(707, 'png'),
    fixtureImage(808, 'png'),
    fixtureImage(909, 'png'),
  ]);
  const manifest = await createMediaRecoveryManifest({
    sourceImages: [{ section: '图标过滤', title: '正文来源图', url: 'https://example.test/icon', buffer: source }],
    localImages: [
      { path: 'ui/perfect-icon.png', role: 'icon', format: 'png', buffer: source },
      { path: 'content/a.png', buffer: contentA },
      { path: 'content/b.png', role: 'content', buffer: contentB },
    ],
  }, {
    match: { maxDistance: 0, minDistanceMargin: 0 },
  });

  assert.equal(manifest.candidatePool.eligibleContentImages, 2);
  assert.deepEqual(manifest.candidatePool.excludedLocalImages, [
    { path: 'ui/perfect-icon.png', role: 'icon', format: 'png' },
  ]);
  assert.notEqual(manifest.records[0].match.nearest.path, 'ui/perfect-icon.png');
  assert.equal(manifest.records[0].match.path, null);
});

test('a shared local path is rejected when accepted source records disagree on Wiki media file title', async () => {
  const [shared, distractor] = await Promise.all([
    fixtureImage(1010, 'png'),
    fixtureImage(1111, 'png'),
  ]);
  const manifest = await createMediaRecoveryManifest({
    sourceImages: [
      {
        id: 'first',
        section: '来源一',
        title: '第一条',
        sourceFileTitle: '同一来源页.txt',
        fileTitle: '来源图一.png',
        sourcePage: '资料页 A',
        buffer: shared,
      },
      {
        id: 'second',
        section: '来源二',
        title: '第二条',
        sourceFileTitle: '同一来源页.txt',
        fileTitle: '来源图二.png',
        sourcePage: '资料页 B',
        buffer: shared,
      },
    ],
    localImages: [
      { path: 'content/shared.png', buffer: shared },
      { path: 'content/distractor.png', buffer: distractor },
    ],
  });

  for (const record of manifest.records) {
    assert.equal(record.match.path, null);
    assert.equal(record.match.accepted, false);
    assert.equal(record.match.confidence.level, 'ambiguous');
    assert.equal(record.match.collision.type, 'source-file-title-collision');
    assert.equal(record.match.collision.localPath, 'content/shared.png');
    assert.deepEqual(record.match.collision.sourceFileTitles, ['来源图一.png', '来源图二.png']);
  }
});

test('a shared local path remains available when every source record names the same Wiki media file title', async () => {
  const [shared, distractor] = await Promise.all([
    fixtureImage(1212, 'png'),
    fixtureImage(1313, 'png'),
  ]);
  const manifest = await createMediaRecoveryManifest({
    sourceImages: [
      { id: 'first', sourceFileTitle: '来源页一.txt', fileTitle: '同一张图.png', buffer: shared },
      { id: 'second', sourceFileTitle: '来源页二.txt', fileTitle: '同一张图.png', buffer: shared },
    ],
    localImages: [
      { path: 'content/shared.png', buffer: shared },
      { path: 'content/distractor.png', buffer: distractor },
    ],
  });

  for (const record of manifest.records) {
    assert.equal(record.match.path, 'content/shared.png');
    assert.equal(record.match.accepted, true);
    assert.equal(record.match.collision, undefined);
  }
});

test('a caller can tighten the distance threshold and retain a rejected nearest candidate for audit', async () => {
  const [source, unrelated] = await Promise.all([
    fixtureImage(101, 'png'),
    fixtureImage(202, 'png'),
  ]);
  const manifest = await createMediaRecoveryManifest({
    sourceImages: [{ section: '阈值样本', title: '源图', url: 'https://example.test/threshold', buffer: source }],
    localImages: [{ path: 'candidate/unrelated.png', buffer: unrelated }],
  }, {
    match: { maxDistance: 0, minDistanceMargin: 0 },
  });

  const match = manifest.records[0].match;
  assert.ok(match.distance > 0);
  assert.equal(match.path, null);
  assert.equal(match.withinDistanceThreshold, false);
  assert.equal(match.accepted, false);
  assert.equal(match.confidence.level, 'unmatched');
});

test('manifest requires bytes for each image and rejects incompatible hash lengths', async () => {
  await assert.rejects(
    createMediaRecoveryManifest({
      sourceImages: [{ section: '缺失', title: '没有缓存缩略图', url: 'https://example.test/missing' }],
      localImages: [],
    }),
    /must include Buffer data/u,
  );
  assert.throws(() => hammingDistance('00', '0000'), /different bit lengths/u);
});
