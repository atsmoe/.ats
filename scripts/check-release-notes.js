/*
 * CI guard: every push must update both the public changelog and the
 * technical development log. This keeps GitHub history understandable
 * for a single-maintainer project.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_LOGS = [
  'docs/更新日志.md',
  'docs/开发日志.md',
];

function isReleaseVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function changedFiles(base, head) {
  return execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', base, head], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .map(file => file.trim())
    .filter(Boolean);
}

function main() {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  if (!base) {
    console.error('Usage: node scripts/check-release-notes.js <base> [head]');
    process.exit(2);
  }

  const files = new Set(changedFiles(base, head));
  const missing = REQUIRED_LOGS.filter(file => !files.has(file));

  if (missing.length > 0) {
    console.error('Every GitHub push must update both project logs.');
    console.error(`Missing from this push: ${missing.join(', ')}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  if (!isReleaseVersion(pkg.version)) {
    console.error(`Version ${pkg.version} is invalid.`);
    console.error('Use x.x.x and update both logs before pushing to GitHub.');
    process.exit(1);
  }

  console.log('Release documentation check passed: changelog and development log updated.');
}

if (require.main === module) main();

module.exports = { REQUIRED_LOGS, changedFiles, isReleaseVersion };
