'use strict';

// Local-only evidence core for reconstructing FFXIV source-image mappings.
//
// The caller is responsible for obtaining source thumbnails. This module never
// performs network or filesystem reads: it accepts buffers, builds dHashes, and
// returns JSON-safe evidence records for a later manifest writer.

const sharp = require('sharp');
const crypto = require('node:crypto');

const DEFAULT_DHASH_OPTIONS = Object.freeze({
  width: 9,
  height: 8,
});

const DEFAULT_MATCH_OPTIONS = Object.freeze({
  // A 64-bit dHash distance of 12 remains deliberately conservative. A caller
  // can tighten this after observing its source-thumbnail codec behaviour.
  maxDistance: 12,
  minDistanceMargin: 4,
  // A coarse mean-RGB guard catches images that share the same greyscale dHash
  // while clearly differing in colour. The value is a percentage of the
  // maximum RGB Euclidean distance.
  maxColorDistance: 18,
  // Exact source thumbnails and local copies should preserve their geometry.
  // A small tolerance covers integer thumbnail rounding without permitting a
  // visually similar image with a materially different crop.
  maxAspectRatioDeltaPercent: 2,
});

const IMAGE_BUFFER_KEYS = new Set(['buffer', 'imageBuffer', 'thumbnailBuffer']);
const UNSAFE_METADATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normaliseDHashOptions(options = {}) {
  const width = Number(options.width ?? DEFAULT_DHASH_OPTIONS.width);
  const height = Number(options.height ?? DEFAULT_DHASH_OPTIONS.height);

  if (!Number.isInteger(width) || width < 2) {
    throw new RangeError('dHash width must be an integer of at least 2.');
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new RangeError('dHash height must be a positive integer.');
  }

  return { width, height };
}

function normaliseMatchOptions(options = {}, bitLength) {
  const maxDistance = Number(options.maxDistance ?? Math.round(bitLength * 0.1875));
  const minDistanceMargin = Number(options.minDistanceMargin ?? DEFAULT_MATCH_OPTIONS.minDistanceMargin);
  const maxColorDistance = Number(options.maxColorDistance ?? DEFAULT_MATCH_OPTIONS.maxColorDistance);
  const maxAspectRatioDeltaPercent = Number(
    options.maxAspectRatioDeltaPercent ?? DEFAULT_MATCH_OPTIONS.maxAspectRatioDeltaPercent,
  );

  if (!Number.isInteger(maxDistance) || maxDistance < 0 || maxDistance > bitLength) {
    throw new RangeError(`maxDistance must be an integer between 0 and ${bitLength}.`);
  }
  if (!Number.isInteger(minDistanceMargin) || minDistanceMargin < 0 || minDistanceMargin > bitLength) {
    throw new RangeError(`minDistanceMargin must be an integer between 0 and ${bitLength}.`);
  }
  if (!Number.isFinite(maxColorDistance) || maxColorDistance < 0 || maxColorDistance > 100) {
    throw new RangeError('maxColorDistance must be a number between 0 and 100.');
  }
  if (
    !Number.isFinite(maxAspectRatioDeltaPercent)
    || maxAspectRatioDeltaPercent < 0
    || maxAspectRatioDeltaPercent > 100
  ) {
    throw new RangeError('maxAspectRatioDeltaPercent must be a number between 0 and 100.');
  }

  return { maxDistance, minDistanceMargin, maxColorDistance, maxAspectRatioDeltaPercent };
}

function readImageBuffer(entry, label) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError(`${label} must be an object with an image buffer.`);
  }

  for (const key of IMAGE_BUFFER_KEYS) {
    if (Buffer.isBuffer(entry[key])) return entry[key];
  }

  const reference = entry.url || entry.path || entry.id || 'unknown entry';
  throw new TypeError(`${label} ${reference} must include Buffer data in buffer, imageBuffer, or thumbnailBuffer.`);
}

