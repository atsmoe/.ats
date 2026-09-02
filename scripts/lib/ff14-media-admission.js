'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_DHASH_OPTIONS,
  DEFAULT_MATCH_OPTIONS,
  createDHash,
  evaluateMediaMatchEvidence,
} = require('./ff14-media-recovery.js');

const SAFE_IMAGE_PREFIX = './assets/images/ff14/';
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const SHA1_PATTERN = /^[0-9a-f]{40}$/iu;
const DHASH_PATTERN = /^[0-9a-f]{16}$/iu;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;
const MAX_THUMBNAIL_FILE_BYTES = 128 * 1024;
const EVIDENCE_PATH_PREFIX = 'scripts/data/ff14-media-thumbnails/';
const EVIDENCE_ROOT_PARTS = Object.freeze(['scripts', 'data', 'ff14-media-thumbnails']);

const PRODUCTION_DHASH_OPTIONS = Object.freeze({
  width: DEFAULT_DHASH_OPTIONS.width,
  height: DEFAULT_DHASH_OPTIONS.height,
  bitLength: (DEFAULT_DHASH_OPTIONS.width - 1) * DEFAULT_DHASH_OPTIONS.height,
});

const PRODUCTION_MATCH_OPTIONS = Object.freeze({
  maxDistance: DEFAULT_MATCH_OPTIONS.maxDistance,
  minDistanceMargin: DEFAULT_MATCH_OPTIONS.minDistanceMargin,
  maxColorDistance: DEFAULT_MATCH_OPTIONS.maxColorDistance,
  maxAspectRatioDeltaPercent: DEFAULT_MATCH_OPTIONS.maxAspectRatioDeltaPercent,
});

const DEPLOYED_IMAGE_MAX_WIDTH = 960;
const MIN_NATURAL_RESOLUTION_RATIO = 1.5;
const MIN_ORIGINAL_DIMENSION_RATIO = 0.95;
const PUBLIC_ORIGINAL_PREFIX = './assets/images/ff14/public-originals/';

