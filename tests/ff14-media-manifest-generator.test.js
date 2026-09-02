'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

const { generateFF14MediaManifest, preservePublicOriginals } = require('../scripts/generate-ff14-media-manifest.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(value), 'utf8');
}

async function png(red, green, blue) {
  return sharp({ create: { width: 96, height: 64, channels: 3, background: { r: red, g: green, b: blue } } })
    .png()
    .toBuffer();
}

test('manifest regeneration preserves a downloaded original only for the identical upstream identity', () => {
  const source = { originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/a.png', originalSha1: 'a'.repeat(40) };
  const records = [{ source: { ...source } }, { source: { ...source, originalSha1: 'b'.repeat(40) } }];
  const publicOriginal = { path: './assets/images/ff14/public-originals/a.png', originalUrl: source.originalUrl, originalSha1: source.originalSha1 };
  const preserved = preservePublicOriginals(records, { records: [{ source: { ...source, publicOriginal } }] });
  assert.equal(preserved, 1);
  assert.deepEqual(records[0].source.publicOriginal, publicOriginal);
  assert.equal(records[1].source.publicOriginal, undefined);
});

async function createFixture(t, { collision = false, identicalBasename = false, decorative = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ff14-media-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceImage = await png(40, 80, 120);
  const otherImage = await png(210, 10, 20);
  const thumbnailHash = sha256(sourceImage);
  const thumbnailRelative = `thumbnails/${thumbnailHash}.png`;
  await fs.mkdir(path.join(root, 'knowledge', 'one'), { recursive: true });
  await fs.writeFile(path.join(root, 'knowledge', 'one', 'match.png'), sourceImage);
  await fs.writeFile(path.join(root, 'knowledge', 'one', 'other.png'), otherImage);
  await fs.mkdir(path.join(root, 'tmp', 'thumbnails'), { recursive: true });
  await fs.writeFile(path.join(root, 'tmp', thumbnailRelative), sourceImage);
  await writeJson(root, 'src/_data/ff14.json', { events: [{ id: 'ff14-001' }] });

  const sources = [{
    sourceTxt: 'history/one.txt',
    localImageDirectory: 'knowledge/one',
    imageMarkerCount: 2,
    wikiCandidates: [{ title: '测试页面', url: 'https://ff14.huijiwiki.com/wiki/test' }],
    headings: [{ eventId: 'ff14-001', title: '事件甲', publishedTitle: '事件甲', imageMarkerCount: 2 }],
  }];
  const pageWikitext = decorative
    ? '== 事件甲 ==\n[[文件:匹配.png|thumb|匹配图]]\n[[文件:Sline.png|thumb]]\n[[文件:缺缩略图.png|thumb|缺图]]'
    : '== 事件甲 ==\n[[文件:匹配.png|thumb|匹配图]]\n[[文件:缺缩略图.png|thumb|缺图]]';
  const pages = [{
    pageid: 10,
    title: '测试页面',
    revisions: [{ slots: { main: { content: pageWikitext } } }],
  }];
  if (collision || identicalBasename) {
    await fs.mkdir(path.join(root, 'knowledge', 'two'), { recursive: true });
    await fs.writeFile(path.join(root, 'knowledge', 'two', 'match.png'), identicalBasename ? sourceImage : otherImage);
    sources.push({
      sourceTxt: 'history/two.txt',
      localImageDirectory: 'knowledge/two',
      imageMarkerCount: 0,
      wikiCandidates: [{ title: '无媒体页面', url: 'https://ff14.huijiwiki.com/wiki/empty' }],
      headings: [{ eventId: 'ff14-002', title: '事件乙', publishedTitle: '事件乙', imageMarkerCount: 0 }],
    });
    pages.push({
      pageid: 11,
      title: '无媒体页面',
      revisions: [{ slots: { main: { content: '== 事件乙 ==' } } }],
    });
  }
  await writeJson(root, 'tmp/catalog.json', { sources });
  await writeJson(root, 'tmp/source-capture.json', { query: { pages } });
  const imageInfoCapture = {
    batches: [{ query: { pages: [{
      title: '文件:匹配.png',
      imageinfo: [{
        url: 'https://huiji-public.huijistatic.com/ff14/uploads/a/b/match.png',
        sha1: 'a'.repeat(40),
        width: 1920,
        height: 1280,
        thumburl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/match.png/128px-match.png',
        thumbwidth: 96,
        thumbheight: 64,
        mime: 'image/png',
      }],
    }, {
      title: '文件:缺缩略图.png',
      imageinfo: [{
        url: 'https://huiji-public.huijistatic.com/ff14/uploads/a/b/missing.png',
        sha1: 'b'.repeat(40),
        width: 1920,
        height: 1280,
        thumburl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/missing.png/128px-missing.png',
        thumbwidth: 96,
        thumbheight: 64,
        mime: 'image/png',
      }],
    }, ...(decorative ? [{
      title: '文件:Sline.png',
      imageinfo: [{
        url: 'https://huiji-public.huijistatic.com/ff14/uploads/a/b/sline.png',
        sha1: 'c'.repeat(40),
        thumburl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/sline.png/128px-sline.png',
        thumbwidth: 128,
        thumbheight: 1,
        width: 720,
        height: 7,
        mime: 'image/png',
      }],
    }] : [])] } }],
  };
  await writeJson(root, 'tmp/image-info.json', imageInfoCapture);
  await writeJson(root, 'tmp/thumbnail-index.json', {
    schemaVersion: 3,
    policyVersion: 'ff14-thumbnail-fetch/v3-strict-audited-rejections',
    captureSha256: sha256(Buffer.from(JSON.stringify(imageInfoCapture))),
    totalBytes: sourceImage.length,
    candidateCount: 2,
    physicalFileCount: 1,
    limits: {
      maxTotalBytes: 4 * 1024 * 1024,
      maxFileBytes: 128 * 1024,
      timeoutMs: 15_000,
      concurrency: 1,
      redirects: 'error',
      acceptEncoding: 'identity',
    },
    records: [{
      fileTitle: '匹配.png',
      originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/a/b/match.png',
      originalSha1: 'a'.repeat(40),
      originalWidth: 1920,
      originalHeight: 1280,
      thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/match.png/128px-match.png',
      mime: 'image/png',
      receivedMime: 'image/png',
      contentEncoding: 'identity',
      bytes: sourceImage.length,
      declaredLength: sourceImage.length,
      decodedWidth: 96,
      decodedHeight: 64,
      sha256: thumbnailHash,
      localPath: `tmp/${thumbnailRelative}`,
      physicalFileId: `${'a'.repeat(40)}.png`,
      requestedUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/match.png/128px-match.png',
      finalUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/match.png/128px-match.png',
    }],
    downloadRejected: [{
      fileTitle: '缺缩略图.png',
      originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/a/b/missing.png',
      originalSha1: 'b'.repeat(40),
      originalWidth: 1920,
      originalHeight: 1280,
      thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/missing.png/128px-missing.png',
      mime: 'image/png',
      requestedUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/missing.png/128px-missing.png',
      declaredLength: 128 * 1024 + 1,
      limit: 128 * 1024,
      reasonCode: 'declared-length-exceeds-file-limit',
      rejectedAt: '2026-08-25T00:01:02.000Z',
    }],
  });
  return {
    root,
    paths: {
      catalog: 'tmp/catalog.json',
      sourceCapture: 'tmp/source-capture.json',
      imageInfoCapture: 'tmp/image-info.json',
      thumbnailIndex: 'tmp/thumbnail-index.json',
      ff14Data: 'src/_data/ff14.json',
      output: 'scripts/data/output.json',
    },
  };
}

test('generator writes only thumbnail-backed assignments with complete source evidence and audits exclusions', async (t) => {
  const fixture = await createFixture(t);
  const manifest = await generateFF14MediaManifest({
    workspaceRoot: fixture.root,
    paths: fixture.paths,
    now: () => '2026-08-24T12:34:56.000Z',
  });

  assert.equal(manifest.records.length, 1);
  assert.equal(manifest.audit.capturedSourceCount, 1);
  assert.equal(manifest.audit.rejected.some((item) => item.reasonCode === 'missing-thumbnail-index'), true);
  assert.equal(
    manifest.audit.rejected.some((item) => (
      item.fileTitle === '缺缩略图.png'
      && item.reasonCode === 'missing-thumbnail-index'
      && item.detail === `declared-length-exceeds-file-limit: ${128 * 1024 + 1} > ${128 * 1024}`
    )),
    true,
  );
  const source = manifest.records[0].source;
  assert.equal(source.id.length, 64);
  assert.equal(source.recordId, 'ff14-001');
  assert.deepEqual(source.sourcePage, {
    pageId: 10,
    title: '测试页面',
    url: 'https://ff14.huijiwiki.com/wiki/test',
    wikitextSha256: sha256(Buffer.from('== 事件甲 ==\n[[文件:匹配.png|thumb|匹配图]]\n[[文件:缺缩略图.png|thumb|缺图]]')),
  });
  assert.equal(source.sourceFileTitle, 'history/one.txt');
  assert.deepEqual(source.sectionTrail, [{ title: '事件甲', level: 2, position: 1 }]);
  assert.equal(source.fileTitle, '匹配.png');
  assert.equal(source.originalSha1, 'a'.repeat(40));
  assert.deepEqual([source.originalWidth, source.originalHeight], [1920, 1280]);
  assert.equal(source.thumbnail.bytes > 0, true);
  assert.equal(source.thumbnail.mime, 'image/png');
  assert.deepEqual([source.thumbnail.width, source.thumbnail.height], [96, 64]);
  assert.equal(
    source.thumbnail.evidencePath,
    `scripts/data/ff14-media-thumbnails/${source.thumbnail.sha256}.png`,
  );
  assert.deepEqual(
    await fs.readFile(path.join(fixture.root, source.thumbnail.evidencePath)),
    await fs.readFile(path.join(fixture.root, 'tmp', `thumbnails/${source.thumbnail.sha256}.png`)),
  );
  assert.equal(manifest.generation.thumbnailBytes, source.thumbnail.bytes);
  assert.equal(manifest.generation.generatedAt, '2026-08-24T12:34:56.000Z');
  for (const key of [
    'sourceCatalogSha256',
    'wikiCaptureSha256',
    'imageInfoCaptureSha256',
    'thumbnailIndexSha256',
    'ff14DataSha256',
  ]) assert.match(manifest.generation[key], /^[a-f0-9]{64}$/u);
  assert.equal(manifest.candidatePool.totalLocalImages, 2);
  assert.equal(manifest.candidatePool.contentImages.length, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(fixture.root, fixture.paths.output), 'utf8')), manifest);
});