function jsonSafeValue(value, seen = new WeakSet(), depth = 0) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol' || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return undefined;
  }
  if (depth >= 5 || typeof value !== 'object' || seen.has(value)) return undefined;

  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => {
      const safeItem = jsonSafeValue(item, seen, depth + 1);
      return safeItem === undefined ? null : safeItem;
    });
  } else {
    result = {};
    for (const key of Object.keys(value)) {
      if (UNSAFE_METADATA_KEYS.has(key) || IMAGE_BUFFER_KEYS.has(key)) continue;
      const safeItem = jsonSafeValue(value[key], seen, depth + 1);
      if (safeItem !== undefined) result[key] = safeItem;
    }
  }
  seen.delete(value);
  return result;
}

function passThroughMetadata(entry, reservedKeys) {
  const metadata = {};
  for (const key of Object.keys(entry || {})) {
    if (reservedKeys.has(key) || IMAGE_BUFFER_KEYS.has(key) || UNSAFE_METADATA_KEYS.has(key)) continue;
    const safeValue = jsonSafeValue(entry[key]);
    if (safeValue !== undefined) metadata[key] = safeValue;
  }
  return metadata;
}

function hashBufferFrom(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === 'object' && typeof value.hex === 'string') return hashBufferFrom(value.hex);

  if (typeof value === 'string' && /^[0-9a-f]+$/iu.test(value) && value.length % 2 === 0) {
    return Buffer.from(value, 'hex');
  }

  throw new TypeError('A dHash must be a hexadecimal string, Buffer, Uint8Array, or object with a hex field.');
}

function serialiseHash(buffer) {
  return buffer.toString('hex');
}

function hammingDistance(left, right) {
  const leftBuffer = hashBufferFrom(left);
  const rightBuffer = hashBufferFrom(right);

  if (leftBuffer.length !== rightBuffer.length) {
    throw new RangeError('Cannot compare hashes with different bit lengths.');
  }

  let distance = 0;
  for (let index = 0; index < leftBuffer.length; index += 1) {
    let value = leftBuffer[index] ^ rightBuffer[index];
    while (value) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return distance;
}

function readRgb(data, pixelIndex, channels) {
  const offset = pixelIndex * channels;
  if (channels < 3) {
    const value = data[offset];
    return { r: value, g: value, b: value };
  }
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
  };
}

function luminance(rgb) {
  return Math.round(rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722);
}

function colorDistance(left, right) {
  const difference = Math.sqrt(
    (left.r - right.r) ** 2
    + (left.g - right.g) ** 2
    + (left.b - right.b) ** 2,
  );
  return Math.round((difference / (Math.sqrt(3) * 255)) * 10000) / 100;
}

/**
 * Build a difference hash from any image buffer.
 *
 * dHash preserves neighbouring luminance changes rather than exact pixels,
 * making it suitable for matching a source thumbnail to a locally cached copy
 * that was re-encoded at another size. It does not prove semantic relevance;
 * it only proves a visual candidate relationship. meanRgb is an additional
 * coarse guard against same-greyscale, different-colour false positives.
 */
async function createDHash(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('createDHash requires a Buffer.');
  }

  const { width, height } = normaliseDHashOptions(options);
  const metadata = await sharp(buffer, { failOn: 'warning' }).metadata();
  const swapsAxes = metadata.orientation >= 5 && metadata.orientation <= 8;
  const imageWidth = swapsAxes ? metadata.height : metadata.width;
  const imageHeight = swapsAxes ? metadata.width : metadata.height;
  if (!positiveImageDimension(imageWidth) || !positiveImageDimension(imageHeight)) {
    throw new Error('Unable to read source image dimensions for dHash generation.');
  }
  const { data, info } = await sharp(buffer, { failOn: 'warning' })
    .rotate()
    .flatten({ background: '#000000' })
    .removeAlpha()
    .toColourspace('srgb')
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== width || info.height !== height || info.channels < 1) {
    throw new Error('Unable to normalise image data for dHash generation.');
  }

  const pixels = [];
  let totalRed = 0;
  let totalGreen = 0;
  let totalBlue = 0;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const rgb = readRgb(data, pixelIndex, info.channels);
    pixels.push(luminance(rgb));
    totalRed += rgb.r;
    totalGreen += rgb.g;
    totalBlue += rgb.b;
  }

  const bitLength = (width - 1) * height;
  const hash = Buffer.alloc(Math.ceil(bitLength / 8));
  let bitIndex = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const left = pixels[y * width + x];
      const right = pixels[y * width + x + 1];
      if (left > right) {
        hash[Math.floor(bitIndex / 8)] |= 1 << (7 - (bitIndex % 8));
      }
      bitIndex += 1;
    }
  }

  const pixelCount = width * height;
  return {
    algorithm: 'dhash',
    format: metadata.format || null,
    width,
    height,
    bitLength,
    hex: serialiseHash(hash),
    imageWidth,
    imageHeight,
    meanRgb: {
      r: Math.round(totalRed / pixelCount),
      g: Math.round(totalGreen / pixelCount),
      b: Math.round(totalBlue / pixelCount),
    },
  };
}