function deriveClearDisplayDimensions({ width, height }) {
  if (!positiveInteger(width) || !positiveInteger(height)) {
    throw new TypeError('clear display dimensions require positive image dimensions.');
  }
  const deployedWidth = Math.min(width, DEPLOYED_IMAGE_MAX_WIDTH);
  const deployedHeight = Math.round((height * deployedWidth) / width);
  return {
    displayWidth: Math.floor(deployedWidth / MIN_NATURAL_RESOLUTION_RATIO),
    displayHeight: Math.floor(deployedHeight / MIN_NATURAL_RESOLUTION_RATIO),
  };
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validSectionTrail(source) {
  if (!Array.isArray(source?.sectionPath) || !Array.isArray(source?.sectionTrail)) return false;
  if (source.sectionPath.length !== source.sectionTrail.length) return false;
  let previousPosition = 0;
  for (let index = 0; index < source.sectionPath.length; index += 1) {
    const title = source.sectionPath[index];
    const heading = source.sectionTrail[index];
    if (
      typeof title !== 'string'
      || !title.trim()
      || heading?.title !== title
      || !positiveInteger(heading?.level)
      || !positiveInteger(heading?.position)
      || heading.position <= previousPosition
    ) return false;
    previousPosition = heading.position;
  }
  return true;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Json(value) {
  return sha256(JSON.stringify(value));
}

function isSafePublicImagePath(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith(SAFE_IMAGE_PREFIX)) return false;
  if (
    publicPath.includes('\\')
    || publicPath.includes('\0')
    || /[%?#]/u.test(publicPath)
    || /[\u0000-\u001f\u007f]/u.test(publicPath)
    || /^[a-z]+:/iu.test(publicPath)
  ) return false;

  const relative = publicPath.slice(2);
  const suffix = publicPath.slice(SAFE_IMAGE_PREFIX.length);
  if (!suffix || suffix.startsWith('/') || suffix.endsWith('/') || suffix.includes('//')) return false;
  const segments = suffix.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false;
  if (!IMAGE_EXTENSIONS.has(path.posix.extname(suffix).toLowerCase())) return false;

  const normalised = path.posix.normalize(relative);
  return normalised === relative
    && normalised.startsWith(SAFE_IMAGE_PREFIX.slice(2))
    && !normalised.includes('/../');
}

function isSafePublicOriginalPath(publicPath) {
  if (!isSafePublicImagePath(publicPath) || !publicPath.startsWith(PUBLIC_ORIGINAL_PREFIX)) return false;
  return /^[a-f0-9]{40}\.(?:png|jpe?g|webp)$/iu.test(publicPath.slice(PUBLIC_ORIGINAL_PREFIX.length));
}

function expectedFormatForMime(mime) {
  const value = text(mime).toLowerCase();
  if (value === 'image/png') return 'png';
  if (value === 'image/jpeg') return 'jpeg';
  if (value === 'image/webp') return 'webp';
  return null;
}

function expectedEvidenceExtension(mime) {
  const format = expectedFormatForMime(mime);
  return format === 'jpeg' ? 'jpg' : format;
}

function isSafeEvidencePath(evidencePath, expectedSha256, mime) {
  if (typeof evidencePath !== 'string' || !evidencePath.startsWith(EVIDENCE_PATH_PREFIX)) return false;
  if (
    evidencePath.includes('\\')
    || evidencePath.includes('\0')
    || /[%?#]/u.test(evidencePath)
    || /[\u0000-\u001f\u007f]/u.test(evidencePath)
    || /^[a-z]+:/iu.test(evidencePath)
  ) return false;
  const basename = evidencePath.slice(EVIDENCE_PATH_PREFIX.length);
  const extension = expectedEvidenceExtension(mime);
  const digest = text(expectedSha256).toLowerCase();
  return Boolean(
    extension
    && SHA256_PATTERN.test(digest)
    && basename === `${digest}.${extension}`
    && path.posix.normalize(evidencePath) === evidencePath,
  );
}

function safeHttpsUrl(value, hostname, pathPrefix = '/') {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === hostname
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname.startsWith(pathPrefix);
  } catch {
    return false;
  }
}

function validMeanRgb(value) {
  return Boolean(
    value
    && ['r', 'g', 'b'].every(channel => (
      Number.isInteger(value[channel])
      && value[channel] >= 0
      && value[channel] <= 255
    )),
  );
}

function collectRecords(data) {
  const all = [];
  const byId = new Map();

  function add(record) {
    all.push(record);
    const group = byId.get(record.id) || [];
    group.push(record);
    byId.set(record.id, group);
  }

  function visitBranch(branch) {
    for (const era of branch.eras || []) {
      for (const record of era.events || []) add(record);
    }
    for (const record of branch.endings || []) add(record);
    for (const child of branch.subBranches || []) visitBranch(child);
  }

  for (const entity of data.subEntities || []) {
    for (const branch of entity.timeline?.branches || []) visitBranch(branch);
  }
  return { all, byId };
}

function stripLegacyImages(records) {
  let removed = 0;
  for (const record of records) {
    if (Array.isArray(record.images)) removed += record.images.length;
    delete record.images;
  }
  return removed;
}

function hasExactProductionPolicy(manifest) {
  const algorithm = manifest?.algorithm;
  const matching = manifest?.matching;
  const pool = manifest?.candidatePool;
  return Boolean(
    algorithm
    && algorithm.name === 'dhash'
    && algorithm.width === PRODUCTION_DHASH_OPTIONS.width
    && algorithm.height === PRODUCTION_DHASH_OPTIONS.height
    && algorithm.bitLength === PRODUCTION_DHASH_OPTIONS.bitLength
    && matching
    && matching.maxDistance === PRODUCTION_MATCH_OPTIONS.maxDistance
    && matching.minDistanceMargin === PRODUCTION_MATCH_OPTIONS.minDistanceMargin
    && matching.maxColorDistance === PRODUCTION_MATCH_OPTIONS.maxColorDistance
    && matching.maxAspectRatioDeltaPercent === PRODUCTION_MATCH_OPTIONS.maxAspectRatioDeltaPercent
    && pool
    && Array.isArray(pool.contentImages)
    && pool.eligibleContentImages === pool.contentImages.length
    && pool.contentImages.length >= 2,
  );
}

function hasCompleteGeneration(manifest, ff14Data) {
  const generation = manifest?.generation;
  return Boolean(
    generation
    && SHA256_PATTERN.test(text(generation.sourceCatalogSha256))
    && SHA256_PATTERN.test(text(generation.wikiCaptureSha256))
    && SHA256_PATTERN.test(text(generation.imageInfoCaptureSha256))
    && SHA256_PATTERN.test(text(generation.thumbnailIndexSha256))
    && SHA256_PATTERN.test(text(generation.ff14DataSha256))
    && generation.ff14DataSha256.toLowerCase() === sha256Json(ff14Data)
    && !Number.isNaN(Date.parse(generation.generatedAt))
    && Number.isInteger(generation.thumbnailBytes)
    && generation.thumbnailBytes >= 0
    && generation.thumbnailBytes <= MAX_THUMBNAIL_BYTES,
  );
}

function hasCompleteSource(source) {
  const page = source?.sourcePage;
  const thumbnail = source?.thumbnail;
  return Boolean(
    text(source?.id)
    && text(source?.recordId)
    && page
    && (positiveInteger(page.pageId) || positiveInteger(page.pageid))
    && text(page.title)
    && safeHttpsUrl(text(page.url), 'ff14.huijiwiki.com', '/wiki/')
    && SHA256_PATTERN.test(text(page.wikitextSha256))
    && text(source.sourceFileTitle)
    && validSectionTrail(source)
    && text(source.fileTitle)
    && safeHttpsUrl(text(source.originalUrl), 'huiji-public.huijistatic.com', '/ff14/uploads/')
    && SHA1_PATTERN.test(text(source.originalSha1))
    && positiveInteger(source.originalWidth)
    && positiveInteger(source.originalHeight)
    && positiveInteger(source.ordinal)
    && thumbnail
    && positiveInteger(thumbnail.width)
    && positiveInteger(thumbnail.height)
    && SHA256_PATTERN.test(text(thumbnail.sha256))
    && safeHttpsUrl(text(thumbnail.url), 'huiji-thumb.huijistatic.com', '/ff14/uploads/thumb/')
    && positiveInteger(thumbnail.bytes)
    && thumbnail.bytes <= MAX_THUMBNAIL_FILE_BYTES
    && IMAGE_MIME.has(text(thumbnail.mime).toLowerCase())
    && isSafeEvidencePath(thumbnail.evidencePath, thumbnail.sha256, thumbnail.mime),
  );
}

function readPngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (startOfFrame.has(marker)) {
      if (length < 7) return null;
      return {
        format: 'jpeg',
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 30
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) return null;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buffer.length) return null;
    if (type === 'VP8X' && size >= 10) {
      return {
        format: 'webp',
        width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
        height: 1 + buffer.readUIntLE(dataOffset + 7, 3),
      };
    }
    if (type === 'VP8L' && size >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return {
        format: 'webp',
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
    if (
      type === 'VP8 '
      && size >= 10
      && buffer[dataOffset + 3] === 0x9d
      && buffer[dataOffset + 4] === 0x01
      && buffer[dataOffset + 5] === 0x2a
    ) {
      return {
        format: 'webp',
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    offset = dataOffset + size + (size % 2);
  }
  return null;
}

function readImageDimensions(buffer) {
  return readPngDimensions(buffer) || readJpegDimensions(buffer) || readWebpDimensions(buffer);
}

async function pathContainsSymbolicLink(rootPath, targetPath) {
  const lexicalRoot = path.resolve(rootPath);
  const lexicalTarget = path.resolve(targetPath);
  if (!pathIsInside(lexicalRoot, lexicalTarget)) return true;
  const relative = path.relative(lexicalRoot, lexicalTarget);
  const chain = [lexicalRoot];
  let cursor = lexicalRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    chain.push(cursor);
  }
  for (const item of chain) {
    const stats = await fs.promises.lstat(item);
    if (stats.isSymbolicLink()) return true;
  }
  return false;
}

async function defaultAssetInspector(localPath, _descriptor, context = {}) {
  try {
    const rootPath = path.resolve(context.rootPath || path.dirname(localPath));
    const stats = await fs.promises.lstat(localPath);
    const isSymbolicLink = stats.isSymbolicLink() || await pathContainsSymbolicLink(rootPath, localPath);
    const realPath = await fs.promises.realpath(localPath);
    if (isSymbolicLink) {
      return { exists: true, isFile: false, isSymbolicLink: true, realPath };
    }
    const buffer = await fs.promises.readFile(realPath);
    const image = readImageDimensions(buffer);
    return {
      exists: true,
      isFile: stats.isFile(),
      isSymbolicLink: false,
      realPath,
      buffer,
      sha256: sha256(buffer),
      sha1: crypto.createHash('sha1').update(buffer).digest('hex'),
      width: image?.width ?? null,
      height: image?.height ?? null,
      format: image?.format ?? null,
    };
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) return { exists: false };
    return { exists: false, error: error?.message || String(error) };
  }
}

function dimensionsApproximateOriginal(candidate, source) {
  return candidate
    && positiveInteger(candidate.width)
    && positiveInteger(candidate.height)
    && positiveInteger(source?.originalWidth)
    && positiveInteger(source?.originalHeight)
    && candidate.width / source.originalWidth >= MIN_ORIGINAL_DIMENSION_RATIO
    && candidate.height / source.originalHeight >= MIN_ORIGINAL_DIMENSION_RATIO;
}

async function validatePublicOriginal(source, assetRoot, assetInspector) {
  const original = source?.publicOriginal;
  if (!original || typeof original !== 'object') return { errors: ['original-asset-missing'] };
  const errors = [];
  const publicPath = text(original.path);
  if (!isSafePublicOriginalPath(publicPath)) return { errors: ['original-asset-path-unsafe'] };
  if (text(original.originalUrl) !== text(source.originalUrl) || text(original.originalSha1).toLowerCase() !== text(source.originalSha1).toLowerCase()) {
    return { errors: ['original-asset-source-identity-mismatch'] };
  }
  if (!SHA256_PATTERN.test(text(original.sha256)) || !SHA1_PATTERN.test(text(original.sha1))) errors.push('original-asset-hash-metadata-invalid');
  if (!positiveInteger(original.bytes) || !positiveInteger(original.width) || !positiveInteger(original.height)) errors.push('original-asset-metadata-invalid');
  if (!IMAGE_MIME.has(text(original.mime).toLowerCase()) || !Number.isFinite(Date.parse(original.downloadedAt))) errors.push('original-asset-provenance-invalid');
  const ff14Root = path.resolve(assetRoot, 'assets', 'images', 'ff14');
  const localPath = toLocalAssetPath(assetRoot, publicPath);
  const inspected = await inspectBoundImage({ inspector: assetInspector, localPath, descriptor: original, rootPath: ff14Root, label: 'public original' });
  errors.push(...inspected.errors);
  if (!inspected.buffer || !inspected.fingerprint) return { errors };
  const actualSha256 = sha256(inspected.buffer);
  const actualSha1 = crypto.createHash('sha1').update(inspected.buffer).digest('hex');
  if (actualSha256 !== text(original.sha256).toLowerCase()) errors.push('original-asset-sha256-mismatch');
  if (actualSha1 !== text(original.sha1).toLowerCase() || actualSha1 !== text(source.originalSha1).toLowerCase()) errors.push('original-asset-sha1-mismatch');
  if (inspected.fingerprint.imageWidth !== source.originalWidth || inspected.fingerprint.imageHeight !== source.originalHeight) errors.push('original-asset-dimensions-mismatch');
  if (original.width !== source.originalWidth || original.height !== source.originalHeight || original.width !== inspected.fingerprint.imageWidth || original.height !== inspected.fingerprint.imageHeight) errors.push('original-asset-declared-dimensions-mismatch');
  if (original.bytes !== inspected.buffer.length) errors.push('original-asset-byte-count-mismatch');
  return { errors, asset: errors.length === 0 ? { path: publicPath, width: original.width, height: original.height } : null };
}

function toLocalAssetPath(assetRoot, publicPath) {
  const relative = publicPath.slice(2).split('/');
  return path.resolve(assetRoot, ...relative);
}

function pathIsInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveRealRoot(rootPath) {
  try {
    return await fs.promises.realpath(rootPath);
  } catch {
    return path.resolve(rootPath);
  }
}

function equalMeanRgb(left, right) {
  return validMeanRgb(left)
    && validMeanRgb(right)
    && left.r === right.r
    && left.g === right.g
    && left.b === right.b;
}

async function inspectBoundImage({ inspector, localPath, descriptor, rootPath, label }) {
  let inspection;
  try {
    inspection = await inspector(localPath, descriptor, { rootPath });
  } catch (error) {
    return { errors: [`${label} could not be inspected: ${error?.message || String(error)}`] };
  }
  const errors = [];
  if (!inspection?.exists) return { errors: [`${label} local file is missing.`] };
  if (inspection.isSymbolicLink === true) errors.push(`${label} local path contains a symbolic link.`);
  if (inspection.isFile !== true) errors.push(`${label} local path is not a regular file.`);
  const realRoot = await resolveRealRoot(rootPath);
  if (!text(inspection.realPath) || !pathIsInside(realRoot, path.resolve(inspection.realPath))) {
    errors.push(`${label} real path escapes its allowed directory.`);
  }
  if (!Buffer.isBuffer(inspection.buffer)) {
    errors.push(`${label} inspector did not provide the real image bytes.`);
    return { errors };
  }
  const buffer = Buffer.from(inspection.buffer);
  let fingerprint;
  try {
    fingerprint = await createDHash(buffer, PRODUCTION_DHASH_OPTIONS);
  } catch (error) {
    errors.push(`${label} image bytes cannot be decoded: ${error?.message || String(error)}`);
  }
  return { errors, buffer, fingerprint };
}

async function validateCandidatePool(manifest, assetRoot, assetInspector) {
  const errors = [];
  const candidates = Array.isArray(manifest?.candidatePool?.contentImages)
    ? manifest.candidatePool.contentImages
    : [];
  const seenPaths = new Set();
  const ff14Root = path.resolve(assetRoot, 'assets', 'images', 'ff14');
  const verifiedCandidates = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const label = `candidatePool.contentImages[${index}]`;
    const candidatePath = text(candidate?.path);
    if (!isSafePublicImagePath(candidatePath)) errors.push(`${label} has an unsafe public path.`);
    if (candidate?.role !== 'content') errors.push(`${label} must use role "content".`);
    if (!positiveInteger(candidate?.width) || !positiveInteger(candidate?.height)) {
      errors.push(`${label} has invalid dimensions.`);
    }
    if (!DHASH_PATTERN.test(text(candidate?.dHash))) errors.push(`${label} has invalid dHash evidence.`);
    if (!validMeanRgb(candidate?.meanRgb)) errors.push(`${label} has invalid mean RGB evidence.`);
    if (!IMAGE_FORMATS.has(text(candidate?.format).toLowerCase())) errors.push(`${label} has invalid format evidence.`);
    if (!SHA256_PATTERN.test(text(candidate?.fileSha256))) errors.push(`${label} has invalid file SHA-256 evidence.`);
    if (seenPaths.has(candidatePath)) errors.push(`${label} duplicates public path "${candidatePath}".`);
    seenPaths.add(candidatePath);

    if (!isSafePublicImagePath(candidatePath)) continue;
    const localPath = toLocalAssetPath(assetRoot, candidatePath);
    if (!pathIsInside(ff14Root, localPath)) {
      errors.push(`${label} resolves outside the FFXIV asset directory.`);
      continue;
    }
    const inspected = await inspectBoundImage({
      inspector: assetInspector,
      localPath,
      descriptor: candidate,
      rootPath: ff14Root,
      label,
    });
    errors.push(...inspected.errors);
    if (!inspected.buffer || !inspected.fingerprint) continue;
    const actualSha256 = sha256(inspected.buffer);
    const actual = inspected.fingerprint;
    if (actualSha256 !== text(candidate.fileSha256).toLowerCase()) {
      errors.push(`${label} local asset SHA-256 does not match the manifest.`);
    }
    if (actual.imageWidth !== candidate.width || actual.imageHeight !== candidate.height) {
      errors.push(`${label} local asset dimensions do not match the manifest.`);
    }
    if (text(actual.format).toLowerCase() !== text(candidate.format).toLowerCase()) {
      errors.push(`${label} local asset format does not match the manifest.`);
    }
    if (actual.hex !== text(candidate.dHash).toLowerCase() || !equalMeanRgb(actual.meanRgb, candidate.meanRgb)) {
      errors.push(`${label} local asset fingerprint does not match the manifest.`);
    }
    verifiedCandidates.push({
      ...candidate,
      width: actual.imageWidth,
      height: actual.imageHeight,
      format: actual.format,
      dHash: actual.hex,
      meanRgb: actual.meanRgb,
      fileSha256: actualSha256,
    });
  }

  return { candidates: verifiedCandidates, errors };
}

async function validateSourceEvidence(records, workspaceRoot, evidenceRoot, evidenceInspector) {
  const errors = [];
  const fingerprints = new Array(records.length).fill(null);
  const expectedEvidenceRoot = path.resolve(workspaceRoot, ...EVIDENCE_ROOT_PARTS);
  if (path.resolve(evidenceRoot) !== expectedEvidenceRoot) {
    errors.push(`FFXIV thumbnail evidence root must be ${expectedEvidenceRoot}.`);
    return { errors, fingerprints };
  }
  try {
    const rootStats = await fs.promises.lstat(evidenceRoot);
    const [realWorkspace, realEvidence, linked] = await Promise.all([
      fs.promises.realpath(workspaceRoot),
      fs.promises.realpath(evidenceRoot),
      pathContainsSymbolicLink(workspaceRoot, evidenceRoot),
    ]);
    if (!rootStats.isDirectory() || linked || !pathIsInside(realWorkspace, realEvidence)) {
      errors.push('FFXIV thumbnail evidence directory is missing, symbolic, or outside the workspace.');
      return { errors, fingerprints };
    }
  } catch (error) {
    errors.push(`FFXIV thumbnail evidence directory cannot be verified: ${error?.message || String(error)}`);
    return { errors, fingerprints };
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const label = `records[${index}].source.thumbnail`;
    const thumbnail = record?.source?.thumbnail;
    if (!thumbnail || !isSafeEvidencePath(thumbnail.evidencePath, thumbnail.sha256, thumbnail.mime)) {
      errors.push(`${label} has an unsafe or non-content-addressed evidence path.`);
      continue;
    }
    const localPath = path.resolve(evidenceRoot, path.posix.basename(thumbnail.evidencePath));
    if (!pathIsInside(evidenceRoot, localPath)) {
      errors.push(`${label} evidence path escapes the evidence directory.`);
      continue;
    }
    const inspected = await inspectBoundImage({
      inspector: evidenceInspector,
      localPath,
      descriptor: thumbnail,
      rootPath: evidenceRoot,
      label,
    });
    errors.push(...inspected.errors);
    if (!inspected.buffer || !inspected.fingerprint) continue;
    const actualSha256 = sha256(inspected.buffer);
    const actual = inspected.fingerprint;
    if (inspected.buffer.length > MAX_THUMBNAIL_FILE_BYTES || inspected.buffer.length !== thumbnail.bytes) {
      errors.push(`${label} byte count does not match the manifest or exceeds the limit.`);
    }
    if (actualSha256 !== text(thumbnail.sha256).toLowerCase()) {
      errors.push(`${label} SHA-256 does not match the manifest.`);
    }
    if (actual.imageWidth !== thumbnail.width || actual.imageHeight !== thumbnail.height) {
      errors.push(`${label} dimensions do not match the manifest.`);
    }
    if (text(actual.format).toLowerCase() !== expectedFormatForMime(thumbnail.mime)) {
      errors.push(`${label} MIME does not match the decoded image format.`);
    }
    if (actual.hex !== text(record?.sourceDHash).toLowerCase() || !equalMeanRgb(actual.meanRgb, record?.sourceMeanRgb)) {
      errors.push(`${label} fingerprint does not match the source manifest record.`);
    }
    fingerprints[index] = {
      dHash: actual.hex,
      meanRgb: actual.meanRgb,
      width: actual.imageWidth,
      height: actual.imageHeight,
      format: actual.format,
      sha256: actualSha256,
    };
  }
  return { errors, fingerprints };
}

function candidateSnapshot(candidate) {
  if (!candidate) return null;
  return {
    path: candidate.path ?? null,
    role: candidate.role ?? null,
    width: candidate.width ?? null,
    height: candidate.height ?? null,
    dHash: candidate.dHash ?? null,
    meanRgb: candidate.meanRgb ?? null,
    format: candidate.format ?? null,
    fileSha256: candidate.fileSha256 ?? null,
    distance: candidate.distance ?? null,
    colorDistance: candidate.colorDistance ?? null,
    aspectRatioDeltaPercent: candidate.aspectRatioDeltaPercent ?? null,
  };
}

function matchSnapshot(match) {
  return {
    path: match?.path ?? null,
    nearest: candidateSnapshot(match?.nearest),
    secondNearest: candidateSnapshot(match?.secondNearest),
    distance: match?.distance ?? null,
    secondDistance: match?.secondDistance ?? null,
    distanceMargin: match?.distanceMargin ?? null,
    uniqueNearest: match?.uniqueNearest ?? null,
    hasGlobalSecondCandidate: match?.hasGlobalSecondCandidate ?? null,
    withinDistanceThreshold: match?.withinDistanceThreshold ?? null,
    withinColorThreshold: match?.withinColorThreshold ?? null,
    hasAspectRatioEvidence: match?.hasAspectRatioEvidence ?? null,
    withinAspectRatioThreshold: match?.withinAspectRatioThreshold ?? null,
    passesMargin: match?.passesMargin ?? null,
    accepted: match?.accepted ?? null,
    confidence: {
      score: match?.confidence?.score ?? null,
      level: match?.confidence?.level ?? null,
      reasonCodes: Array.isArray(match?.confidence?.reasonCodes) ? match.confidence.reasonCodes : null,
    },
  };
}

function recomputeRecordMatch(record, candidates, sourceFingerprint) {
  return evaluateMediaMatchEvidence({
    sourceDHash: sourceFingerprint.dHash,
    sourceMeanRgb: sourceFingerprint.meanRgb,
    sourceWidth: sourceFingerprint.width,
    sourceHeight: sourceFingerprint.height,
    candidates,
  }, PRODUCTION_MATCH_OPTIONS);
}

function cleanAlt(caption, fallback) {
  const value = text(caption)
    .replace(/<!--[^]*?-->/gu, ' ')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/gu, '$1')
    .replace(/\{\{[^]*?\}\}/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/''+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return value || fallback;
}

function sourceIdentity(source) {
  return [text(source?.fileTitle), text(source?.originalUrl), text(source?.originalSha1).toLowerCase()].join('\0');
}

function addCollisionReasons(evaluated) {
  const currentlyEligible = evaluated.filter(item => item.reasonCodes.length === 0);
  const byPath = new Map();
  const bySource = new Map();
  const byOrdinal = new Map();

  for (const item of currentlyEligible) {
    const localPath = item.recomputed.path;
    const identity = sourceIdentity(item.candidate.source);
    const ordinalKey = `${item.recordId}\0${item.candidate.source.ordinal}`;
    const pathGroup = byPath.get(localPath) || [];
    pathGroup.push(item);
    byPath.set(localPath, pathGroup);
    const sourceGroup = bySource.get(identity) || [];
    sourceGroup.push(item);
    bySource.set(identity, sourceGroup);
    const ordinalGroup = byOrdinal.get(ordinalKey) || [];
    ordinalGroup.push(item);
    byOrdinal.set(ordinalKey, ordinalGroup);
  }

  for (const group of byPath.values()) {
    if (new Set(group.map(item => sourceIdentity(item.candidate.source))).size > 1) {
      for (const item of group) item.reasonCodes.push('multiple-sources-share-local-path');
    }
  }
  for (const group of bySource.values()) {
    if (new Set(group.map(item => item.recomputed.path)).size > 1) {
      for (const item of group) item.reasonCodes.push('source-maps-to-multiple-local-paths');
    }
  }
  for (const group of byOrdinal.values()) {
    if (group.length > 1) {
      for (const item of group) item.reasonCodes.push('duplicate-source-ordinal');
    }
  }
}

async function applyFf14MediaAdmission(ff14Data, manifest, options = {}) {
  if (!ff14Data || typeof ff14Data !== 'object') throw new TypeError('ff14Data must be an object.');
  const data = jsonClone(ff14Data);
  const recordIndex = collectRecords(data);
  const removedLegacyImages = stripLegacyImages(recordIndex.all);
  const errors = [];
  const rejections = [];
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(__dirname, '..', '..'));
  const assetRoot = path.resolve(options.assetRoot || path.join(workspaceRoot, 'src'));
  const evidenceRoot = path.resolve(options.evidenceRoot || path.join(workspaceRoot, ...EVIDENCE_ROOT_PARTS));
  const sharedInspector = options.inspector;
  const assetInspector = options.assetInspector || sharedInspector || defaultAssetInspector;
  const evidenceInspector = options.evidenceInspector || sharedInspector || defaultAssetInspector;

  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.records)) {
    errors.push('FFXIV media manifest must use schemaVersion 1 and contain records[].');
  }
  if (!hasCompleteGeneration(manifest, ff14Data)) {
    errors.push('FFXIV media manifest generation evidence is incomplete or stale.');
  }
  if (!hasExactProductionPolicy(manifest)) {
    errors.push('FFXIV media manifest does not use the fixed production matching policy.');
  }

  for (const [recordId, group] of recordIndex.byId) {
    if (group.length > 1) errors.push(`Duplicate FFXIV record id "${recordId}" appears ${group.length} times.`);
  }

  const candidates = Array.isArray(manifest?.records) ? manifest.records : [];
  const idCounts = new Map();
  for (const candidate of candidates) {
    const evidenceId = text(candidate?.source?.id);
    if (evidenceId) idCounts.set(evidenceId, (idCounts.get(evidenceId) || 0) + 1);
  }
  for (const [evidenceId, count] of idCounts) {
    if (count > 1) errors.push(`Duplicate evidence id "${evidenceId}" appears ${count} times.`);
  }

  const [poolValidation, sourceValidation] = await Promise.all([
    validateCandidatePool(manifest, assetRoot, assetInspector),
    validateSourceEvidence(candidates, workspaceRoot, evidenceRoot, evidenceInspector),
  ]);
  errors.push(...poolValidation.errors);
  errors.push(...sourceValidation.errors);
  const globallyInvalid = errors.length > 0;

  const publicOriginalValidation = await Promise.all(candidates.map((candidate) => (
    validatePublicOriginal(candidate?.source, assetRoot, assetInspector)
  )));

  const evaluated = candidates.map((candidate, index) => {
    const evidenceId = text(candidate?.source?.id) || `record-${index + 1}`;
    const recordId = text(candidate?.source?.recordId);
    const reasonCodes = [];
    let recomputed = null;

    if (globallyInvalid) reasonCodes.push('global-manifest-invalid');
    if (!hasCompleteSource(candidate?.source)) reasonCodes.push('incomplete-source-provenance');
    const sourceFingerprint = sourceValidation.fingerprints[index];
    if (!DHASH_PATTERN.test(text(candidate?.sourceDHash)) || !validMeanRgb(candidate?.sourceMeanRgb) || !sourceFingerprint) {
      reasonCodes.push('source-fingerprint-incomplete');
    }
    if ((recordIndex.byId.get(recordId)?.length || 0) !== 1) reasonCodes.push('unknown-or-duplicate-record-id');
    if (idCounts.get(evidenceId) > 1) reasonCodes.push('duplicate-evidence-id');

    if (!globallyInvalid && !reasonCodes.includes('source-fingerprint-incomplete')) {
      try {
        recomputed = recomputeRecordMatch(candidate, poolValidation.candidates, sourceFingerprint);
      } catch {
        reasonCodes.push('match-recomputation-failed');
      }
    }
    const publicOriginal = publicOriginalValidation[index];
    if (recomputed) {
      if (recomputed.accepted !== true || !recomputed.path) reasonCodes.push('recomputed-match-not-accepted');
      if (!dimensionsApproximateOriginal(recomputed.nearest, candidate.source) && publicOriginal.errors.length > 0) {
        reasonCodes.push('local-preview-not-original-sized');
      }
      if (JSON.stringify(matchSnapshot(candidate.match)) !== JSON.stringify(matchSnapshot(recomputed))) {
        reasonCodes.push('stored-match-mismatch');
      }
    }
    if (publicOriginal.errors.length > 0) reasonCodes.push(...publicOriginal.errors);

    return {
      candidate,
      evidenceId,
      recordId,
      recomputed,
      publicOriginal: publicOriginal.asset,
      reasonCodes: [...new Set(reasonCodes)],
    };
  });

  addCollisionReasons(evaluated);

  const admittedByRecord = new Map();
  for (const item of evaluated) {
    item.reasonCodes = [...new Set(item.reasonCodes)];
    if (item.reasonCodes.length > 0) {
      rejections.push({
        evidenceId: item.evidenceId,
        recordId: item.recordId || null,
        reasonCodes: item.reasonCodes,
      });
      continue;
    }
    const list = admittedByRecord.get(item.recordId) || [];
    list.push(item);
    admittedByRecord.set(item.recordId, list);
  }

  let admittedImages = 0;
  for (const [recordId, items] of admittedByRecord) {
    items.sort((left, right) => (
      left.candidate.source.ordinal - right.candidate.source.ordinal
      || left.evidenceId.localeCompare(right.evidenceId, 'en')
    ));
    const record = recordIndex.byId.get(recordId)[0];
    record.images = items.map((item) => {
      const width = item.publicOriginal.width;
      const height = item.publicOriginal.height;
      return {
        src: item.publicOriginal.path,
        alt: cleanAlt(item.candidate.source.caption, record.title),
        width,
        height,
        // The page keeps the verified source bytes. Limit the initial modal
        // layout so a very large original remains readable without forcing a
        // full-resolution raster into a small card.
        ...deriveClearDisplayDimensions({ width, height }),
        evidenceId: item.evidenceId,
      };
    });
    admittedImages += record.images.length;
  }

  return {
    data,
    summary: {
      candidateRecords: candidates.length,
      admittedImages,
      rejectedRecords: rejections.length,
      affectedEvents: admittedByRecord.size,
      removedLegacyImages,
    },
    errors,
    rejections,
  };
}

module.exports = {
  EVIDENCE_PATH_PREFIX,
  MAX_THUMBNAIL_BYTES,
  MAX_THUMBNAIL_FILE_BYTES,
  PRODUCTION_DHASH_OPTIONS,
  PRODUCTION_MATCH_OPTIONS,
  applyFf14MediaAdmission,
  defaultAssetInspector,
  deriveClearDisplayDimensions,
  isSafeEvidencePath,
  isSafePublicImagePath,
  readImageDimensions,
  sha256Json,
};