test('generator keeps identical basename copies as one audited candidate', async (t) => {
  const fixture = await createFixture(t, { identicalBasename: true });
  const manifest = await generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths });
  assert.equal(manifest.candidatePool.totalLocalImages, 2);
  assert.equal(manifest.candidatePool.contentImages.length, 2);
  const reused = manifest.candidatePool.contentImages.find((item) => item.path.endsWith('/match.png'));
  assert.equal(reused.deduplicatedSourcePaths.length, 2);
});

test('generator refuses evidence-directory relocation and conflicting content-addressed bytes', async (t) => {
  const relocated = await createFixture(t);
  await assert.rejects(
    generateFF14MediaManifest({
      workspaceRoot: relocated.root,
      paths: { ...relocated.paths, evidenceDir: 'tmp/ff14-evidence' },
    }),
    /evidenceDir must remain/iu,
  );

  const conflict = await createFixture(t);
  const index = JSON.parse(await fs.readFile(path.join(conflict.root, conflict.paths.thumbnailIndex), 'utf8'));
  const evidenceDir = path.join(conflict.root, 'scripts', 'data', 'ff14-media-thumbnails');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, `${index.records[0].sha256}.png`), Buffer.from('forged evidence'));
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: conflict.root, paths: conflict.paths }),
    /conflicts with its content address/iu,
  );
});