function positiveImageDimension(value) {
  return Number.isInteger(value) && value > 0;
}

function aspectRatioDeltaPercent(left, right) {
  if (
    !positiveImageDimension(left.imageWidth)
    || !positiveImageDimension(left.imageHeight)
    || !positiveImageDimension(right.imageWidth)
    || !positiveImageDimension(right.imageHeight)
  ) return null;
  const leftRatio = left.imageWidth / left.imageHeight;
  const rightRatio = right.imageWidth / right.imageHeight;
  return Math.round((Math.abs(leftRatio - rightRatio) / leftRatio) * 10000) / 100;
}

function sourceDescriptor(entry, index) {
  const reservedKeys = new Set(['id', 'section', 'title', 'url']);
  return {
    id: entry.id == null ? `source-${index + 1}` : String(entry.id),
    section: entry.section == null ? null : String(entry.section),
    title: entry.title == null ? null : String(entry.title),
    url: entry.url == null ? null : String(entry.url),
    ...passThroughMetadata(entry, reservedKeys),
  };
}

function localDescriptor(entry, index) {
  if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) {
    throw new TypeError(`local image ${index + 1} must include a non-empty path.`);
  }

  const requestedRole = entry.role == null ? 'content' : String(entry.role).trim().toLowerCase();
  const role = requestedRole || 'content';
  const reservedKeys = new Set(['path', 'role', 'distance', 'colorDistance', 'dHash', 'meanRgb']);
  return {
    path: entry.path,
    role,
    ...passThroughMetadata(entry, reservedKeys),
  };
}

async function hashSourceImages(sourceImages, dHashOptions) {
  return Promise.all(sourceImages.map(async (entry, index) => {
    const dHash = await createDHash(readImageBuffer(entry, `source image ${index + 1}`), dHashOptions);
    return {
      source: sourceDescriptor(entry, index),
      dHash,
    };
  }));
}

