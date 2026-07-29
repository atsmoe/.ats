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

test('published integrated-strategy endings require stable IDs and traceable sources', () => {
  const { archiveValidationErrors } = require('../src/validators/validate-data.js');
  const errors = archiveValidationErrors('arknights', {
    subEntities: [{
      timeline: {
        branches: [{
          id: 'if-integrated',
          subBranches: [{
            id: 'if-example',
            order: 1,
            name: '示例主题',
            type: 'integrated-strategy',
            description: '已发布摘要',
            sharedPremise: '共同起点',
            topologyMode: 'parallel',
            lastReviewedAt: '2026-07-22',
            sources: [{ title: '页面来源', url: 'https://example.com/topic' }],
            endings: [{
              endingNumber: 1,
              title: '正式结局',
              description: '结局摘要',
              sources: [],
            }],
          }],
        }],
      },
    }],
    archive: { dossiers: [] },
  });
  const message = errors.join('\n');

  assert.match(message, /if-example.*ending 1 needs an explicit stable id/);
  assert.match(message, /if-example-ending-1.*at least one traceable source/);
  assert.match(message, /if-example-ending-1.*needs a substantive aftermath/);
});

test('published integrated-strategy topics reject placeholder copy and incomplete metadata', () => {
  const { archiveValidationErrors } = require('../src/validators/validate-data.js');
  const errors = archiveValidationErrors('arknights', {
    subEntities: [{
      timeline: {
        branches: [{
          id: 'if-integrated',
          subBranches: [{
            id: 'if-placeholder',
            name: '占位主题',
            type: 'integrated-strategy',
            description: '待完工：稍后补充',
            endings: [],
          }],
        }],
      },
    }],
    archive: { dossiers: [] },
  });
  const message = errors.join('\n');

  assert.match(message, /if-placeholder.*missing required field "order"/);
  assert.match(message, /if-placeholder.*contains placeholder copy/);
  assert.match(message, /if-placeholder.*at least one ending/);
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
