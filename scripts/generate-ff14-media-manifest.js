'use strict';

// Builds an auditable, local-only media-recovery manifest from the already
// captured Huiji metadata and thumbnail cache.  It deliberately does not make
// network requests: a missing or malformed thumbnail becomes an audit
// rejection rather than a guessed image binding.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const { parseWikitextMedia } = require('./lib/ff14-wikitext-media.js');
const { assignSourceMediaToEvents } = require('./lib/ff14-media-source-assignment.js');
const { createMediaRecoveryManifest } = require('./lib/ff14-media-recovery.js');

const DEFAULT_PATHS = Object.freeze({
  catalog: 'tmp/ff14-media-source-catalog.json',
  sourceCapture: 'tmp/ff14-wiki-source-capture.json',
  imageInfoCapture: 'tmp/ff14-wiki-image-info-capture.json',
  thumbnailIndex: 'tmp/ff14-media-thumbnail-index.json',
  ff14Data: 'src/_data/ff14.json',
  evidenceDir: 'scripts/data/ff14-media-thumbnails',
  output: 'scripts/data/ff14-media-manifest.json',
});

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/iu;
const FILE_NAMESPACE = /^(?:file|文件)\s*:\s*/iu;
// The source catalog was built from the user's local FFXIV knowledge base,
// which deliberately lives beside the repository.  It is a read-only input:
// only hashes and decoded metadata are read, and the resulting public path
// always points to the already tracked copy under src/assets/images/ff14.
const TRUSTED_EXTERNAL_CANDIDATE_DIRECTORY = 'FFXIV背景知识';
const THUMBNAIL_INDEX_SCHEMA_VERSION = 3;
const THUMBNAIL_POLICY_VERSION = 'ff14-thumbnail-fetch/v3-strict-audited-rejections';
const DOWNLOAD_REJECTION_REASON_CODES = new Set(['declared-length-exceeds-file-limit']);
const MAX_THUMBNAIL_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_THUMBNAIL_FILE_BYTES = 128 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function jsonSha256(value) {
  return sha256(Buffer.from(JSON.stringify(value), 'utf8'));
}

function normaliseFileTitle(value) {
  return String(value || '').replace(FILE_NAMESPACE, '').trim().normalize('NFKC');
}

function sourceKey(value) {
  return normaliseFileTitle(value).toLowerCase();
}

function sourceWikitext(page) {
  return page?.revisions?.[0]?.slots?.main?.content;
}

async function readJsonWithBytes(filePath) {
  const bytes = await fs.readFile(filePath);
  return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) };
}

async function readExistingManifest(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function originalIdentity(source) {
  return [source?.originalUrl, source?.originalSha1].map(value => String(value || '')).join('\0');
}

// A generation run rebuilds thumbnail evidence and matching claims from
// scratch.  Verified source originals live in a separate, content-addressed
// namespace, so carry their immutable provenance forward only when the exact
// upstream URL and SHA-1 are still the same.  Admission rechecks the bytes,
// dimensions and path before any page can expose them.
function preservePublicOriginals(records, previousManifest) {
  const previous = new Map();
  for (const record of previousManifest?.records || []) {
    const source = record?.source;
    if (source?.publicOriginal) previous.set(originalIdentity(source), source.publicOriginal);
  }
  let preserved = 0;
  for (const record of records) {
    const publicOriginal = previous.get(originalIdentity(record.source));
    if (!publicOriginal) continue;
    record.source.publicOriginal = publicOriginal;
    preserved += 1;
  }
  return preserved;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function flattenImageInfo(capture) {
  const pages = [];
  for (const batch of requireArray(capture?.batches, 'image info capture batches')) {
    pages.push(...requireArray(batch?.query?.pages, 'image info capture query.pages'));
  }
  const result = new Map();
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info || typeof page?.title !== 'string') continue;
    const title = normaliseFileTitle(page.title);
    const key = sourceKey(title);
    if (!key) continue;
    if (result.has(key)) throw new Error(`duplicate image-info title: ${title}`);
    result.set(key, {
      fileTitle: title,
      originalUrl: info.url || null,
      originalSha1: info.sha1 || null,
      originalWidth: info.width ?? null,
      originalHeight: info.height ?? null,
      thumbUrl: info.thumburl || null,
      thumbWidth: info.thumbwidth ?? null,
      thumbHeight: info.thumbheight ?? null,
      mime: info.mime || null,
    });
  }
  return result;
}

