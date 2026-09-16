'use strict';

// Recompute decoder-dependent evidence from byte-identical, tracked inputs.
// Never redownload media, change provenance, or widen production admission.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createMediaRecoveryManifest } = require('./lib/ff14-media-recovery');
const { applyFf14MediaAdmission } = require('./lib/ff14-media-admission');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'scripts/data/ff14-media-manifest.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function readBoundFile(relativePath, sha256, allowedRoot) {
  assert.match(sha256, /^[a-f0-9]{64}$/);
  const file = path.resolve(ROOT, relativePath);
  const root = await fs.realpath(path.join(ROOT, allowedRoot));
  const real = await fs.realpath(file);
  assert.ok(real.startsWith(root + path.sep), 'Image path must stay in the evidence directory');
  const stat = await fs.lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Image evidence must be a regular file');
  const bytes = await fs.readFile(file);
  assert.equal(digest(bytes), sha256, `Source bytes changed: ${relativePath}`);
  return bytes;
}

async function refreshFingerprints({ write = false } = {}) {
  const originalBytes = await fs.readFile(MANIFEST);
  const previous = JSON.parse(originalBytes);
  const sourceImages = await Promise.all(previous.records.map(async record => ({
    ...record.source,
    buffer: await readBoundFile(record.source.thumbnail.evidencePath, record.source.thumbnail.sha256, 'scripts/data/ff14-media-thumbnails'),
  })));
  const localImages = await Promise.all(previous.candidatePool.contentImages.map(async candidate => {
    const { dHash, meanRgb, fileSha256, ...descriptor } = candidate;
    return { ...descriptor, buffer: await readBoundFile(`src/${candidate.path}`, fileSha256, 'src/assets/images/ff14') };
  }));
  const fresh = await createMediaRecoveryManifest({ sourceImages, localImages }, { dHash: previous.algorithm, match: previous.matching });
  assert.deepEqual(fresh.algorithm, previous.algorithm);
  assert.deepEqual(fresh.matching, previous.matching);
  assert.deepEqual(fresh.records.map(record => record.source), previous.records.map(record => record.source));
  const identity = ({ dHash, meanRgb, ...candidate }) => candidate;
  assert.deepEqual(fresh.candidatePool.contentImages.map(identity), previous.candidatePool.contentImages.map(identity));
  let changedBindings = 0;
  for (const [index, record] of fresh.records.entries()) {
    const old = previous.records[index];
    const changed = record.match.path !== old.match.path || record.match.accepted !== old.match.accepted;
    if (changed) changedBindings++;
    if (old.source.publicOriginal) assert.equal(changed, false, `Verified original binding changed: ${old.source.recordId}`);
  }
  const manifest = {
    ...previous,
    candidatePool: { ...previous.candidatePool, contentImages: fresh.candidatePool.contentImages },
    records: fresh.records,
  };
  const data = JSON.parse(await fs.readFile(path.join(ROOT, 'src/_data/ff14.json'), 'utf8'));
  const admission = await applyFf14MediaAdmission(data, manifest);
  assert.deepEqual(admission.errors, [], 'Refreshed manifest must pass the unchanged production guard');
  const expected = previous.records.filter(record => record.source.publicOriginal).map(record => [record.source.recordId, record.source.publicOriginal.path]);
  const actual = [];
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.id && Array.isArray(value.images)) for (const image of value.images) actual.push([value.id, image.src]);
    for (const child of Object.values(value)) if (typeof child === 'object') collect(child);
  }
  collect(admission.data);
  assert.deepEqual(actual.sort(), expected.sort(), 'Published event/image pairs must stay identical');
  if (write) {
    manifest.fingerprintRefresh = {
      previousManifestSha256: digest(originalBytes),
      sharpVersion: sharp.versions.sharp,
      libvipsVersion: sharp.versions.vips,
      refreshedAt: new Date().toISOString(),
    };
    await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return { verifiedCandidateFiles: localImages.length, verifiedSourceRecords: sourceImages.length, changedBindings, ...admission.summary, written: write };
}

if (require.main === module) {
  refreshFingerprints({ write: process.argv.includes('--write') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { refreshFingerprints };
