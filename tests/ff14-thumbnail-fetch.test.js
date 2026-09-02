const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DECLARED_LENGTH_ERROR_CODE,
  DECLARED_LENGTH_REASON_CODE,
  POLICY_VERSION,
  THUMBNAIL_INDEX_SCHEMA_VERSION,
  downloadThumbnails,
  extractImageCandidates,
  readResponseBody,
  validateImageBody,
  validateThumbnailUrl,
} = require('../scripts/fetch-ff14-media-thumbnails.js');

function png(width = 32, height = 18) {
  const body = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(body, 0);
  body.writeUInt32BE(13, 8);
  body.write('IHDR', 12, 'ascii');
  body.writeUInt32BE(width, 16);
  body.writeUInt32BE(height, 20);
  return body;
}

function jpeg(width = 32, height = 18) {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
}

function capturePage({ title, mime = 'image/png', sha1 = 'a'.repeat(40), thumbUrl, originalUrl, width = 960, height = 540 }) {
  return {
    title: `文件:${title}`,
    imageinfo: [{
      thumburl: thumbUrl,
      url: originalUrl || `https://huiji-public.huijistatic.com/ff14/uploads/original/${encodeURIComponent(title)}`,
      sha1,
      width,
      height,
      mime,
    }],
  };
}

function captureOf(...pages) {
  return { schemaVersion: 1, batches: [{ query: { pages } }] };
}

function fakeResponse({ url, mime = 'image/png', chunks = [png()], contentLength, contentEncoding = null, status = 200 }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        const lower = String(name).toLowerCase();
        if (lower === 'content-type') return `${mime}; charset=binary`;
        if (lower === 'content-length') return contentLength === undefined ? String(chunks.reduce((sum, chunk) => sum + chunk.length, 0)) : contentLength;
        if (lower === 'content-encoding') return contentEncoding;
        return null;
      },
    },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    },
  };
}

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ff14-thumb-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('thumbnail URL validation accepts only the direct scoped Huiji FF14 HTTPS endpoint', () => {
  const valid = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/example.png/128px-example.png';
  assert.equal(validateThumbnailUrl(valid).href, valid);
  for (const value of [
    valid.replace('https:', 'http:'),
    'https://huiji-thumb.huijistatic.com.example.test/ff14/example.png',
    'https://huiji-thumb.huijistatic.com/other/example.png',
    'https://huiji-thumb.huijistatic.com/ff14/uploads/original/example.png',
    'https://huiji-thumb.huijistatic.com/ff14/uploads/thumbish/example.png',
    'https://user@huiji-thumb.huijistatic.com/ff14/example.png',
    'https://huiji-thumb.huijistatic.com:444/ff14/example.png',
    `${valid}?cache=1`,
    `${valid}#anchor`,
  ]) assert.throws(() => validateThumbnailUrl(value));
});