function indexByTitle(records, label) {
  const result = new Map();
  for (const record of requireArray(records, label)) {
    const key = sourceKey(record?.fileTitle);
    if (!key) throw new Error(`${label} record has no fileTitle.`);
    if (result.has(key)) throw new Error(`duplicate ${label} title: ${record.fileTitle}`);
    result.set(key, record);
  }
  return result;
}

function capturePages(capture) {
  const pages = requireArray(capture?.query?.pages, 'source capture query.pages');
  const result = new Map();
  for (const page of pages) {
    if (typeof page?.title !== 'string' || typeof sourceWikitext(page) !== 'string') {
      throw new Error('source capture page lacks title or wikitext.');
    }
    if (result.has(page.title)) throw new Error(`duplicate source capture title: ${page.title}`);
    result.set(page.title, page);
  }
  return result;
}

function selectCapturedSources(catalog, pagesByTitle) {
  const result = [];
  for (const source of requireArray(catalog?.sources, 'catalog sources')) {
    const candidates = requireArray(source?.wikiCandidates, `wiki candidates for ${source?.sourceTxt || 'unknown source'}`);
    const captured = candidates.filter((candidate) => pagesByTitle.has(candidate?.title));
    if (captured.length > 1) {
      throw new Error(`more than one captured Wiki page belongs to ${source.sourceTxt}`);
    }
    if (captured.length === 0) continue;
    if (typeof source.localImageDirectory !== 'string' || !source.localImageDirectory.trim()) {
      throw new Error(`captured source ${source.sourceTxt} lacks localImageDirectory.`);
    }
    result.push({ source, candidate: captured[0], page: pagesByTitle.get(captured[0].title) });
  }
  return result;
}

function isNestedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function resolveCandidateDirectory(workspaceRoot, localImageDirectory) {
  const workspace = path.resolve(workspaceRoot);
  const directory = path.resolve(workspace, localImageDirectory);
  const trustedExternalRoot = path.resolve(workspace, '..', TRUSTED_EXTERNAL_CANDIDATE_DIRECTORY);

  if (!isNestedPath(workspace, directory) && !isNestedPath(trustedExternalRoot, directory)) {
    throw new Error(`candidate image directory must be inside the workspace or the trusted ${TRUSTED_EXTERNAL_CANDIDATE_DIRECTORY} source root.`);
  }

  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`candidate image directory must be a real directory: ${directory}`);
  }
  return directory;
}

