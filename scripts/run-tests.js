// Enumerate the maintained suite explicitly; local audit snapshots are not tests.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function collectTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collectTests(file) : entry.isFile() && /\.test\.[cm]?js$/.test(entry.name) ? [file] : [];
  }).sort();
}

const testRoot = path.join(__dirname, '..', 'tests');
const rootStat = fs.lstatSync(testRoot);
if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Test root must be a real directory');
const files = collectTests(testRoot);
if (!files.length) throw new Error('No maintained test files found');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
