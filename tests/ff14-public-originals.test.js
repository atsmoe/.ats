'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { downloadOriginals, selectOriginalCandidates } = require('../scripts/fetch-ff14-public-originals.js');

function response(url, bytes, headers = {}) {
  return { ok: true, url, headers: { get(name) { return headers[String(name).toLowerCase()] ?? null; } }, async arrayBuffer() { return bytes; } };
}

function manifest(source) {
  return { records: [{ source, match: { accepted: true, nearest: { width: 3, height: 2 } } }] };
}

test('only downsampled high-confidence matches are candidates for original recovery', () => {
  const source = { originalSha1: 'a'.repeat(40), originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/a.png', originalWidth: 1200, originalHeight: 600 };
  assert.equal(selectOriginalCandidates(manifest(source)).length, 1);
  assert.equal(selectOriginalCandidates({ records: [{ source, match: { accepted: true, nearest: { width: 1200, height: 600 } } }] }).length, 0);
});

test('missing lengths, budget overflow, and SHA-1 mismatches are recorded and never published', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ff14-original-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } }).png().toBuffer();
  const source = {
    originalSha1: crypto.createHash('sha1').update(bytes).digest('hex'), originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/a.png', originalWidth: 20, originalHeight: 10,
  };
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest(source)));
  const result = await downloadOriginals({ workspaceRoot: root, manifestPath, fetchImpl: async url => response(url, bytes, { 'content-type': 'image/png' }), now: () => '2026-08-25T00:00:00.000Z' });
  assert.equal(result.downloaded.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].detail, /Content-Length/iu);
  await assert.rejects(fs.access(path.join(root, 'src', 'assets', 'images', 'ff14', 'public-originals', `${source.originalSha1}.png`)));
});

test('verified original SHA-1 and dimensions are the only publication path', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ff14-original-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } }).png().toBuffer();
  const source = {
    originalSha1: crypto.createHash('sha1').update(bytes).digest('hex'), originalUrl: 'https://huiji-public.huijistatic.com/ff14/uploads/a.png', originalWidth: 20, originalHeight: 10,
  };
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest(source)));
  const result = await downloadOriginals({ workspaceRoot: root, manifestPath, fetchImpl: async url => response(url, bytes, { 'content-type': 'image/png', 'content-length': String(bytes.length), 'content-encoding': 'identity' }), now: () => '2026-08-25T00:00:00.000Z' });
  assert.equal(result.downloaded.length, 1);
  const saved = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.match(saved.records[0].source.publicOriginal.path, /public-originals\/[a-f0-9]{40}\.png$/u);
  assert.deepEqual(await fs.readFile(path.join(root, 'src', 'assets', 'images', 'ff14', 'public-originals', `${source.originalSha1}.png`)), bytes);
});
