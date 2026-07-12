/*
 * CI guard: every push must update both the public changelog and the
 * technical development log. This keeps GitHub history understandable
 * for a single-maintainer project.
 */

const { execFileSync } = require('node:child_process');

const REQUIRED_LOGS = [
  'docs/更新日志.md',
  'docs/开发日志.md',
];

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

  console.log('Release documentation check passed: changelog and development log updated.');
}

if (require.main === module) main();

module.exports = { REQUIRED_LOGS, changedFiles };
