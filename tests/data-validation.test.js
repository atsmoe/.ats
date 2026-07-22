const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('archive dossier contract rejects dangling contexts, records, and defaults', () => {
  const { archiveValidationErrors } = require('../src/validators/validate-data.js');
  const errors = archiveValidationErrors('arknights', {
    world: { id: 'arknights' },
    subEntities: [{
      timeline: {
        branches: [{
          id: 'known-context',
          name: '已知语境',
          eras: [{ title: '时代', events: [{ id: 'known-record', title: '已知记录' }] }],
        }],
      },
    }],
    archive: {
      dossiers: [{
        id: 'broken',
        contextId: 'missing-context',
        recordIds: ['missing-record'],
        defaultRecordId: 'another-record',
      }],
    },
  });
  const message = errors.join('\n');

  assert.match(message, /unknown context "missing-context"/);
  assert.match(message, /unknown record "missing-record"/);
  assert.match(message, /defaultRecordId "another-record" is not in recordIds/);
});

test('archive contract rejects a context without a stable ID', () => {
  const { archiveValidationErrors } = require('../src/validators/validate-data.js');
  const errors = archiveValidationErrors('arknights', {
    world: { id: 'arknights' },
    subEntities: [{
      timeline: {
        branches: [{ name: '缺少稳定 ID 的语境', eras: [] }],
      },
    }],
    archive: { dossiers: [] },
  });

  assert.match(errors.join('\n'), /archive context is missing an id/);
});

test('source data validates without warnings', () => {
  const result = spawnSync(
    process.execPath,
    ['src/validators/validate-data.js', '--validate-only'],
    { cwd: ROOT, encoding: 'utf8' },
  );

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /⚠\s+\d+ warnings?\./, output);
});
