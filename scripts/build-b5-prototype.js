const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'js', 'prototypes', 'star-map-b5-prototype.js');
const OUTPUT = path.join(ROOT, 'dist', 'js', 'star-map-b5-prototype.js');

function createB5BuildOptions(overrides = {}) {
  return {
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: 'B5Prototype',
    outfile: OUTPUT,
    splitting: false,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
    ...overrides,
  };
}

async function buildB5Prototype(overrides = {}) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  return esbuild.build(createB5BuildOptions(overrides));
}

if (require.main === module) {
  buildB5Prototype().catch((error) => {
    console.error('[prototype:b5] Bundle failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ENTRY,
  OUTPUT,
  createB5BuildOptions,
  buildB5Prototype,
};
