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

// User-requested correction on 2026-09-17; see the mapping in 开发日志.md.
// Only these labels may change, and their complete sections must stay intact.
const RELEASE_VERSION_CORRECTIONS = Object.freeze({
  '2.9.0': '2.8.7',
  '2.9.1': '2.8.8',
  '2.10.0': '2.8.9',
  '2.10.1': '2.8.10',
  '2.11.0': '2.8.11',
  '2.11.1': '2.8.12',
});

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

function releaseSections(markdown) {
  const headings = [...markdown.matchAll(/^## V(\d+(?:\.\d+)+)\b[^\n]*$/gm)];
  const sections = new Map();
  headings.forEach((match, index) => {
    if (sections.has(match[1])) throw new Error(`Duplicate changelog version: ${match[1]}`);
    const content = markdown.slice(match.index + match[0].length, headings[index + 1]?.index ?? markdown.length);
    sections.set(match[1], {
      items: (content.match(/^\s*-\s+\S/gm) || []).length,
      content: (match[0].replace(/^## V\d+(?:\.\d+)+\b/, '## V{version}') + content)
        .replace(/\r\n/g, '\n').trim(),
    });
  });
  return sections;
}

function validateReleaseHistory(before, after) {
  const previous = releaseSections(before);
  const current = releaseSections(after);
  for (const [version, section] of previous) {
    if (!current.has(version)) {
      const correctedVersion = RELEASE_VERSION_CORRECTIONS[version];
      const correctedSection = current.get(correctedVersion);
      if (!correctedSection) throw new Error(`Historical changelog version was removed: ${version}`);
      if (previous.has(correctedVersion)) {
        throw new Error(`Changelog correction target already existed: ${correctedVersion}`);
      }
      if (correctedSection.content !== section.content) {
        throw new Error(`Renumbered changelog content was changed: ${version} -> ${correctedVersion}`);
      }
      continue;
    }
    if (current.get(version).items < section.items) throw new Error(`Historical changelog items were removed: ${version}`);
  }
}

function fileAt(ref, file) {
  return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' });
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

  const pkg = JSON.parse(fileAt(head, 'package.json'));
  if (!isReleaseVersion(pkg.version)) {
    console.error(`Version ${pkg.version} is invalid.`);
    console.error('Use x.x.x and update both logs before pushing to GitHub.');
    process.exit(1);
  }

  try {
    const changelog = fileAt(head, REQUIRED_LOGS[0]);
    validateReleaseHistory(fileAt(base, REQUIRED_LOGS[0]), changelog);
    if (!releaseSections(changelog).has(pkg.version) || !fileAt(head, REQUIRED_LOGS[1]).includes(`V${pkg.version}`)) {
      throw new Error(`Both logs must include V${pkg.version}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.log('Release documentation check passed: changelog and development log updated.');
}

if (require.main === module) main();

module.exports = { REQUIRED_LOGS, changedFiles, isReleaseVersion, releaseSections, validateReleaseHistory };