async function hashLocalImages(localImages, dHashOptions) {
  const hashes = await Promise.all(localImages.map(async (entry, index) => {
    const buffer = readImageBuffer(entry, `local image ${index + 1}`);
    const dHash = await createDHash(buffer, dHashOptions);
    return {
      local: localDescriptor(entry, index),
      dHash,
      fileSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
  }));

  // Filesystem enumeration order must not decide a tied winner.
  hashes.sort((left, right) => compareText(left.local.path, right.local.path));
  return {
    eligible: hashes.filter((entry) => entry.local.role === 'content'),
    excluded: hashes.filter((entry) => entry.local.role !== 'content'),
  };
}

function publicCandidate(candidate) {
  if (!candidate) return null;
  return {
    ...candidate.local,
    distance: candidate.distance,
    colorDistance: candidate.colorDistance,
    dHash: candidate.dHash,
    meanRgb: candidate.meanRgb,
    format: candidate.local.format ?? candidate.format,
    width: candidate.local.width ?? candidate.imageWidth,
    height: candidate.local.height ?? candidate.imageHeight,
    aspectRatioDeltaPercent: candidate.aspectRatioDeltaPercent,
    fileSha256: candidate.fileSha256,
  };
}

function buildConfidence({
  hasGlobalSecondCandidate,
  nearestDistance,
  colorDistance: nearestColorDistance,
  secondDistance,
  uniqueNearest,
  withinDistanceThreshold,
  withinColorThreshold,
  passesMargin,
  hasAspectRatioEvidence,
  withinAspectRatioThreshold,
}, matchOptions) {
  if (nearestDistance == null) {
    return {
      score: 0,
      level: 'unmatched',
      reasonCodes: ['no-content-local-candidates'],
    };
  }

  const reasonCodes = [
    uniqueNearest ? 'unique-nearest' : 'tied-nearest',
    withinDistanceThreshold ? 'within-distance-threshold' : 'outside-distance-threshold',
    withinColorThreshold ? 'within-colour-threshold' : 'outside-colour-threshold',
    hasGlobalSecondCandidate ? 'global-second-candidate-present' : 'missing-global-second-candidate',
    hasAspectRatioEvidence ? 'aspect-ratio-evidence-present' : 'missing-aspect-ratio-evidence',
    withinAspectRatioThreshold ? 'within-aspect-ratio-threshold' : 'outside-aspect-ratio-threshold',
  ];
  if (hasGlobalSecondCandidate) {
    reasonCodes.push(passesMargin ? 'sufficient-second-best-margin' : 'weak-second-best-margin');
  }

  if (!uniqueNearest) {
    return { score: 0, level: 'ambiguous', reasonCodes };
  }

  const distanceScore = 1 - clamp(nearestDistance / Math.max(1, matchOptions.maxDistance + 1), 0, 1);
  const margin = secondDistance == null ? null : secondDistance - nearestDistance;
  const marginScore = margin == null
    ? 0
    : clamp(margin / Math.max(1, matchOptions.minDistanceMargin * 2), 0, 1);
  const colourScore = 1 - clamp(nearestColorDistance / Math.max(1, matchOptions.maxColorDistance + 1), 0, 1);
  let score = Math.round((distanceScore * 0.64 + marginScore * 0.2 + colourScore * 0.16) * 100);

  if (!hasGlobalSecondCandidate || !hasAspectRatioEvidence) score = Math.min(score, 69);
  if (
    !withinDistanceThreshold
    || !withinColorThreshold
    || !passesMargin
    || !withinAspectRatioThreshold
  ) score = Math.min(score, 59);

  let level = 'low';
  if (
    hasGlobalSecondCandidate
    && hasAspectRatioEvidence
    && withinDistanceThreshold
    && withinColorThreshold
    && withinAspectRatioThreshold
    && passesMargin
    && score >= 85
  ) {
    level = 'high';
  } else if (withinDistanceThreshold && withinColorThreshold && passesMargin && score >= 70) {
    level = 'medium';
  } else if (!withinDistanceThreshold || !withinColorThreshold) {
    level = 'unmatched';
  } else if (!hasGlobalSecondCandidate) {
    level = 'low';
  } else if (!passesMargin) {
    level = 'ambiguous';
  }

  return { score, level, reasonCodes };
}

function matchSourceHash(sourceHash, localHashes, matchOptions) {
  const candidates = localHashes.map((local) => ({
    local: local.local,
    dHash: local.dHash.hex,
    meanRgb: local.dHash.meanRgb,
    format: local.dHash.format,
    distance: hammingDistance(sourceHash.hex, local.dHash.hex),
    colorDistance: colorDistance(sourceHash.meanRgb, local.dHash.meanRgb),
    imageWidth: local.dHash.imageWidth,
    imageHeight: local.dHash.imageHeight,
    aspectRatioDeltaPercent: aspectRatioDeltaPercent(sourceHash, local.dHash),
    fileSha256: local.fileSha256,
  })).sort((left, right) => (
    left.distance - right.distance
    || left.colorDistance - right.colorDistance
    || compareText(left.local.path, right.local.path)
  ));

  const nearest = candidates[0] || null;
  const secondNearest = candidates[1] || null;
  const nearestDistance = nearest ? nearest.distance : null;
  const secondDistance = secondNearest ? secondNearest.distance : null;
  const hasGlobalSecondCandidate = Boolean(secondNearest);
  const uniqueNearest = Boolean(nearest)
    && candidates.filter((candidate) => candidate.distance === nearestDistance).length === 1;
  const distanceMargin = secondDistance == null || nearestDistance == null
    ? null
    : secondDistance - nearestDistance;
  const withinDistanceThreshold = nearestDistance != null && nearestDistance <= matchOptions.maxDistance;
  const withinColorThreshold = nearest
    ? nearest.colorDistance <= matchOptions.maxColorDistance
    : false;
  const passesMargin = hasGlobalSecondCandidate && distanceMargin >= matchOptions.minDistanceMargin;
  const hasAspectRatioEvidence = nearest?.aspectRatioDeltaPercent != null;
  const withinAspectRatioThreshold = hasAspectRatioEvidence
    && nearest.aspectRatioDeltaPercent <= matchOptions.maxAspectRatioDeltaPercent;
  const confidence = buildConfidence({
    hasGlobalSecondCandidate,
    nearestDistance,
    colorDistance: nearest ? nearest.colorDistance : null,
    secondDistance,
    uniqueNearest,
    withinDistanceThreshold,
    withinColorThreshold,
    passesMargin,
    hasAspectRatioEvidence,
    withinAspectRatioThreshold,
  }, matchOptions);
  const accepted = confidence.level === 'high'
    && confidence.score >= 85
    && uniqueNearest
    && hasGlobalSecondCandidate
    && withinDistanceThreshold
    && withinColorThreshold
    && hasAspectRatioEvidence
    && withinAspectRatioThreshold
    && passesMargin;

  return {
    path: accepted ? nearest.local.path : null,
    nearest: publicCandidate(nearest),
    secondNearest: publicCandidate(secondNearest),
    distance: nearestDistance,
    secondDistance,
    distanceMargin,
    uniqueNearest,
    hasGlobalSecondCandidate,
    withinDistanceThreshold,
    withinColorThreshold,
    hasAspectRatioEvidence,
    withinAspectRatioThreshold,
    passesMargin,
    accepted,
    confidence,
  };
}

function serialiseLocalEvidence(entry) {
  return {
    ...entry.local,
    width: entry.local.width ?? entry.dHash.imageWidth,
    height: entry.local.height ?? entry.dHash.imageHeight,
    dHash: entry.dHash.hex,
    meanRgb: entry.dHash.meanRgb,
    format: entry.local.format ?? entry.dHash.format,
    fileSha256: entry.fileSha256,
  };
}

function evaluateMediaMatchEvidence(evidence, options = {}) {
  if (!evidence || typeof evidence !== 'object') {
    throw new TypeError('media match evidence must be an object.');
  }
  if (!Array.isArray(evidence.candidates)) {
    throw new TypeError('media match evidence candidates must be an array.');
  }
  const sourceHashBuffer = hashBufferFrom(evidence.sourceDHash);
  const bitLength = sourceHashBuffer.length * 8;
  const matchOptions = normaliseMatchOptions(options, bitLength);
  const sourceHash = {
    hex: serialiseHash(sourceHashBuffer),
    meanRgb: evidence.sourceMeanRgb,
    imageWidth: evidence.sourceWidth,
    imageHeight: evidence.sourceHeight,
  };
  const localHashes = evidence.candidates.map((candidate, index) => {
    if (!candidate || typeof candidate.path !== 'string' || !candidate.path.trim()) {
      throw new TypeError(`candidate ${index + 1} must include a non-empty path.`);
    }
    return {
      local: {
        ...candidate,
        role: candidate.role == null ? 'content' : candidate.role,
      },
      dHash: {
        hex: serialiseHash(hashBufferFrom(candidate.dHash)),
        meanRgb: candidate.meanRgb,
        imageWidth: candidate.width,
        imageHeight: candidate.height,
      },
      fileSha256: candidate.fileSha256,
    };
  });
  return matchSourceHash(sourceHash, localHashes, matchOptions);
}

function sourceMediaFileTitle(source) {
  // `fileTitle` is the Wiki media filename. `sourceFileTitle` identifies the
  // TXT/page that contained it, so using the latter would allow two different
  // images on one page to claim the same local asset. Keep the fallback only
  // for older callers that have not yet adopted the explicit media field.
  const value = source.fileTitle ?? source.sourceFileTitle;
  if (value == null) return null;
  const title = String(value).trim();
  return title || null;
}

function collisionSourceReference(source) {
  return {
    id: source.id,
    recordId: source.recordId ?? null,
    sourceFileTitle: source.sourceFileTitle ?? null,
    fileTitle: sourceMediaFileTitle(source),
    sourcePage: source.sourcePage ?? null,
    title: source.title,
    url: source.url,
  };
}

function applyPathCollisionGuards(records) {
  const byPath = new Map();
  for (const record of records) {
    if (!record.match.accepted || !record.match.path) continue;
    const group = byPath.get(record.match.path) || [];
    group.push(record);
    byPath.set(record.match.path, group);
  }

  for (const [localPath, recordsForPath] of byPath) {
    if (recordsForPath.length < 2) continue;
    const titles = new Set(recordsForPath.map((record) => sourceMediaFileTitle(record.source)));
    // A shared file is safe only when every successful binding names the same
    // non-empty source file. Missing provenance is not evidence of agreement.
    if (titles.size === 1 && !titles.has(null)) continue;

    const collision = {
      type: 'source-file-title-collision',
      localPath,
      sourceFileTitles: [...titles].sort((left, right) => compareText(String(left), String(right))),
      sourceRecords: recordsForPath.map((record) => collisionSourceReference(record.source)),
    };

    for (const record of recordsForPath) {
      record.match.path = null;
      record.match.accepted = false;
      record.match.collision = collision;
      record.match.confidence = {
        score: Math.min(record.match.confidence.score, 59),
        level: 'ambiguous',
        reasonCodes: [...new Set([
          ...record.match.confidence.reasonCodes,
          'source-file-title-collision',
        ])],
      };
    }
  }
}

/**
 * Produce a JSON-safe matching manifest. Entries must carry their image bytes
 * in buffer, imageBuffer, or thumbnailBuffer. Source image descriptors retain
 * section/title/url plus any JSON-safe metadata (for example recordId,
 * sourceFileTitle, caption, originalUrl, ordinal, width, height, role, and
 * format) so a scraper can feed its JSON into this core directly.
 */
async function createMediaRecoveryManifest({ sourceImages, localImages }, options = {}) {
  if (!Array.isArray(sourceImages)) throw new TypeError('sourceImages must be an array.');
  if (!Array.isArray(localImages)) throw new TypeError('localImages must be an array.');

  const dHashOptions = normaliseDHashOptions(options.dHash);
  const bitLength = (dHashOptions.width - 1) * dHashOptions.height;
  const matchOptions = normaliseMatchOptions(options.match, bitLength);
  const [hashedSourceImages, localPool] = await Promise.all([
    hashSourceImages(sourceImages, dHashOptions),
    hashLocalImages(localImages, dHashOptions),
  ]);
  const records = hashedSourceImages.map((sourceImage) => ({
    source: sourceImage.source,
    sourceDHash: sourceImage.dHash.hex,
    sourceMeanRgb: sourceImage.dHash.meanRgb,
    match: matchSourceHash(sourceImage.dHash, localPool.eligible, matchOptions),
  }));
  applyPathCollisionGuards(records);

  return {
    schemaVersion: 1,
    algorithm: {
      name: 'dhash',
      width: dHashOptions.width,
      height: dHashOptions.height,
      bitLength,
      colourGuard: 'mean-rgb-distance',
    },
    matching: {
      maxDistance: matchOptions.maxDistance,
      minDistanceMargin: matchOptions.minDistanceMargin,
      maxColorDistance: matchOptions.maxColorDistance,
      maxAspectRatioDeltaPercent: matchOptions.maxAspectRatioDeltaPercent,
    },
    candidatePool: {
      totalLocalImages: localImages.length,
      eligibleContentImages: localPool.eligible.length,
      contentImages: localPool.eligible.map(serialiseLocalEvidence),
      excludedLocalImages: localPool.excluded.map((entry) => entry.local),
    },
    records,
  };
}

module.exports = {
  DEFAULT_DHASH_OPTIONS,
  DEFAULT_MATCH_OPTIONS,
  createDHash,
  hammingDistance,
  createMediaRecoveryManifest,
  evaluateMediaMatchEvidence,
};
