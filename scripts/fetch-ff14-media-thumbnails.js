'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const ALLOWED_THUMBNAIL_HOST = 'huiji-thumb.huijistatic.com';
const ALLOWED_THUMBNAIL_PATH_PREFIX = '/ff14/uploads/thumb/';
const ALLOWED_ORIGINAL_HOST = 'huiji-public.huijistatic.com';
const ALLOWED_ORIGINAL_PATH_PREFIX = '/ff14/uploads/';
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const POLICY_VERSION = 'ff14-thumbnail-fetch/v3-strict-audited-rejections';
const THUMBNAIL_INDEX_SCHEMA_VERSION = 3;
const DECLARED_LENGTH_ERROR_CODE = 'ERR_FF14_THUMBNAIL_DECLARED_LENGTH_EXCEEDS_LIMIT';
const DECLARED_LENGTH_REASON_CODE = 'declared-length-exceeds-file-limit';
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = 'Between-the-Stars/2.8.0 FFXIV-Media-Recovery (+local-audit)';
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CAPTURE_PATH = path.join(WORKSPACE_ROOT, 'tmp', 'ff14-wiki-image-info-capture.json');
const DEFAULT_OUTPUT_DIR = path.join(WORKSPACE_ROOT, 'tmp', 'ff14-media-thumbnails');
const DEFAULT_INDEX_PATH = path.join(WORKSPACE_ROOT, 'tmp', 'ff14-media-thumbnail-index.json');

function normalizeFileTitle(value) {
  return String(value || '').replace(/^(?:File|文件)\s*:/iu, '').trim();
}

