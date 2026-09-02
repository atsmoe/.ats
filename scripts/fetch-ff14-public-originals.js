'use strict';

// Strict, bounded recovery of already high-confidence FFXIV media originals.
// It deliberately never consults user-managed folders and never uploads data.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const HOST = 'huiji-public.huijistatic.com';
const PATH_PREFIX = '/ff14/uploads/';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const POLICY_VERSION = 'ff14-public-originals/v1-direct-identity-bounded';

function sha1(bytes) { return crypto.createHash('sha1').update(bytes).digest('hex'); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }

function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== HOST || url.username || url.password || url.port || url.search || url.hash || !url.pathname.startsWith(PATH_PREFIX)) {
    throw new Error('original URL is outside the direct Huiji public upload namespace');
  }
  return url;
}

function extensionForMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return null;
}

function dimensionsApproximateOriginal(record) {
  const nearest = record?.match?.nearest;
  const source = record?.source;
  return positive(nearest?.width) && positive(nearest?.height)
    && positive(source?.originalWidth) && positive(source?.originalHeight)
    && nearest.width / source.originalWidth >= 0.95
    && nearest.height / source.originalHeight >= 0.95;
}

function selectOriginalCandidates(manifest) {
  const selected = new Map();
  for (const record of manifest?.records || []) {
    if (record?.match?.accepted !== true || dimensionsApproximateOriginal(record)) continue;
    const source = record.source;
    if (!source || !/^[a-f0-9]{40}$/iu.test(source.originalSha1 || '')) continue;
    const key = `${source.originalSha1}\0${source.originalUrl}`;
    if (!selected.has(key)) selected.set(key, { source, records: [] });
    selected.get(key).records.push(record);
  }
  return [...selected.values()].sort((a, b) => a.source.originalSha1.localeCompare(b.source.originalSha1));
}

function contentLength(response) {
  const raw = response?.headers?.get('content-length');
  if (!/^\d+$/u.test(String(raw || ''))) throw new Error('original response requires a valid Content-Length');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('original response Content-Length is invalid');
  return value;
}

async function fetchOne(candidate, options) {
  const url = validateUrl(candidate.source.originalUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url.href, {
      redirect: 'error', signal: controller.signal,
      headers: { Accept: 'image/png,image/jpeg,image/webp', 'Accept-Encoding': 'identity', 'User-Agent': 'Between-the-Stars/2.8.0 FFXIV-original-audit' },
    });
    if (!response?.ok || response.url !== url.href) throw new Error('original request failed or redirected');
    const mime = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    const extension = extensionForMime(mime);
    if (!extension || String(response.headers.get('content-encoding') || '').trim().toLowerCase().replace(/^$/, 'identity') !== 'identity') throw new Error('original response MIME or encoding is not allowed');
    const declaredLength = contentLength(response);
    if (declaredLength > options.maxFileBytes || options.totalBytes + declaredLength > options.maxTotalBytes) throw new Error('original declared length exceeds recovery budget');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== declaredLength || bytes.length > options.maxFileBytes || options.totalBytes + bytes.length > options.maxTotalBytes) throw new Error('original body violates declared recovery budget');
    const metadata = await sharp(bytes, { failOn: 'warning' }).metadata();
    if (metadata.width !== candidate.source.originalWidth || metadata.height !== candidate.source.originalHeight) throw new Error('original decoded dimensions do not match source metadata');
    if (sha1(bytes) !== String(candidate.source.originalSha1).toLowerCase()) throw new Error('original SHA-1 does not match source metadata');
    return { bytes, mime, extension, declaredLength, width: metadata.width, height: metadata.height };
  } finally { clearTimeout(timer); controller.abort(); }
}

async function downloadOriginals({ manifestPath, workspaceRoot = process.cwd(), fetchImpl = fetch, now = () => new Date().toISOString(), maxFileBytes = MAX_FILE_BYTES, maxTotalBytes = MAX_TOTAL_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  const resolvedManifest = path.resolve(workspaceRoot, manifestPath || 'scripts/data/ff14-media-manifest.json');
  const manifest = JSON.parse(await fs.readFile(resolvedManifest, 'utf8'));
  const candidates = selectOriginalCandidates(manifest);
  const root = path.resolve(workspaceRoot, 'src', 'assets', 'images', 'ff14', 'public-originals');
  await fs.mkdir(root, { recursive: true });
  let totalBytes = 0;
  const downloaded = [];
  const rejected = [];
  for (const candidate of candidates) {
    try {
      const result = await fetchOne(candidate, { fetchImpl, totalBytes, maxFileBytes, maxTotalBytes, timeoutMs });
      const filename = `${candidate.source.originalSha1.toLowerCase()}.${result.extension}`;
      const target = path.join(root, filename);
      const temporary = `${target}.part`;
      await fs.writeFile(temporary, result.bytes, { flag: 'wx' });
      await fs.rename(temporary, target);
      const publicOriginal = {
        path: `./assets/images/ff14/public-originals/${filename}`,
        originalUrl: candidate.source.originalUrl,
        originalSha1: candidate.source.originalSha1.toLowerCase(), sha1: sha1(result.bytes), sha256: sha256(result.bytes),
        width: result.width, height: result.height, bytes: result.bytes.length, mime: result.mime,
        requestedUrl: candidate.source.originalUrl, finalUrl: candidate.source.originalUrl, contentEncoding: 'identity', declaredLength: result.declaredLength,
        downloadedAt: now(), limits: { maxFileBytes, maxTotalBytes },
      };
      for (const record of candidate.records) record.source.publicOriginal = publicOriginal;
      totalBytes += result.bytes.length;
      downloaded.push({ originalSha1: publicOriginal.originalSha1, bytes: publicOriginal.bytes, records: candidate.records.length });
    } catch (error) {
      rejected.push({ originalSha1: candidate.source.originalSha1, originalUrl: candidate.source.originalUrl, records: candidate.records.length, reasonCode: 'original-download-rejected', detail: error.message });
    }
  }
  manifest.originalDownload = { policyVersion: POLICY_VERSION, attempted: candidates.length, downloaded, rejected, totalBytes, limits: { maxFileBytes, maxTotalBytes }, completedAt: now() };
  await fs.writeFile(resolvedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.originalDownload;
}

if (require.main === module) downloadOriginals().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { MAX_FILE_BYTES, MAX_TOTAL_BYTES, POLICY_VERSION, downloadOriginals, selectOriginalCandidates, validateUrl };
