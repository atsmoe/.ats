const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function loadSearchData() {
  const compiled = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/js/modules/archive-search-data.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

function checked(result) {
  if (result.errors?.length) throw new Error(result.errors.join('\n'));
  return result;
}

async function buildSearch(dist = path.join(ROOT, 'dist')) {
  const { buildSearchRecords, SEARCH_WORLD_IDS, segmentSearchText } = loadSearchData();
  const records = buildSearchRecords(SEARCH_WORLD_IDS.map(id => (
    JSON.parse(fs.readFileSync(path.join(dist, 'data', `${id}.json`), 'utf8'))
  )));
  const eventIndex = JSON.parse(fs.readFileSync(path.join(dist, 'data/event-index.json'), 'utf8'));
  if (records.length !== Object.keys(eventIndex).length || records.some(record => (
    eventIndex[record.meta.recordId]?.worldId !== record.meta.worldId
  ))) throw new Error('Search coverage differs from the canonical event index');
  for (const record of records) {
    const page = new URL(record.url, 'https://archive.invalid/').pathname.slice(1);
    if (!fs.existsSync(path.join(dist, page))) throw new Error(`Search target is missing: ${page}`);
  }

  const pagefind = await import('pagefind');
  const output = path.join(dist, 'pagefind');
  const staging = path.join(dist, '.pagefind-build');
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    const { index } = checked(await pagefind.createIndex({ forceLanguage: 'zh', writePlayground: false }));
    if (!index) throw new Error('Pagefind did not create an index');
    for (const record of records) checked(await index.addCustomRecord({
      ...record,
      content: segmentSearchText(record.content),
    }));
    checked(await index.writeFiles({ outputPath: staging }));
    fs.writeFileSync(path.join(staging, 'archive.json'), JSON.stringify({
      schemaVersion: 1,
      version: require('../package.json').version,
      total: records.length,
      worlds: Object.fromEntries(SEARCH_WORLD_IDS.map(id => [id,
        records.filter(record => record.meta.worldId === id).length,
      ])),
    }, null, 2) + '\n');
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(staging, output);
    console.log(`[search] Indexed ${records.length} records across ${SEARCH_WORLD_IDS.length} worlds.`);
  } finally {
    await pagefind.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { buildSearch, loadSearchData };

if (require.main === module) buildSearch().catch(error => {
  console.error('[search]', error);
  process.exitCode = 1;
});