test('generator requires captured original and thumbnail dimensions before emitting evidence', async (t) => {
  const fixture = await createFixture(t);
  const imageInfoPath = path.join(fixture.root, fixture.paths.imageInfoCapture);
  const indexPath = path.join(fixture.root, fixture.paths.thumbnailIndex);
  const imageInfo = JSON.parse(await fs.readFile(imageInfoPath, 'utf8'));
  delete imageInfo.batches[0].query.pages[0].imageinfo[0].width;
  await fs.writeFile(imageInfoPath, JSON.stringify(imageInfo));
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.captureSha256 = sha256(Buffer.from(JSON.stringify(imageInfo)));
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /captured original width/iu,
  );
});

test('generator excludes source-provenance thin separator images as decorative media', async (t) => {
  const fixture = await createFixture(t, { decorative: true });
  const manifest = await generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths });
  assert.equal(manifest.records.length, 1);
  assert.equal(manifest.audit.rejected.some((item) => item.fileTitle === 'Sline.png' && item.reasonCode === 'decorative-media'), true);
});

test('generator fails rather than guessing a public asset path for colliding basenames', async (t) => {
  const fixture = await createFixture(t, { collision: true });
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /basename collision/iu,
  );
});

test('generator rejects candidate image directories outside the real workspace', async (t) => {
  const fixture = await createFixture(t);
  const catalogPath = path.join(fixture.root, fixture.paths.catalog);
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const outsideDirectory = `${fixture.root}-outside-candidates`;
  t.after(() => fs.rm(outsideDirectory, { recursive: true, force: true }));
  await fs.mkdir(outsideDirectory, { recursive: true });
  await fs.copyFile(
    path.join(fixture.root, 'knowledge', 'one', 'match.png'),
    path.join(outsideDirectory, 'match.png'),
  );
  catalog.sources[0].localImageDirectory = path.relative(fixture.root, outsideDirectory);
  await fs.writeFile(catalogPath, JSON.stringify(catalog));

  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /candidate image directory.*workspace/iu,
  );
});