function validateScopedUrl(value, { host, pathPrefix, label }) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${label} URL: ${value}`); }
  if (url.protocol !== 'https:') throw new Error(`${label} URL must use HTTPS: ${value}`);
  if (url.hostname !== host) throw new Error(`${label} URL host is not allowed: ${url.hostname}`);
  if (url.username || url.password) throw new Error(`${label} URL credentials are not allowed`);
  if (url.port) throw new Error(`${label} URL port is not allowed: ${url.port}`);
  if (!url.pathname.startsWith(pathPrefix)) throw new Error(`${label} URL path is outside ${pathPrefix}: ${url.pathname}`);
  if (url.search || url.hash) throw new Error(`${label} URL query strings and fragments are not allowed`);
  return url;
}

function validateThumbnailUrl(value) {
  return validateScopedUrl(value, { host: ALLOWED_THUMBNAIL_HOST, pathPrefix: ALLOWED_THUMBNAIL_PATH_PREFIX, label: 'Thumbnail' });
}

function validateOriginalUrl(value) {
  return validateScopedUrl(value, { host: ALLOWED_ORIGINAL_HOST, pathPrefix: ALLOWED_ORIGINAL_PATH_PREFIX, label: 'Original image' });
}

function positiveSafeInteger(value, label) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error(`${label} must be a positive safe integer`);
  return numeric;
}

function extractImageCandidates(capture) {
  if (!capture || !Array.isArray(capture.batches)) throw new Error('Invalid Huiji image-info capture: batches must be an array');
  const candidates = [];
  const excluded = [];
  const seenTitles = new Set();
  for (const batch of capture.batches) {
    const pages = batch && batch.query && batch.query.pages;
    if (!Array.isArray(pages)) throw new Error('Invalid Huiji image-info capture: every batch must contain query.pages');
    for (const page of pages) {
      const fileTitle = normalizeFileTitle(page && page.title);
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!fileTitle || !info) throw new Error('Invalid Huiji image-info capture: page title or imageinfo is missing');
      if (seenTitles.has(fileTitle)) throw new Error(`Duplicate Huiji file title in capture: ${fileTitle}`);
      seenTitles.add(fileTitle);
      const mime = String(info.mime || '').toLowerCase();
      if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
        excluded.push({ fileTitle, mime, reasonCode: 'unsupported-mime' });
        continue;
      }
      validateThumbnailUrl(info.thumburl);
      validateOriginalUrl(info.url);
      if (!/^[a-f0-9]{40}$/iu.test(String(info.sha1 || ''))) throw new Error(`Invalid original SHA-1 for ${fileTitle}`);
      candidates.push({
        fileTitle,
        originalUrl: String(info.url),
        thumbUrl: String(info.thumburl),
        originalSha1: String(info.sha1).toLowerCase(),
        originalWidth: positiveSafeInteger(info.width, `Original width for ${fileTitle}`),
        originalHeight: positiveSafeInteger(info.height, `Original height for ${fileTitle}`),
        mime,
      });
    }
  }
  candidates.sort((left, right) => left.fileTitle.localeCompare(right.fileTitle, 'zh-CN'));
  excluded.sort((left, right) => left.fileTitle.localeCompare(right.fileTitle, 'zh-CN'));
  return { candidates, excluded };
}

function responseMime(response) {
  const contentType = response && response.headers && response.headers.get('content-type');
  return String(contentType || '').split(';', 1)[0].trim().toLowerCase();
}

function responseEncoding(response) {
  return String(response && response.headers && response.headers.get('content-encoding') || '').trim().toLowerCase();
}

function parseContentLength(response) {
  const raw = response && response.headers && response.headers.get('content-length');
  if (!/^\d+$/u.test(String(raw || ''))) throw new Error('Thumbnail response requires a valid Content-Length');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Thumbnail response Content-Length is not safe');
  return value;
}

function createStableFilename(candidate) {
  return `${candidate.originalSha1}.${candidate.mime === 'image/png' ? 'png' : 'jpg'}`;
}

function candidateIdentity(candidate) {
  return JSON.stringify({ originalSha1: candidate.originalSha1, originalUrl: candidate.originalUrl, thumbUrl: candidate.thumbUrl, mime: candidate.mime });
}

function completeCandidateIdentity(candidate) {
  return JSON.stringify({
    fileTitle: candidate.fileTitle,
    originalUrl: candidate.originalUrl,
    thumbUrl: candidate.thumbUrl,
    originalSha1: candidate.originalSha1,
    originalWidth: candidate.originalWidth,
    originalHeight: candidate.originalHeight,
    mime: candidate.mime,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isContainedOrSame(root, candidate) {
  return path.resolve(root) === path.resolve(candidate) || isContained(root, candidate);
}

function portableLocalPath(workspaceRoot, absolutePath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absolutePath);
  if (!isContained(root, target)) throw new Error(`Output path must remain inside the workspace: ${absolutePath}`);
  return path.relative(root, target).split(path.sep).join('/');
}

async function pathExists(target) {
  try { await fs.lstat(target); return true; } catch (error) { if (error && error.code === 'ENOENT') return false; throw error; }
}

async function assertExistingDirectoryNotSymlink(target, label) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${target}`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${target}`);
}

async function ensureRealWorkspaceDirectory(workspaceRoot, directory, label) {
  const lexicalRoot = path.resolve(workspaceRoot);
  const lexicalDirectory = path.resolve(directory);
  if (!isContainedOrSame(lexicalRoot, lexicalDirectory)) throw new Error(`${label} must remain inside the workspace: ${directory}`);
  await assertExistingDirectoryNotSymlink(lexicalRoot, 'Workspace root');
  const rootReal = await fs.realpath(lexicalRoot);
  const relative = path.relative(lexicalRoot, lexicalDirectory);
  let cursor = lexicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (await pathExists(cursor)) await assertExistingDirectoryNotSymlink(cursor, label);
    else {
      await fs.mkdir(cursor);
      await assertExistingDirectoryNotSymlink(cursor, label);
    }
  }
  const actual = await fs.realpath(lexicalDirectory);
  if (!isContainedOrSame(rootReal, actual)) throw new Error(`${label} resolves outside the workspace: ${directory}`);
  return actual;
}

async function assertNewWorkspacePath(workspaceRoot, target, label) {
  const resolved = path.resolve(target);
  portableLocalPath(workspaceRoot, resolved);
  if (await pathExists(resolved)) throw new Error(`${label} already exists and will not be overwritten: ${resolved}`);
  await ensureRealWorkspaceDirectory(workspaceRoot, path.dirname(resolved), `${label} parent`);
  return resolved;
}

function validatePng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) throw new Error('Thumbnail PNG signature is invalid');
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Thumbnail PNG IHDR is invalid');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) throw new Error('Thumbnail PNG dimensions are invalid');
  return { mime: 'image/png', width, height };
}

function validateJpeg(buffer) {
  if (buffer.length < 11 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('Thumbnail JPEG signature is invalid');
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let cursor = 2;
  while (cursor < buffer.length) {
    while (cursor < buffer.length && buffer[cursor] === 0xff) cursor += 1;
    if (cursor >= buffer.length) break;
    const marker = buffer[cursor++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (cursor + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(cursor);
    if (length < 2 || cursor + length > buffer.length) throw new Error('Thumbnail JPEG segment is truncated');
    if (sofMarkers.has(marker)) {
      if (length < 8) throw new Error('Thumbnail JPEG frame is invalid');
      const height = buffer.readUInt16BE(cursor + 3);
      const width = buffer.readUInt16BE(cursor + 5);
      if (!width || !height) throw new Error('Thumbnail JPEG dimensions are invalid');
      return { mime: 'image/jpeg', width, height };
    }
    cursor += length;
  }
  throw new Error('Thumbnail JPEG frame marker is missing');
}

function validateImageBody(buffer, expectedMime) {
  const decoded = expectedMime === 'image/png' ? validatePng(buffer) : validateJpeg(buffer);
  if (decoded.mime !== expectedMime) throw new Error(`Thumbnail content does not match expected ${expectedMime}`);
  return decoded;
}

function abortError() { return new Error('Thumbnail request timed out'); }

function declaredLengthLimitError(declaredLength, limit) {
  const error = new Error(`Thumbnail exceeds per-file budget (${declaredLength} > ${limit})`);
  error.code = DECLARED_LENGTH_ERROR_CODE;
  error.reasonCode = DECLARED_LENGTH_REASON_CODE;
  error.declaredLength = declaredLength;
  error.limit = limit;
  return error;
}

async function raceWithAbort(value, signal) {
  if (!signal) return value;
  if (signal.aborted) throw abortError();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve(value), aborted]); } finally { signal.removeEventListener('abort', onAbort); }
}

async function readResponseBody(response, { maxFileBytes, maxTotalBytes, totalBytes, declaredLength, signal }) {
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw new Error('Thumbnail response has no readable body');
  const iterator = response.body[Symbol.asyncIterator]();
  const chunks = [];
  let fileBytes = 0;
  let completedNaturally = false;
  try {
    if (declaredLength > maxFileBytes) throw declaredLengthLimitError(declaredLength, maxFileBytes);
    if (totalBytes + declaredLength > maxTotalBytes) throw new Error(`Thumbnail set exceeds total budget (${totalBytes + declaredLength} > ${maxTotalBytes})`);
    while (true) {
      const next = await raceWithAbort(iterator.next(), signal);
      if (next.done) {
        completedNaturally = true;
        break;
      }
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      fileBytes += chunk.length;
      if (fileBytes > maxFileBytes) throw new Error(`Thumbnail exceeds per-file budget (${fileBytes} > ${maxFileBytes})`);
      if (totalBytes + fileBytes > maxTotalBytes) throw new Error(`Thumbnail set exceeds total budget (${totalBytes + fileBytes} > ${maxTotalBytes})`);
      chunks.push(chunk);
    }
  } finally {
    if (!completedNaturally) {
      try {
        const cancellation = typeof iterator.return === 'function'
          ? iterator.return()
          : (typeof response.body.cancel === 'function' ? response.body.cancel() : undefined);
        await Promise.resolve(cancellation).catch(() => undefined);
      } catch {
        // Cleanup failures must not replace the request or validation error.
      }
    }
  }
  if (fileBytes !== declaredLength) throw new Error(`Thumbnail Content-Length mismatch (${fileBytes} !== ${declaredLength})`);
  return Buffer.concat(chunks, fileBytes);
}

async function downloadCandidate(candidate, options) {
  const requestedUrl = validateThumbnailUrl(candidate.thumbUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await raceWithAbort(options.fetchImpl(requestedUrl.href, {
      headers: { Accept: candidate.mime, 'Accept-Encoding': 'identity', 'User-Agent': options.userAgent },
      redirect: 'error',
      signal: controller.signal,
    }), controller.signal);
    if (!response || !response.ok) throw new Error(`Thumbnail request failed with HTTP ${response ? response.status : 'unknown'}: ${requestedUrl.href}`);
    const finalUrl = validateThumbnailUrl(response.url).href;
    if (finalUrl !== requestedUrl.href) throw new Error(`Thumbnail response URL changed unexpectedly: ${finalUrl}`);
    const receivedMime = responseMime(response);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(receivedMime)) throw new Error(`Thumbnail response content-type is not allowed: ${receivedMime || '(missing)'}`);
    if (receivedMime !== candidate.mime) throw new Error(`Thumbnail response content-type mismatch: expected ${candidate.mime}, received ${receivedMime}`);
    const contentEncoding = responseEncoding(response);
    if (contentEncoding && contentEncoding !== 'identity') throw new Error(`Thumbnail response content-encoding is not allowed: ${contentEncoding}`);
    const declaredLength = parseContentLength(response);
    const body = await readResponseBody(response, { ...options, declaredLength, signal: controller.signal });
    const decoded = validateImageBody(body, candidate.mime);
    return { body, finalUrl, receivedMime, contentEncoding: contentEncoding || 'identity', declaredLength, decoded };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function preflightStableFilenames(candidates) {
  const identities = new Map();
  for (const candidate of candidates) {
    const filename = createStableFilename(candidate);
    const identity = candidateIdentity(candidate);
    const previous = identities.get(filename);
    if (previous && previous.identity !== identity) throw new Error(`Stable thumbnail filename has conflicting source evidence: ${filename}`);
    if (!previous) identities.set(filename, { identity, fileTitle: candidate.fileTitle });
  }
}

function assertCompleteCandidateAccounting(candidates, records, downloadRejected) {
  if (candidates.length !== records.length + downloadRejected.length) {
    throw new Error('Thumbnail candidate accounting is incomplete');
  }
  const expected = new Map(candidates.map((candidate) => [candidate.fileTitle, completeCandidateIdentity(candidate)]));
  const seenTitles = new Set();
  const seenIdentities = new Set();
  for (const item of [...records, ...downloadRejected]) {
    const identity = completeCandidateIdentity(item);
    if (!expected.has(item.fileTitle) || expected.get(item.fileTitle) !== identity) {
      throw new Error(`Thumbnail candidate accounting contains unknown source evidence: ${item.fileTitle}`);
    }
    if (seenTitles.has(item.fileTitle)) throw new Error(`Thumbnail candidate is accounted more than once: ${item.fileTitle}`);
    if (seenIdentities.has(identity)) throw new Error(`Thumbnail source identity is accounted more than once: ${item.fileTitle}`);
    seenTitles.add(item.fileTitle);
    seenIdentities.add(identity);
  }
}

async function publishStagedOutput({ stagingDir, outputDir, temporaryIndexPath, indexPath }) {
  if (await pathExists(outputDir)) throw new Error(`Thumbnail output directory already exists and will not be overwritten: ${outputDir}`);
  if (await pathExists(indexPath)) throw new Error(`Thumbnail index already exists and will not be overwritten: ${indexPath}`);
  let indexPublished = false;
  try {
    await fs.mkdir(outputDir);
  } catch (error) {
    if (error && error.code === 'EEXIST') throw new Error(`Thumbnail output directory already exists and will not be overwritten: ${outputDir}`);
    throw error;
  }
  try {
    for (const entry of await fs.readdir(stagingDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Unexpected staging entry: ${entry.name}`);
      await fs.rename(path.join(stagingDir, entry.name), path.join(outputDir, entry.name));
    }
    await fs.link(temporaryIndexPath, indexPath);
    indexPublished = true;
    await fs.rm(temporaryIndexPath, { force: true });
  } catch (error) {
    const rollbackErrors = [];
    if (indexPublished) {
      try { await fs.rm(indexPath, { force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    try { await fs.rm(outputDir, { recursive: true, force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], 'Thumbnail publication failed and rollback was incomplete');
    }
    throw error;
  }
}

async function downloadThumbnails({
  capture,
  capturePath = DEFAULT_CAPTURE_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
  indexPath = DEFAULT_INDEX_PATH,
  fetchImpl = globalThis.fetch,
  workspaceRoot = WORKSPACE_ROOT,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_USER_AGENT,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!Number.isInteger(maxTotalBytes) || maxTotalBytes <= 0) throw new Error('maxTotalBytes must be a positive integer');
  if (!Number.isInteger(maxFileBytes) || maxFileBytes <= 0) throw new Error('maxFileBytes must be a positive integer');
  if (maxFileBytes > maxTotalBytes) throw new Error('maxFileBytes cannot exceed maxTotalBytes');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer');
  const resolvedOutputDir = await assertNewWorkspacePath(workspaceRoot, outputDir, 'Thumbnail output directory');
  const resolvedIndexPath = await assertNewWorkspacePath(workspaceRoot, indexPath, 'Thumbnail index');
  const sourceCapture = capture || JSON.parse(await fs.readFile(capturePath, 'utf8'));
  const captureSha256 = sha256(JSON.stringify(sourceCapture));
  const { candidates, excluded } = extractImageCandidates(sourceCapture);
  preflightStableFilenames(candidates);
  const outputParent = await ensureRealWorkspaceDirectory(workspaceRoot, path.dirname(resolvedOutputDir), 'Thumbnail output parent');
  const indexParent = await ensureRealWorkspaceDirectory(workspaceRoot, path.dirname(resolvedIndexPath), 'Thumbnail index parent');
  const stagingDir = await fs.mkdtemp(path.join(outputParent, `.${path.basename(resolvedOutputDir)}.staging-`));
  const stagedFiles = new Map();
  const records = [];
  const downloadRejected = [];
  let totalBytes = 0;
  let temporaryIndexPath = null;
  try {
    for (const candidate of candidates) {
      const filename = createStableFilename(candidate);
      let downloaded = stagedFiles.get(filename);
      let reusedFromFileTitle = null;
      if (!downloaded) {
        let result;
        try {
          result = await downloadCandidate(candidate, { fetchImpl, maxFileBytes, maxTotalBytes, timeoutMs, totalBytes, userAgent });
        } catch (error) {
          if (
            error?.code === DECLARED_LENGTH_ERROR_CODE
            && error.reasonCode === DECLARED_LENGTH_REASON_CODE
            && Number.isSafeInteger(error.declaredLength)
            && error.declaredLength > maxFileBytes
            && error.limit === maxFileBytes
          ) {
            downloadRejected.push({
              ...candidate,
              requestedUrl: candidate.thumbUrl,
              declaredLength: error.declaredLength,
              limit: maxFileBytes,
              reasonCode: DECLARED_LENGTH_REASON_CODE,
              rejectedAt: new Date(now()).toISOString(),
            });
            continue;
          }
          throw error;
        }
        const stagingPath = path.join(stagingDir, filename);
        await fs.writeFile(stagingPath, result.body, { flag: 'wx' });
        downloaded = {
          bytes: result.body.length, sha256: sha256(result.body), stagingPath, finalUrl: result.finalUrl,
          receivedMime: result.receivedMime, contentEncoding: result.contentEncoding, declaredLength: result.declaredLength,
          width: result.decoded.width, height: result.decoded.height, firstFileTitle: candidate.fileTitle,
        };
        stagedFiles.set(filename, downloaded);
        totalBytes += result.body.length;
      } else reusedFromFileTitle = downloaded.firstFileTitle;
      records.push({
        ...candidate, bytes: downloaded.bytes, sha256: downloaded.sha256,
        localPath: portableLocalPath(workspaceRoot, path.join(resolvedOutputDir, filename)),
        physicalFileId: filename, reusedFromFileTitle, requestedUrl: candidate.thumbUrl, finalUrl: downloaded.finalUrl,
        receivedMime: downloaded.receivedMime, contentEncoding: downloaded.contentEncoding,
        declaredLength: downloaded.declaredLength, decodedWidth: downloaded.width, decodedHeight: downloaded.height,
        fetchedAt: new Date(now()).toISOString(),
      });
    }
    assertCompleteCandidateAccounting(candidates, records, downloadRejected);
    const index = {
      schemaVersion: THUMBNAIL_INDEX_SCHEMA_VERSION,
      policyVersion: POLICY_VERSION,
      generatedAt: new Date(now()).toISOString(),
      captureSha256,
      limits: { maxTotalBytes, maxFileBytes, timeoutMs, concurrency: 1, redirects: 'error', acceptEncoding: 'identity' },
      candidateCount: candidates.length,
      excluded,
      downloadRejected,
      totalBytes,
      physicalFileCount: stagedFiles.size,
      records,
    };
    temporaryIndexPath = path.join(indexParent, `.${path.basename(resolvedIndexPath)}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`);
    await fs.writeFile(temporaryIndexPath, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
    await publishStagedOutput({ stagingDir, outputDir: resolvedOutputDir, temporaryIndexPath, indexPath: resolvedIndexPath });
    return index;
  } finally {
    if (temporaryIndexPath) await fs.rm(temporaryIndexPath, { force: true });
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await downloadThumbnails();
  console.log(`Downloaded ${result.records.length} FFXIV thumbnails (${result.totalBytes} bytes).`);
  console.log(`Index: ${path.relative(WORKSPACE_ROOT, DEFAULT_INDEX_PATH)}`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  DECLARED_LENGTH_ERROR_CODE,
  DECLARED_LENGTH_REASON_CODE,
  POLICY_VERSION,
  THUMBNAIL_INDEX_SCHEMA_VERSION,
  createStableFilename,
  downloadThumbnails,
  extractImageCandidates,
  readResponseBody,
  validateImageBody,
  validateOriginalUrl,
  validateThumbnailUrl,
};
