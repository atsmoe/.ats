const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

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
