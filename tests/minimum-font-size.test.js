const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CSS_DIR = path.join(SRC, 'css');
const MINIMUM_FONT_SIZE = 12;

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function collectFiles(directory, extension, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'prototypes') continue;
      collectFiles(fullPath, extension, files);
    } else if (entry.name.endsWith(extension) && !entry.name.includes('prototype')) {
      files.push(fullPath);
    }
  }
  return files;
}

function findUndersizedFontDeclarations(filePath) {
  const source = fs.readFileSync(filePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const declarationPattern = /(?:--[\w-]*font[\w-]*|font-size|font)\s*:\s*([^;}]+)/gi;
  const violations = [];

  for (const match of source.matchAll(declarationPattern)) {
    const pixelValues = [...match[1].matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/gi)];
    for (const pixelValue of pixelValues) {
      const size = Number(pixelValue[1]);
      if (size >= MINIMUM_FONT_SIZE) continue;
      violations.push(
        `${path.relative(ROOT, filePath)}:${lineNumberAt(source, match.index)} (${pixelValue[0]})`,
      );
    }
  }

  return violations;
}

test('the global minimum font-size token is 12px', () => {
  const baseCss = fs.readFileSync(path.join(CSS_DIR, 'base.css'), 'utf8');
  assert.match(baseCss, /--site-min-font-size:\s*12px\s*;/);
});

test('production styles and templates contain no font size below the global minimum', () => {
  const violations = collectFiles(CSS_DIR, '.css').flatMap(findUndersizedFontDeclarations);

  for (const templatePath of collectFiles(SRC, '.njk')) {
    const source = fs.readFileSync(templatePath, 'utf8');
    for (const match of source.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px\b/gi)) {
      if (Number(match[1]) >= MINIMUM_FONT_SIZE) continue;
      violations.push(
        `${path.relative(ROOT, templatePath)}:${lineNumberAt(source, match.index)} (${match[1]}px)`,
      );
    }
  }

  assert.deepEqual(violations, []);
});
