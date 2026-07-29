const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('legacy FFXIV transformer refuses to overwrite the modern archive', () => {
  const archivePath = path.join(ROOT, 'src', '_data', 'ff14.json');
  const before = fs.readFileSync(archivePath, 'utf8');
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'transform-ff14.js')],
    { cwd: ROOT, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /Refusing to overwrite the modern FFXIV archive/);
  assert.equal(fs.readFileSync(archivePath, 'utf8'), before);
});
