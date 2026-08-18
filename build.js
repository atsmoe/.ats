const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const SRC_JS = path.join(__dirname, 'src', 'js', 'modules');
const LIB_JS = path.join(__dirname, 'src', 'js', 'lib');
const PROTOTYPE_PAGE_PATTERN = /^star-map(?:-[a-z0-9]+)*-prototype\.html$/;
const PROTOTYPE_SCRIPT_PATTERN = /^star-map(?:-[a-z0-9]+)*-prototype\.js$/;
const PROTOTYPE_SUPPORT_SCRIPT_PATTERN = /^b4-cosmic-stage\.js$/;
const PUBLIC_B4_PAGE = 'star-map-b4-prototype.html';
const PUBLIC_B4_SCRIPT = 'star-map-b4-prototype.js';

function removeLocalPrototypeArtifacts() {
  let removed = 0;

  function removeFrom(directory) {
    if (!fs.existsSync(directory)) return;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'prototypes') {
          fs.rmSync(entryPath, { recursive: true, force: true });
          removed += 1;
        } else {
          removeFrom(entryPath);
        }
        continue;
      }

      const isPrototypePage = PROTOTYPE_PAGE_PATTERN.test(entry.name)
        && entry.name !== PUBLIC_B4_PAGE;
      const isPrototypeScript = (PROTOTYPE_SCRIPT_PATTERN.test(entry.name)
        && entry.name !== PUBLIC_B4_SCRIPT)
        || PROTOTYPE_SUPPORT_SCRIPT_PATTERN.test(entry.name);
      if (!isPrototypePage && !isPrototypeScript) continue;
      fs.unlinkSync(entryPath);
      removed += 1;
    }
  }

  removeFrom(DIST);

  if (removed > 0) {
    console.log(`[build] Removed ${removed} local prototype artifact(s).`);
  }
}

async function buildJS() {
  console.log('[esbuild] Bundling JS...');

  // Bundle main.js → bundle.js (world pages, about, changelog)
  await esbuild.build({
    entryPoints: [path.join(SRC_JS, 'main.js')],
    bundle: true,
    format: 'iife',
    globalName: 'AK',
    outfile: path.join(DIST, 'js', 'bundle.js'),
    splitting: false,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    drop: ['console'],
    external: ['virtual-timeline.js'],
    logLevel: 'info',
  });

  // Bundle the lightweight 2D scene controller used only by the star-map page.
  await esbuild.build({
    entryPoints: [path.join(SRC_JS, 'star-map-entry.js')],
    bundle: true,
    format: 'iife',
    globalName: 'SM2D',
    outfile: path.join(DIST, 'js', 'star-map-2d.js'),
    splitting: false,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    drop: ['console'],
    logLevel: 'info',
  });

  // Copy virtual-timeline.js to dist
  fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });
  fs.copyFileSync(
    path.join(LIB_JS, 'virtual-timeline.js'),
    path.join(DIST, 'js', 'virtual-timeline.js')
  );

  // Remove bundles from the short-lived four-entry experiment. All non-star-map
  // pages are dispatched by bundle.js so the documented two-entry boundary holds.
  for (const staleBundle of ['arknights.js', 'wh40k.js', 'star-map-3d.js']) {
    const stalePath = path.join(DIST, 'js', staleBundle);
    if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
  }

  // Clean up stale source maps from previous builds
  const staleMaps = fs.readdirSync(path.join(DIST, 'js')).filter(f => f.endsWith('.map'));
  for (const f of staleMaps) fs.unlinkSync(path.join(DIST, 'js', f));
  if (staleMaps.length > 0) console.log(`[esbuild] Removed ${staleMaps.length} stale source map(s).`);

  console.log('[esbuild] JS bundles complete.');
}

async function buildCSS() {
  console.log('[build] Copying CSS...');
  fs.mkdirSync(path.join(DIST, 'css'), { recursive: true });
  const cssDir = path.join(__dirname, 'src', 'css');
  const files = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
  for (const f of files) {
    fs.copyFileSync(path.join(cssDir, f), path.join(DIST, 'css', f));
  }
}

/**
 * Build-time image optimization pipeline.
 * Scans data JSON for referenced images, generates WebP at 320/640/960,
 * and post-processes dist data JSON to point src at the 960w WebP.
 */