test('generator rejects an index detached from its capture or an unsafe workspace path', async (t) => {
  const fixture = await createFixture(t);
  const indexPath = path.join(fixture.root, fixture.paths.thumbnailIndex);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.captureSha256 = '0'.repeat(64);
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /captureSha256/iu,
  );

  index.captureSha256 = sha256(Buffer.from(JSON.stringify(JSON.parse(await fs.readFile(path.join(fixture.root, fixture.paths.imageInfoCapture), 'utf8')))));
  index.records[0].localPath = '../outside.png';
  await fs.writeFile(indexPath, JSON.stringify(index));
  const manifest = await generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths });
  assert.equal(manifest.records.length, 0);
  assert.equal(manifest.audit.rejected.some((item) => item.reasonCode === 'unsafe-thumbnail-local-path'), true);
});

test('generator rejects index metadata that disagrees with the captured image evidence', async (t) => {
  const fixture = await createFixture(t);
  const indexPath = path.join(fixture.root, fixture.paths.thumbnailIndex);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.records[0].receivedMime = 'image/jpeg';
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /received MIME mismatch/iu,
  );
});

test('generator rejects a forged thumbnail transfer accounting envelope', async (t) => {
  const fixture = await createFixture(t);
  const indexPath = path.join(fixture.root, fixture.paths.thumbnailIndex);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.totalBytes += 1;
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /totalBytes/iu,
  );

  index.totalBytes -= 1;
  index.records[0].contentEncoding = 'gzip';
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /content encoding/iu,
  );
});

test('generator accepts only capture-bound declared-length download rejections', async (t) => {
  const cases = [
    {
      mutate(index) { index.candidateCount -= 1; },
      pattern: /records plus downloadRejected/iu,
    },
    {
      mutate(index) { index.downloadRejected[0].reasonCode = 'network-error'; },
      pattern: /reason is not allowed/iu,
    },
    {
      mutate(index) { index.downloadRejected[0].declaredLength = index.limits.maxFileBytes; },
      pattern: /does not prove a declared per-file overflow/iu,
    },
    {
      mutate(index) { index.downloadRejected[0].originalWidth += 1; },
      pattern: /does not match image-info capture/iu,
    },
    {
      mutate(index) { index.downloadRejected[0].rejectedAt = 'yesterday'; },
      pattern: /canonical ISO timestamp/iu,
    },
    {
      mutate(index) { index.downloadRejected[0].fileTitle = index.records[0].fileTitle; },
      pattern: /accounted more than once/iu,
    },
  ];
  for (const item of cases) {
    const fixture = await createFixture(t);
    const indexPath = path.join(fixture.root, fixture.paths.thumbnailIndex);
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    item.mutate(index);
    await fs.writeFile(indexPath, JSON.stringify(index));
    await assert.rejects(
      generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
      item.pattern,
    );
  }
});

test('generator fails closed for cache symlinks and decoded-image metadata mismatches', async (t) => {
  const fixture = await createFixture(t);
  const indexPath = path.join(fixture.root, fixture.paths.thumbnailIndex);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.records[0].decodedWidth = 95;
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(
    generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths }),
    /decoded dimensions disagree/iu,
  );

  index.records[0].decodedWidth = 96;
  const outside = path.join(fixture.root, 'outside.png');
  const [firstThumbnail] = await fs.readdir(path.join(fixture.root, 'tmp', 'thumbnails'));
  await fs.copyFile(path.join(fixture.root, 'tmp', 'thumbnails', firstThumbnail), outside);
  const link = path.join(fixture.root, 'tmp', 'thumbnails', 'link.png');
  try {
    await fs.symlink(outside, link, 'file');
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code}`);
    return;
  }
  index.records[0].localPath = 'tmp/thumbnails/link.png';
  await fs.writeFile(indexPath, JSON.stringify(index));
  const symlinkMismatch = await generateFF14MediaManifest({ workspaceRoot: fixture.root, paths: fixture.paths });
  assert.equal(symlinkMismatch.records.length, 0);
  assert.equal(symlinkMismatch.audit.rejected.some((item) => item.reasonCode === 'unsafe-thumbnail-local-path'), true);
});