async function imageEntriesFromSources(sources, workspaceRoot) {
  const byAbsolutePath = new Map();
  for (const { source } of sources) {
    const directory = await resolveCandidateDirectory(workspaceRoot, source.localImageDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !IMAGE_EXTENSION.test(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (byAbsolutePath.has(absolutePath)) continue;
      byAbsolutePath.set(absolutePath, entry.name);
    }
  }
  const inspected = await Promise.all([...byAbsolutePath.entries()].sort(([left], [right]) => left.localeCompare(right)).map(async ([absolutePath, basename]) => {
    const buffer = await fs.readFile(absolutePath);
    const metadata = await sharp(buffer).metadata();
    if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
      throw new Error(`unable to read local image dimensions: ${absolutePath}`);
    }
    const swapsAxes = metadata.orientation >= 5 && metadata.orientation <= 8;
    const width = swapsAxes ? metadata.height : metadata.width;
    const height = swapsAxes ? metadata.width : metadata.height;
    return {
      absolutePath,
      basename,
      fileSha256: sha256(buffer),
      path: `./assets/images/ff14/${basename}`,
      role: width <= 64 && height <= 64 ? 'icon' : 'content',
      width,
      height,
      buffer,
    };
  }));
  const byBasename = new Map();
  for (const item of inspected) {
    const key = item.basename.normalize('NFKC').toLowerCase();
    const group = byBasename.get(key) || [];
    group.push(item);
    byBasename.set(key, group);
  }
  const output = [];
  for (const [basename, group] of [...byBasename.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const hashes = new Set(group.map((item) => item.fileSha256));
    if (hashes.size > 1) throw new Error(`local asset basename collision has different bytes: ${basename}`);
    const canonical = group[0];
    output.push({
      path: canonical.path,
      role: canonical.role,
      width: canonical.width,
      height: canonical.height,
      buffer: canonical.buffer,
      deduplicatedSourcePaths: group.map((item) => path.relative(workspaceRoot, item.absolutePath).split(path.sep).join('/')),
    });
  }
  return output;
}

function evidenceId({ sourcePage, sourceTxt, fileTitle, ordinal, eventId }) {
  return sha256(JSON.stringify({
    sourcePage: sourcePage.title,
    sourceTxt,
    fileTitle,
    ordinal,
    eventId,
  }));
}

function makeAuditRejection(assignment, reasonCode, detail = null) {
  return {
    ...assignment,
    reasonCode,
    detail,
  };
}

async function resolveCachedThumbnail(workspaceRoot, localPath) {
  if (typeof localPath !== 'string' || !localPath.trim()) {
    throw new Error('thumbnail index record lacks localPath.');
  }
  const lexicalRoot = path.resolve(workspaceRoot);
  const thumbnailPath = path.resolve(lexicalRoot, localPath);
  const lexicalRelative = path.relative(lexicalRoot, thumbnailPath);
  if (!lexicalRelative || lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
    throw new Error('thumbnail localPath escapes the workspace.');
  }
  const linkStat = await fs.lstat(thumbnailPath);
  if (linkStat.isSymbolicLink()) throw new Error('thumbnail localPath must not be a symbolic link.');
  const fileStat = await fs.stat(thumbnailPath);
  if (!fileStat.isFile()) throw new Error('thumbnail localPath must name a regular file.');
  const [realRoot, realThumbnail] = await Promise.all([fs.realpath(lexicalRoot), fs.realpath(thumbnailPath)]);
  const realRelative = path.relative(realRoot, realThumbnail);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('thumbnail localPath resolves outside the workspace.');
  }
  return thumbnailPath;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function expectedSharpFormat(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpeg';
  if (mime === 'image/webp') return 'webp';
  throw new Error(`unsupported thumbnail MIME: ${mime}`);
}

function evidenceExtension(mime) {
  const format = expectedSharpFormat(mime);
  return format === 'jpeg' ? 'jpg' : format;
}

function isThinDecorativeImage(info) {
  const width = Number(info?.originalWidth);
  const height = Number(info?.originalHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const shorter = Math.min(width, height);
  const longer = Math.max(width, height);
  return shorter <= 8 && longer / shorter >= 8;
}

function requireCanonicalIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be an ISO timestamp.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function validateCapturedSourceIdentity(item, info, label) {
  if (!info) throw new Error(`${label} is absent from image-info capture: ${item?.fileTitle}`);
  requirePositiveInteger(info.originalWidth, `captured original width for ${item.fileTitle}`);
  requirePositiveInteger(info.originalHeight, `captured original height for ${item.fileTitle}`);
  if (
    item.originalUrl !== info.originalUrl
    || item.originalSha1 !== info.originalSha1
    || item.thumbUrl !== info.thumbUrl
    || item.originalWidth !== info.originalWidth
    || item.originalHeight !== info.originalHeight
    || item.mime !== info.mime
  ) throw new Error(`${label} evidence does not match image-info capture: ${item.fileTitle}`);
}

function validateThumbnailIndex(index, imageInfoCapture, imageInfoByTitle) {
  if (index?.schemaVersion !== THUMBNAIL_INDEX_SCHEMA_VERSION) {
    throw new Error(`thumbnail index schemaVersion must be ${THUMBNAIL_INDEX_SCHEMA_VERSION}.`);
  }
  if (index?.policyVersion !== THUMBNAIL_POLICY_VERSION) {
    throw new Error(`thumbnail index policyVersion must be ${THUMBNAIL_POLICY_VERSION}.`);
  }
  if (index.captureSha256 !== jsonSha256(imageInfoCapture)) {
    throw new Error('thumbnail index captureSha256 does not bind the image-info capture.');
  }
  const records = requireArray(index.records, 'thumbnail index records');
  const downloadRejected = requireArray(index.downloadRejected, 'thumbnail index downloadRejected');
  if (!Number.isSafeInteger(index.totalBytes) || index.totalBytes < 0 || index.totalBytes > MAX_THUMBNAIL_TOTAL_BYTES) {
    throw new Error('thumbnail index totalBytes is outside the strict transfer budget.');
  }
  if (index.candidateCount !== records.length + downloadRejected.length) {
    throw new Error('thumbnail index candidateCount does not equal records plus downloadRejected.');
  }
  const limits = index.limits;
  if (
    !limits
    || !Number.isSafeInteger(limits.maxTotalBytes)
    || limits.maxTotalBytes <= 0
    || limits.maxTotalBytes > MAX_THUMBNAIL_TOTAL_BYTES
    || !Number.isSafeInteger(limits.maxFileBytes)
    || limits.maxFileBytes <= 0
    || limits.maxFileBytes > MAX_THUMBNAIL_FILE_BYTES
    || limits.maxFileBytes > limits.maxTotalBytes
    || !Number.isSafeInteger(limits.timeoutMs)
    || limits.timeoutMs <= 0
    || limits.concurrency !== 1
    || limits.redirects !== 'error'
    || limits.acceptEncoding !== 'identity'
  ) throw new Error('thumbnail index limits do not satisfy the strict download policy.');
  const physicalFiles = new Map();
  const accountedTitles = new Set();
  for (const item of records) {
    const key = sourceKey(item?.fileTitle);
    if (!key || accountedTitles.has(key)) throw new Error(`thumbnail candidate is accounted more than once: ${item?.fileTitle}`);
    accountedTitles.add(key);
    const info = imageInfoByTitle.get(key);
    validateCapturedSourceIdentity(item, info, 'thumbnail index item');
    requirePositiveInteger(info.thumbWidth, `captured thumbnail width for ${item.fileTitle}`);
    requirePositiveInteger(info.thumbHeight, `captured thumbnail height for ${item.fileTitle}`);
    requirePositiveInteger(item.bytes, `thumbnail bytes for ${item.fileTitle}`);
    requirePositiveInteger(item.declaredLength, `thumbnail declaredLength for ${item.fileTitle}`);
    requirePositiveInteger(item.decodedWidth, `thumbnail decodedWidth for ${item.fileTitle}`);
    requirePositiveInteger(item.decodedHeight, `thumbnail decodedHeight for ${item.fileTitle}`);
    if (item.bytes !== item.declaredLength) throw new Error(`thumbnail declared byte count mismatch: ${item.fileTitle}`);
    if (item.bytes > limits.maxFileBytes) throw new Error(`thumbnail record exceeds strict per-file budget: ${item.fileTitle}`);
    if (item.requestedUrl !== item.thumbUrl || item.finalUrl !== item.thumbUrl) {
      throw new Error(`thumbnail URL evidence mismatch: ${item.fileTitle}`);
    }
    if (item.receivedMime !== item.mime) throw new Error(`thumbnail received MIME mismatch: ${item.fileTitle}`);
    if (item.decodedWidth !== info.thumbWidth || item.decodedHeight !== info.thumbHeight) {
      throw new Error(`thumbnail decoded dimensions disagree with image-info capture: ${item.fileTitle}`);
    }
    if (item.contentEncoding !== 'identity') throw new Error(`thumbnail content encoding mismatch: ${item.fileTitle}`);
    if (!/^[a-f0-9]{64}$/iu.test(item.sha256 || '')) throw new Error(`thumbnail SHA-256 is invalid: ${item.fileTitle}`);
    expectedSharpFormat(item.receivedMime);
    if (typeof item.physicalFileId !== 'string' || !item.physicalFileId) {
      throw new Error(`thumbnail physicalFileId is invalid: ${item.fileTitle}`);
    }
    const existing = physicalFiles.get(item.physicalFileId);
    if (existing && (existing.bytes !== item.bytes || existing.sha256 !== item.sha256)) {
      throw new Error(`reused thumbnail physicalFileId has inconsistent bytes: ${item.physicalFileId}`);
    }
    if (!existing) physicalFiles.set(item.physicalFileId, { bytes: item.bytes, sha256: item.sha256 });
  }
  for (const item of downloadRejected) {
    const key = sourceKey(item?.fileTitle);
    if (!key || accountedTitles.has(key)) throw new Error(`thumbnail candidate is accounted more than once: ${item?.fileTitle}`);
    accountedTitles.add(key);
    const info = imageInfoByTitle.get(key);
    validateCapturedSourceIdentity(item, info, 'thumbnail download rejection');
    if (item.requestedUrl !== item.thumbUrl) {
      throw new Error(`thumbnail download rejection requested URL mismatch: ${item.fileTitle}`);
    }
    if (!DOWNLOAD_REJECTION_REASON_CODES.has(item.reasonCode)) {
      throw new Error(`thumbnail download rejection reason is not allowed: ${item.fileTitle}`);
    }
    requirePositiveInteger(item.declaredLength, `thumbnail rejected declaredLength for ${item.fileTitle}`);
    requirePositiveInteger(item.limit, `thumbnail rejected limit for ${item.fileTitle}`);
    if (item.limit !== limits.maxFileBytes || item.declaredLength <= limits.maxFileBytes) {
      throw new Error(`thumbnail download rejection does not prove a declared per-file overflow: ${item.fileTitle}`);
    }
    requireCanonicalIsoTimestamp(item.rejectedAt, `thumbnail rejectedAt for ${item.fileTitle}`);
  }
  if (index.physicalFileCount !== physicalFiles.size) throw new Error('thumbnail index physicalFileCount is inconsistent.');
  const physicalBytes = [...physicalFiles.values()].reduce((total, item) => total + item.bytes, 0);
  if (physicalBytes !== index.totalBytes) throw new Error('thumbnail index totalBytes is inconsistent with physical files.');
}

async function ensureEvidenceDirectory(workspaceRoot, evidenceDir) {
  const lexicalWorkspace = path.resolve(workspaceRoot);
  const requiredRelative = DEFAULT_PATHS.evidenceDir;
  if (String(evidenceDir).split(path.sep).join('/') !== requiredRelative) {
    throw new Error(`thumbnail evidenceDir must remain ${requiredRelative}.`);
  }
  const rootStat = await fs.lstat(lexicalWorkspace);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('workspace root for thumbnail evidence must be a real directory.');
  }
  let cursor = lexicalWorkspace;
  for (const segment of requiredRelative.split('/')) {
    cursor = path.join(cursor, segment);
    try {
      const stats = await fs.lstat(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`thumbnail evidence directory component is unsafe: ${cursor}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await fs.mkdir(cursor);
    }
  }
  const [realWorkspace, realEvidence] = await Promise.all([
    fs.realpath(lexicalWorkspace),
    fs.realpath(cursor),
  ]);
  const relative = path.relative(realWorkspace, realEvidence);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('thumbnail evidence directory resolves outside the workspace.');
  }
  return cursor;
}

async function materialiseThumbnailEvidence({ workspaceRoot, evidenceDir, buffer, digest, mime }) {
  if (!Buffer.isBuffer(buffer) || sha256(buffer) !== digest) {
    throw new Error('thumbnail evidence bytes are detached from their SHA-256 digest.');
  }
  const root = await ensureEvidenceDirectory(workspaceRoot, evidenceDir);
  const filename = `${digest}.${evidenceExtension(mime)}`;
  const target = path.join(root, filename);
  const verifyExisting = async () => {
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`thumbnail evidence target is unsafe: ${target}`);
    }
    const existing = await fs.readFile(target);
    if (existing.length !== buffer.length || sha256(existing) !== digest) {
      throw new Error(`thumbnail evidence target conflicts with its content address: ${target}`);
    }
  };
  try {
    await verifyExisting();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    try {
      await fs.writeFile(target, buffer, { flag: 'wx' });
    } catch (writeError) {
      if (writeError?.code !== 'EEXIST') throw writeError;
    }
    await verifyExisting();
  }
  return `${DEFAULT_PATHS.evidenceDir}/${filename}`;
}

async function generateFF14MediaManifest(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const resolve = (filePath) => path.resolve(workspaceRoot, filePath);
  const [catalogInput, sourceCaptureInput, imageInfoInput, thumbnailInput, ff14DataInput, previousManifest] = await Promise.all([
    readJsonWithBytes(resolve(paths.catalog)),
    readJsonWithBytes(resolve(paths.sourceCapture)),
    readJsonWithBytes(resolve(paths.imageInfoCapture)),
    readJsonWithBytes(resolve(paths.thumbnailIndex)),
    readJsonWithBytes(resolve(paths.ff14Data)),
    readExistingManifest(resolve(paths.output)),
  ]);
  const pagesByTitle = capturePages(sourceCaptureInput.value);
  const capturedSources = selectCapturedSources(catalogInput.value, pagesByTitle);
  const imageInfoByTitle = flattenImageInfo(imageInfoInput.value);
  validateThumbnailIndex(thumbnailInput.value, imageInfoInput.value, imageInfoByTitle);
  const thumbnailIndexByTitle = indexByTitle(thumbnailInput.value?.records, 'thumbnail index records');
  const thumbnailDownloadRejectedByTitle = indexByTitle(
    thumbnailInput.value?.downloadRejected,
    'thumbnail index downloadRejected',
  );
  const indexedThumbnailBytes = Number.isFinite(thumbnailInput.value?.totalBytes)
    ? thumbnailInput.value.totalBytes
    : [...thumbnailIndexByTitle.values()].reduce((total, item) => total + (Number(item.bytes) || 0), 0);
  const localImages = await imageEntriesFromSources(capturedSources, workspaceRoot);

  const sourceImages = [];
  const rejected = [];
  const headingAudits = [];
  const assignmentSummaries = [];

  for (const { source, candidate, page } of capturedSources) {
    const wikitext = sourceWikitext(page);
    const parsedMedia = parseWikitextMedia(wikitext).map((media) => {
      const info = imageInfoByTitle.get(sourceKey(media.fileTitle));
      const decorative = isThinDecorativeImage(info);
      return {
        ...media,
        mime: info?.mime || null,
        isDecorative: decorative,
        role: decorative ? 'decorative' : undefined,
      };
    });
    const assignment = assignSourceMediaToEvents({ source, sourcePage: candidate.title, media: parsedMedia });
    rejected.push(...assignment.rejections);
    headingAudits.push(...assignment.headingAudits);
    assignmentSummaries.push(assignment.summary);

    for (const item of assignment.assignments) {
      const info = imageInfoByTitle.get(sourceKey(item.fileTitle));
      const thumbnail = thumbnailIndexByTitle.get(sourceKey(item.fileTitle));
      if (!info) {
        rejected.push(makeAuditRejection(item, 'missing-image-info'));
        continue;
      }
      if (!thumbnail) {
        const downloadRejection = thumbnailDownloadRejectedByTitle.get(sourceKey(item.fileTitle));
        rejected.push(makeAuditRejection(
          item,
          'missing-thumbnail-index',
          downloadRejection
            ? `${downloadRejection.reasonCode}: ${downloadRejection.declaredLength} > ${downloadRejection.limit}`
            : null,
        ));
        continue;
      }
      let thumbnailPath;
      try {
        thumbnailPath = await resolveCachedThumbnail(workspaceRoot, thumbnail.localPath);
      } catch (error) {
        rejected.push(makeAuditRejection(item, 'unsafe-thumbnail-local-path', error.message));
        continue;
      }
      let thumbnailBuffer;
      try {
        thumbnailBuffer = await fs.readFile(thumbnailPath);
      } catch (error) {
        rejected.push(makeAuditRejection(item, 'missing-thumbnail-file', error.code || error.message));
        continue;
      }
      if (sha256(thumbnailBuffer) !== thumbnail.sha256) {
        rejected.push(makeAuditRejection(item, 'thumbnail-sha256-mismatch'));
        continue;
      }
      if (thumbnailBuffer.length !== thumbnail.bytes || thumbnailBuffer.length !== thumbnail.declaredLength) {
        rejected.push(makeAuditRejection(item, 'thumbnail-byte-count-mismatch'));
        continue;
      }
      let decoded;
      try {
        decoded = await sharp(thumbnailBuffer).metadata();
      } catch (error) {
        rejected.push(makeAuditRejection(item, 'thumbnail-decode-failed', error.message));
        continue;
      }
      if (
        decoded.width !== thumbnail.decodedWidth
        || decoded.height !== thumbnail.decodedHeight
        || decoded.format !== expectedSharpFormat(thumbnail.receivedMime)
      ) {
        rejected.push(makeAuditRejection(item, 'thumbnail-decoded-metadata-mismatch'));
        continue;
      }
      if (
        decoded.width !== info.thumbWidth
        || decoded.height !== info.thumbHeight
        || !Number.isSafeInteger(info.originalWidth)
        || info.originalWidth <= 0
        || !Number.isSafeInteger(info.originalHeight)
        || info.originalHeight <= 0
      ) {
        rejected.push(makeAuditRejection(item, 'thumbnail-image-info-dimensions-mismatch'));
        continue;
      }
      const evidencePath = await materialiseThumbnailEvidence({
        workspaceRoot,
        evidenceDir: paths.evidenceDir,
        buffer: thumbnailBuffer,
        digest: thumbnail.sha256,
        mime: thumbnail.receivedMime,
      });
      const stableId = evidenceId({
        sourcePage: page,
        sourceTxt: source.sourceTxt,
        fileTitle: info.fileTitle,
        ordinal: item.ordinal,
        eventId: item.eventId,
      });
      const pageUrl = candidate.url || null;
      sourceImages.push({
        id: stableId,
        recordId: item.eventId,
        sourcePage: {
          pageId: page.pageid,
          title: page.title,
          url: pageUrl,
          wikitextSha256: sha256(Buffer.from(wikitext, 'utf8')),
        },
        sourceFileTitle: source.sourceTxt,
        sectionPath: item.sectionPath,
        sectionTrail: item.sectionTrail.map((heading) => ({
          ...heading,
          // Persist source offsets as one-based evidence so zero never doubles
          // as a missing-value sentinel during production admission.
          position: heading.position + 1,
        })),
        fileTitle: info.fileTitle,
        originalUrl: info.originalUrl,
        originalSha1: info.originalSha1,
        originalWidth: info.originalWidth,
        originalHeight: info.originalHeight,
        caption: item.caption,
        ordinal: item.ordinal,
        thumbnail: {
          url: thumbnail.thumbUrl,
          width: decoded.width,
          height: decoded.height,
          bytes: thumbnail.bytes,
          sha256: thumbnail.sha256,
          mime: thumbnail.receivedMime,
          evidencePath,
        },
        buffer: thumbnailBuffer,
      });
    }
  }

  const recovery = await createMediaRecoveryManifest({ sourceImages, localImages });
  const preservedPublicOriginals = preservePublicOriginals(recovery.records, previousManifest);
  const manifest = {
    ...recovery,
    generation: {
      sourceCatalogSha256: jsonSha256(catalogInput.value),
      wikiCaptureSha256: jsonSha256(sourceCaptureInput.value),
      imageInfoCaptureSha256: jsonSha256(imageInfoInput.value),
      thumbnailIndexSha256: jsonSha256(thumbnailInput.value),
      ff14DataSha256: jsonSha256(ff14DataInput.value),
      generatedAt: typeof options.now === 'function' ? options.now() : new Date().toISOString(),
      thumbnailBytes: indexedThumbnailBytes,
    },
    audit: {
      capturedSourceCount: capturedSources.length,
      sourceImageCount: sourceImages.length,
      assignmentSummaries,
      headingAudits,
      rejected,
      preservedPublicOriginals,
    },
  };
  if (previousManifest?.originalDownload?.policyVersion === 'ff14-public-originals/v1-direct-identity-bounded') {
    manifest.originalDownload = previousManifest.originalDownload;
  }
  if (options.write !== false) {
    const outputPath = resolve(paths.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return manifest;
}

if (require.main === module) {
  generateFF14MediaManifest()
    .then((manifest) => process.stdout.write(`FF14 media manifest prepared: ${manifest.records.length} source records.\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_PATHS,
  generateFF14MediaManifest,
  normaliseFileTitle,
  preservePublicOriginals,
};