async function buildImages() {
  const Image = require('@11ty/eleventy-img');

  // Collect unique image paths referenced in source data JSON
  const dataDir = path.join(__dirname, 'src', '_data');
  const imageRefs = new Set();
  for (const file of fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
    const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
    const matches = content.matchAll(/"src"\s*:\s*"\.\/assets\/images\/([^"]+)"/g);
    for (const m of matches) imageRefs.add(m[1]);
  }

  if (imageRefs.size === 0) {
    console.log('[build] No images referenced in data — skipping optimisation.');
    return;
  }

  console.log(`[build] Optimising ${imageRefs.size} referenced images…`);

  let count = 0, skipped = 0;
  let totalRaw = 0, totalWebp = 0;
  const processed = new Set(); // relPath → true (for post-processing)

  // Process in parallel batches of 8 to keep memory in check
  const CONCURRENCY = 8;
  const refs = [...imageRefs];
  for (let i = 0; i < refs.length; i += CONCURRENCY) {
    const batch = refs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (relPath) => {
      const srcPath = path.join(__dirname, 'src', 'assets', 'images', relPath);
      if (!fs.existsSync(srcPath)) { skipped++; return; }

      const originalSize = fs.statSync(srcPath).size;
      const outputDir = path.join(DIST, 'assets', 'images', path.dirname(relPath));
      fs.mkdirSync(outputDir, { recursive: true });
      const name = path.basename(relPath, path.extname(relPath));

      try {
        const metadata = await Image(srcPath, {
          widths: [320, 640, 960],
          formats: ['webp'],
          outputDir,
          urlPath: `./assets/images/${path.dirname(relPath)}/`,
          sharpWebpOptions: { quality: 75 },
          filenameFormat: (_id, _src, width, format) => `${name}-${width}w.${format}`,
        });

        const webp960 = metadata.webp?.find(m => m.width === 960);
        if (webp960) {
          totalRaw += originalSize;
          totalWebp += webp960.size;
          processed.add(relPath);
        }
        count++;
      } catch (err) {
        console.warn(`  ⚠ Skipping ${relPath}: ${err.message}`);
        skipped++;
      }
    }));
  }

  const pct = totalRaw > 0 ? ((1 - totalWebp / totalRaw) * 100).toFixed(0) : 0;
  console.log(`[build] Images: ${count} processed, ${skipped} skipped, ${totalRaw > 0 ? `960w WebP ${pct}% smaller (${(totalRaw/1024/1024).toFixed(1)}MB → ${(totalWebp/1024/1024).toFixed(1)}MB)` : ''}`);

  // Post-process dist data JSON: point src at 960w WebP instead of original
  if (processed.size > 0) {
    const distDataDir = path.join(DIST, 'data');
    for (const file of fs.readdirSync(distDataDir).filter(f => f.endsWith('.json') && f !== 'event-index.json')) {
      const filePath = path.join(distDataDir, file);
      let content = fs.readFileSync(filePath, 'utf-8');
      let changed = false;
      for (const relPath of processed) {
        const webpName = path.basename(relPath, path.extname(relPath)) + '-960w.webp';
        const webpRef = './assets/images/' + path.dirname(relPath).replace(/\\/g, '/') + '/' + webpName;
        const origRef = './assets/images/' + relPath.replace(/\\/g, '/');
        if (content.includes(origRef)) {
          content = content.split(origRef).join(webpRef);
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(filePath, content);
    }
    console.log('[build] Updated dist data JSON → image src now points to 960w WebP.');
  }

  // Remove original images that have been replaced by WebP versions
  if (processed.size > 0) {
    let cleaned = 0;
    let cleanedBytes = 0;
    for (const relPath of processed) {
      const origPath = path.join(DIST, 'assets', 'images', relPath);
      const name = path.basename(relPath, path.extname(relPath));
      const webp960 = path.join(DIST, 'assets', 'images', path.dirname(relPath), `${name}-960w.webp`);
      // Only delete original if WebP was generated and original still exists
      if (fs.existsSync(webp960) && fs.existsSync(origPath)) {
        cleanedBytes += fs.statSync(origPath).size;
        fs.unlinkSync(origPath);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[build] Cleaned ${cleaned} original images, saved ${(cleanedBytes/1024/1024).toFixed(1)}MB from deploy.`);
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('  群星之间 · 世界档案 — Build');
  console.log('========================================\n');

  // Step 1: Build JS bundles
  try {
    await buildJS();
  } catch (e) {
    console.error('[esbuild] JS build failed:', e.message);
    process.exit(1);
  }
  console.log('');

  // Step 2: Copy CSS
  await buildCSS();

  // Keep the reviewed B4 preview public; remove every older throwaway prototype.
  removeLocalPrototypeArtifacts();

  // Step 3: Optimize images (WebP generation)
  await buildImages();

  // Step 4: Verify critical output files
  const criticalFiles = [
    'js/bundle.js',
    'js/star-map-2d.js',
    'js/virtual-timeline.js',
  ];
  for (const f of criticalFiles) {
    const fp = path.join(DIST, f);
    if (!fs.existsSync(fp)) {
      console.error(`[build] Missing critical file: ${f}`);
      process.exit(1);
    }
  }

  console.log('\n========================================');
  console.log('  Build complete! Output: dist/');
  console.log('========================================');
}

main().catch(error => {
  console.error('[build] Fatal error:', error);
  process.exitCode = 1;
});