test('capture extraction accepts complete PNG/JPEG evidence and rejects malformed source metadata', () => {
  const good = captureOf(
    capturePage({ title: '水晶塔.png', thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/tower.png/128px-tower.png' }),
    capturePage({ title: '地图音乐.ogg', mime: 'application/ogg', thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/c/d/music.ogg/128px-music.ogg.png' }),
  );
  const result = extractImageCandidates(good);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.excluded[0].reasonCode, 'unsupported-mime');
  assert.throws(() => extractImageCandidates(captureOf(capturePage({
    title: 'bad.png', thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/bad.png/128px-bad.png',
    originalUrl: 'https://example.test/ff14/uploads/bad.png',
  }))), /Original image URL host/iu);
  assert.throws(() => extractImageCandidates(captureOf(capturePage({
    title: 'zero.png', thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/b/zero.png/128px-zero.png', width: 0,
  }))), /positive safe integer/iu);
});

test('download publishes a no-redirect, identity-encoding audit index only after every staged file is complete', async (t) => {
  const root = await tempRoot(t);
  const outputDir = path.join(root, 'thumbnails');
  const indexPath = path.join(root, 'index.json');
  const pngUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  const jpegUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/b/b/b.jpg/128px-b.jpg';
  const capture = captureOf(
    capturePage({ title: 'B.jpg', mime: 'image/jpeg', sha1: 'b'.repeat(40), thumbUrl: jpegUrl }),
    capturePage({ title: 'A.png', mime: 'image/png', sha1: 'a'.repeat(40), thumbUrl: pngUrl }),
  );
  const requests = [];
  const index = await downloadThumbnails({
    capture, outputDir, indexPath, workspaceRoot: root, now: () => '2026-08-24T12:34:56.000Z',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return url === pngUrl
        ? fakeResponse({ url, chunks: [png(31, 17)] })
        : fakeResponse({ url, mime: 'image/jpeg', chunks: [jpeg(41, 19)] });
    },
  });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.headers['Accept-Encoding'], 'identity');
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(request.options.signal.aborted, true, 'completed requests must release the underlying connection');
  }
  assert.equal(index.schemaVersion, THUMBNAIL_INDEX_SCHEMA_VERSION);
  assert.equal(index.policyVersion, POLICY_VERSION);
  assert.deepEqual(index.downloadRejected, []);
  assert.equal(index.candidateCount, index.records.length + index.downloadRejected.length);
  assert.equal(index.physicalFileCount, 2);
  assert.equal(index.totalBytes, png(31, 17).length + jpeg(41, 19).length);
  assert.equal(index.records[0].requestedUrl, pngUrl);
  assert.equal(index.records[0].finalUrl, pngUrl);
  assert.equal(index.records[0].receivedMime, 'image/png');
  assert.equal(index.records[0].contentEncoding, 'identity');
  assert.equal(index.records[0].decodedWidth, 31);
  assert.equal(index.records[0].decodedHeight, 17);
  assert.equal(index.records[0].fetchedAt, '2026-08-24T12:34:56.000Z');
  assert.match(index.captureSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(JSON.parse(await fs.readFile(indexPath, 'utf8')), index);
  assert.deepEqual(await fs.readFile(path.join(root, index.records[0].localPath)), png(31, 17));
  assert.equal(
    (await fs.readdir(root)).some((name) => name.startsWith('.thumbnails.staging-')),
    false,
    'successful publication must not leave an empty staging directory behind',
  );
});

test('redirect-like final URLs, compressed responses, absent lengths and mismatched lengths fail before publication', async (t) => {
  const root = await tempRoot(t);
  const thumbUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  const capture = captureOf(capturePage({ title: 'A.png', thumbUrl }));
  const variants = [
    { name: 'changed-url', response: fakeResponse({ url: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-other.png' }), pattern: /changed unexpectedly/iu },
    { name: 'encoded', response: fakeResponse({ url: thumbUrl, contentEncoding: 'gzip' }), pattern: /content-encoding/iu },
    { name: 'no-length', response: fakeResponse({ url: thumbUrl, contentLength: null }), pattern: /Content-Length/iu },
    { name: 'wrong-length', response: fakeResponse({ url: thumbUrl, contentLength: '1' }), pattern: /Content-Length mismatch/iu },
  ];
  for (const variant of variants) {
    const outputDir = path.join(root, `${variant.name}-out`);
    const indexPath = path.join(root, `${variant.name}.json`);
    await assert.rejects(downloadThumbnails({ capture, outputDir, indexPath, workspaceRoot: root, fetchImpl: async () => variant.response }), variant.pattern);
    await assert.rejects(fs.access(outputDir));
    await assert.rejects(fs.access(indexPath));
  }
});

test('body validators reject forged content types and report actual PNG/JPEG dimensions', async () => {
  assert.deepEqual(validateImageBody(png(64, 36), 'image/png'), { mime: 'image/png', width: 64, height: 36 });
  assert.deepEqual(validateImageBody(jpeg(65, 37), 'image/jpeg'), { mime: 'image/jpeg', width: 65, height: 37 });
  assert.throws(() => validateImageBody(Buffer.from('not an image'), 'image/png'), /signature/iu);
  assert.throws(() => validateImageBody(png(), 'image/jpeg'), /JPEG signature/iu);
});

test('declared and streamed byte budgets fail closed before files are published', async (t) => {
  const root = await tempRoot(t);
  const firstUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  const secondUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/b/b/b.png/128px-b.png';
  const capture = captureOf(
    capturePage({ title: 'A.png', thumbUrl: firstUrl }),
    capturePage({ title: 'B.png', sha1: 'b'.repeat(40), thumbUrl: secondUrl }),
  );
  let secondReads = 0;
  let secondSignal = null;
  const second = fakeResponse({ url: secondUrl, chunks: [png()] });
  second.body = { async *[Symbol.asyncIterator]() { secondReads += 1; yield png(); } };
  await assert.rejects(downloadThumbnails({
    capture, outputDir: path.join(root, 'out'), indexPath: path.join(root, 'index.json'), workspaceRoot: root,
    maxFileBytes: png().length, maxTotalBytes: png().length + 1,
    fetchImpl: async (url, options) => {
      if (url === firstUrl) return fakeResponse({ url, chunks: [png()] });
      secondSignal = options.signal;
      return second;
    },
  }), /total budget/iu);
  assert.equal(secondReads, 0);
  assert.equal(secondSignal.aborted, true, 'failed requests must release the underlying connection');
  await assert.rejects(fs.access(path.join(root, 'out')));

  await assert.rejects(downloadThumbnails({
    capture: captureOf(capturePage({ title: 'C.png', thumbUrl: firstUrl })),
    outputDir: path.join(root, 'stream-overflow'), indexPath: path.join(root, 'stream-overflow.json'), workspaceRoot: root,
    maxFileBytes: png().length - 1, maxTotalBytes: png().length,
    fetchImpl: async (url) => fakeResponse({ url, chunks: [png()], contentLength: String(png().length - 1) }),
  }), /per-file budget/iu);
});

test('a declared per-file overflow is audited and skipped while compliant thumbnails still publish', async (t) => {
  const root = await tempRoot(t);
  const acceptedUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  const rejectedUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/b/b/b.png/128px-b.png';
  const capture = captureOf(
    capturePage({ title: 'A.png', thumbUrl: acceptedUrl }),
    capturePage({ title: 'B.png', sha1: 'b'.repeat(40), thumbUrl: rejectedUrl, width: 1200, height: 675 }),
  );
  const acceptedBody = png();
  let rejectedReads = 0;
  let rejectedReturns = 0;
  const rejectedResponse = fakeResponse({ url: rejectedUrl, contentLength: String(acceptedBody.length + 1) });
  rejectedResponse.body = {
    [Symbol.asyncIterator]() {
      return {
        async next() { rejectedReads += 1; return { done: false, value: Buffer.alloc(1) }; },
        async return() { rejectedReturns += 1; return { done: true }; },
      };
    },
  };
  const index = await downloadThumbnails({
    capture,
    outputDir: path.join(root, 'out'),
    indexPath: path.join(root, 'index.json'),
    workspaceRoot: root,
    maxFileBytes: acceptedBody.length,
    maxTotalBytes: acceptedBody.length * 2,
    now: () => '2026-08-25T00:01:02.000Z',
    fetchImpl: async (url) => url === acceptedUrl
      ? fakeResponse({ url, chunks: [acceptedBody] })
      : rejectedResponse,
  });
  assert.equal(index.records.length, 1);
  assert.equal(index.downloadRejected.length, 1);
  assert.equal(index.candidateCount, 2);
  assert.equal(index.candidateCount, index.records.length + index.downloadRejected.length);
  assert.equal(rejectedReads, 0, 'declared overflow must be rejected before consuming response bytes');
  assert.equal(rejectedReturns, 1, 'declared overflow must cancel its unread response body');
  assert.deepEqual(index.downloadRejected[0], {
    fileTitle: 'B.png',
    originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/original/B.png',
    thumbUrl: rejectedUrl,
    originalSha1: 'b'.repeat(40),
    originalWidth: 1200,
    originalHeight: 675,
    mime: 'image/png',
    requestedUrl: rejectedUrl,
    declaredLength: acceptedBody.length + 1,
    limit: acceptedBody.length,
    reasonCode: DECLARED_LENGTH_REASON_CODE,
    rejectedAt: '2026-08-25T00:01:02.000Z',
  });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8')), index);
  assert.deepEqual(await fs.readFile(path.join(root, index.records[0].localPath)), acceptedBody);
});

test('stream failures cancel the body immediately and never request another chunk', async () => {
  let nextCalls = 0;
  let returnCalls = 0;
  const iterator = {
    async next() {
      nextCalls += 1;
      return { done: false, value: nextCalls === 1 ? Buffer.alloc(5) : Buffer.alloc(1) };
    },
    async return() {
      returnCalls += 1;
      return { done: true };
    },
  };
  const response = { body: { [Symbol.asyncIterator]: () => iterator } };
  await assert.rejects(readResponseBody(response, {
    maxFileBytes: 4,
    maxTotalBytes: 16,
    totalBytes: 0,
    declaredLength: 4,
  }), /per-file budget/iu);
  assert.equal(nextCalls, 1);
  assert.equal(returnCalls, 1);

  nextCalls = 0;
  returnCalls = 0;
  await assert.rejects(readResponseBody(response, {
    maxFileBytes: 4,
    maxTotalBytes: 16,
    totalBytes: 0,
    declaredLength: 5,
  }), (error) => {
    assert.equal(error.code, DECLARED_LENGTH_ERROR_CODE);
    assert.equal(error.reasonCode, DECLARED_LENGTH_REASON_CODE);
    assert.equal(error.declaredLength, 5);
    assert.equal(error.limit, 4);
    return true;
  });
  assert.equal(nextCalls, 0, 'declared overflow must fail before reading the first chunk');
  assert.equal(returnCalls, 1, 'declared overflow must still cancel the unread body');
});

test('an uncooperative fetch adapter still times out and does not leave a staging output', async (t) => {
  const root = await tempRoot(t);
  const thumbUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  await assert.rejects(downloadThumbnails({
    capture: captureOf(capturePage({ title: 'A.png', thumbUrl })),
    outputDir: path.join(root, 'out'), indexPath: path.join(root, 'index.json'), workspaceRoot: root, timeoutMs: 10,
    fetchImpl: async () => new Promise(() => {}),
  }), /timed out/iu);
  await assert.rejects(fs.access(path.join(root, 'out')));
  await assert.rejects(fs.access(path.join(root, 'index.json')));
});

test('existing outputs and indexes are never overwritten, and late failures publish nothing', async (t) => {
  const root = await tempRoot(t);
  const thumbUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  const outputDir = path.join(root, 'out');
  const indexPath = path.join(root, 'index.json');
  await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, 'keep.txt'), 'keep');
  await assert.rejects(downloadThumbnails({ capture: captureOf(capturePage({ title: 'A.png', thumbUrl })), outputDir, indexPath, workspaceRoot: root, fetchImpl: async () => fakeResponse({ url: thumbUrl }) }), /already exists/iu);
  assert.equal(await fs.readFile(path.join(outputDir, 'keep.txt'), 'utf8'), 'keep');

  const protectedIndex = path.join(root, 'protected-index.json');
  await fs.writeFile(protectedIndex, 'do not replace');
  await assert.rejects(downloadThumbnails({
    capture: captureOf(capturePage({ title: 'A.png', thumbUrl })),
    outputDir: path.join(root, 'fresh-out'), indexPath: protectedIndex, workspaceRoot: root,
    fetchImpl: async () => fakeResponse({ url: thumbUrl }),
  }), /already exists/iu);
  assert.equal(await fs.readFile(protectedIndex, 'utf8'), 'do not replace');

  const failureOutput = path.join(root, 'failure-out');
  const failureIndex = path.join(root, 'failure-index.json');
  const secondUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/b/b/b.png/128px-b.png';
  await assert.rejects(downloadThumbnails({
    capture: captureOf(capturePage({ title: 'A.png', thumbUrl }), capturePage({ title: 'B.png', sha1: 'b'.repeat(40), thumbUrl: secondUrl })),
    outputDir: failureOutput, indexPath: failureIndex, workspaceRoot: root,
    fetchImpl: async (url) => url === thumbUrl ? fakeResponse({ url }) : Promise.reject(new Error('network stopped')),
  }), /network stopped/iu);
  await assert.rejects(fs.access(failureOutput));
  await assert.rejects(fs.access(failureIndex));

  const spoofedOutput = path.join(root, 'spoofed-out');
  const spoofedIndex = path.join(root, 'spoofed-index.json');
  const spoofed = Object.assign(new Error('adapter error with a copied code'), {
    code: DECLARED_LENGTH_ERROR_CODE,
    declaredLength: 999,
  });
  await assert.rejects(downloadThumbnails({
    capture: captureOf(capturePage({ title: 'A.png', thumbUrl })),
    outputDir: spoofedOutput,
    indexPath: spoofedIndex,
    workspaceRoot: root,
    fetchImpl: async () => { throw spoofed; },
  }), /adapter error/iu);
  await assert.rejects(fs.access(spoofedOutput));
  await assert.rejects(fs.access(spoofedIndex));
});

test('publication rolls back the linked index and output directory when temporary-index cleanup fails', async (t) => {
  const root = await tempRoot(t);
  const thumbUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  const outputDir = path.join(root, 'rollback-out');
  const indexPath = path.join(root, 'rollback-index.json');
  const originalRm = fs.rm;
  let injectedFailure = false;
  fs.rm = async (target, options) => {
    if (!injectedFailure && path.basename(String(target)).startsWith('.rollback-index.json.tmp-')) {
      injectedFailure = true;
      throw new Error('injected temporary-index cleanup failure');
    }
    return originalRm(target, options);
  };
  try {
    await assert.rejects(downloadThumbnails({
      capture: captureOf(capturePage({ title: 'A.png', thumbUrl })),
      outputDir,
      indexPath,
      workspaceRoot: root,
      fetchImpl: async () => fakeResponse({ url: thumbUrl }),
    }), /injected temporary-index cleanup failure/iu);
  } finally {
    fs.rm = originalRm;
  }
  assert.equal(injectedFailure, true);
  await assert.rejects(fs.access(outputDir));
  await assert.rejects(fs.access(indexPath));
});

test('a workspace symlink escape is rejected before network access', async (t) => {
  const root = await tempRoot(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ff14-thumb-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const link = path.join(root, 'linked');
  try { await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { t.skip(`symlink creation unavailable: ${error.code}`); return; }
  let requests = 0;
  await assert.rejects(downloadThumbnails({
    capture: captureOf(capturePage({ title: 'A.png', thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png' })),
    outputDir: path.join(link, 'out'), indexPath: path.join(root, 'index.json'), workspaceRoot: root,
    fetchImpl: async () => { requests += 1; return fakeResponse({ url: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png' }); },
  }), /symbolic link|resolves outside/iu);
  assert.equal(requests, 0);
});

test('conflicting stable filenames fail before fetching while identical source evidence is explicitly recorded as reuse', async (t) => {
  const root = await tempRoot(t);
  const thumbUrl = 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/a.png/128px-a.png';
  let requests = 0;
  await assert.rejects(downloadThumbnails({
    capture: captureOf(
      capturePage({ title: 'A.png', thumbUrl, originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/original/shared.png' }),
      capturePage({ title: 'B.png', thumbUrl: 'https://huiji-thumb.huijistatic.com/ff14/uploads/thumb/a/a/shared.png/128px-shared.png', originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/original/other.png' }),
    ), outputDir: path.join(root, 'conflict'), indexPath: path.join(root, 'conflict.json'), workspaceRoot: root,
    fetchImpl: async () => { requests += 1; return fakeResponse({ url: thumbUrl }); },
  }), /conflicting source evidence/iu);
  assert.equal(requests, 0);

  const sharedPage = (title) => capturePage({ title, thumbUrl, originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/original/shared.png' });
  const index = await downloadThumbnails({
    capture: captureOf(sharedPage('A.png'), sharedPage('B.png')),
    outputDir: path.join(root, 'reuse'), indexPath: path.join(root, 'reuse.json'), workspaceRoot: root,
    fetchImpl: async () => fakeResponse({ url: thumbUrl }),
  });
  assert.equal(index.records.length, 2);
  assert.equal(index.physicalFileCount, 1);
  assert.equal(index.records[1].reusedFromFileTitle, 'A.png');
  assert.equal(index.records[0].sha256, crypto.createHash('sha256').update(png()).digest('hex'));
});
