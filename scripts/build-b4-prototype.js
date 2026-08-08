const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'js', 'prototypes', 'star-map-b4-prototype.js');
const OUTPUT = path.join(ROOT, 'dist', 'js', 'star-map-b4-prototype.js');

function createB4BuildOptions(overrides = {}) {
  return {
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: 'B4Prototype',
    outfile: OUTPUT,
    splitting: false,
    target: 'es2020',
    minify: false,
    sourcemap: false,
    logLevel: 'info',
    ...overrides,
  };
}

async function buildB4Prototype(overrides = {}) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  return esbuild.build(createB4BuildOptions(overrides));
}

if (require.main === module) {
  buildB4Prototype().catch((error) => {
    console.error('[prototype:b4] Bundle failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ENTRY,
  OUTPUT,
  createB4BuildOptions,
  buildB4Prototype,
};
