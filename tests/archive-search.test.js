const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSearchData } = require('../scripts/build-search');

const ROOT = path.resolve(__dirname, '..');
const { buildSearchRecords, SEARCH_WORLD_IDS, segmentSearchText, searchTerms, compactSearchExcerpt } = loadSearchData();
const read = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const worlds = SEARCH_WORLD_IDS.map(id => read(`dist/data/${id}.json`));
const records = buildSearchRecords(worlds);

test('search covers every canonical record exactly once without mutating archives', () => {
  const before = JSON.stringify(worlds);
  const projected = buildSearchRecords(worlds);
  assert.equal(JSON.stringify(worlds), before);
  assert.deepEqual(projected.map(record => record.meta.recordId).sort(), Object.keys(read('dist/data/event-index.json')).sort());
  assert.equal(new Set(projected.map(record => record.url)).size, projected.length);
  for (const record of projected) {
    assert.deepEqual(record.filters, { world: [record.meta.worldId] });
    assert.equal(record.language, 'zh');
    assert.ok(record.content.includes(record.meta.title));
    assert.ok(record.meta.context);
  }
});

test('search includes ending conditions and routes and preserves canonical deep links', () => {
  const ending = records.find(record => record.meta.recordId === 'if-ceobe-ending-1');
  assert.equal(ending.url, './arknights-is-ceobe.html?record=if-ceobe-ending-1#if-ceobe-ending-1');
  assert.match(ending.content, /迷尘幻梦/);
  assert.match(ending.content, /未持有「手铳」/);
  assert.match(ending.content, /真菌神殿/);
  assert.doesNotMatch(ending.content, /https?:\/\/|prtsSources|lastReviewedAt/);
  assert.equal(records.find(record => record.meta.recordId === 'ff14-s1-001').url, './ff14-chronicle.html#ff14-s1-001');
  assert.equal(records.find(record => record.meta.recordId === 'wh-013').url, './wh40k-chronicle.html#wh-013');
});

test('search preserves the same disputed-source labels as the WH40K reader', () => {
  const excluded = worlds.find(world => world.world.id === 'wh40k').archive.coverage.excludedRecordIds;
  assert.ok(excluded.length > 0);
  const warnings = records.filter(record => record.meta.warning);
  assert.deepEqual(warnings.map(record => record.meta.recordId).sort(), [...excluded].sort());
  assert.ok(warnings.every(record => record.meta.warning === '来源争议 / 复核中'));
});

test('search rejects unknown worlds and duplicate IDs instead of publishing ambiguous links', () => {
  assert.throws(() => buildSearchRecords([{ world: { id: 'unknown' }, branches: [] }]), /Unknown search world/);
  assert.throws(() => buildSearchRecords([worlds[0], worlds[0]]), /Duplicate search record/);
});

test('proper names use consistent phrase boundaries and excerpts keep readable Chinese', () => {
  assert.equal(segmentSearchText('水月与深蓝之树'), '水 月 与 深 蓝 之 树');
  assert.deepEqual(searchTerms('水月 伊莎玛拉'), ['"水 月"', '"伊 莎 玛 拉"']);
  assert.deepEqual(searchTerms('亚马乌罗提'), ['"亚 马 乌 罗 提"']);
  assert.deepEqual(searchTerms('""'), []);
  assert.equal(compactSearchExcerpt('<mark>水</mark> <mark>月</mark> 与 深 蓝 之 树'), '<mark>水</mark><mark>月</mark>与深蓝之树');
  assert.equal(compactSearchExcerpt('<mark>水 </mark><mark>月 </mark>， 此 后'), '<mark>水</mark><mark>月</mark>，此后');
  assert.equal(compactSearchExcerpt('War in Heaven'), 'War in Heaven');
});

test('search layout references only defined local spacing and color tokens', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/css/archive-search.css'), 'utf8');
  const defined = new Set([...css.matchAll(/(--search-[\w.-]+)\s*:/g)].map(match => match[1]));
  for (const match of css.matchAll(/var\((--search-[\w.-]+)/g)) {
    assert.ok(defined.has(match[1]), `Undefined CSS token: ${match[1]}`);
  }
});

test('production search index agrees with the archive and has real local destinations', () => {
  const manifest = read('dist/pagefind/archive.json');
  assert.equal(manifest.version, read('package.json').version);
  assert.equal(manifest.total, records.length);
  for (const id of SEARCH_WORLD_IDS) {
    assert.equal(manifest.worlds[id], records.filter(record => record.meta.worldId === id).length);
  }
  for (const record of records) {
    const url = new URL(record.url, 'https://archive.invalid/');
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', url.pathname)), record.url);
    assert.equal(decodeURIComponent(url.hash.slice(1)), record.meta.recordId);
  }
  assert.ok(fs.statSync(path.join(ROOT, 'dist/pagefind/pagefind.js')).size > 0);
  assert.ok(!fs.existsSync(path.join(ROOT, 'dist/.pagefind-build')));
});

test('search stays in a small separate bundle with desktop and mobile navigation entries', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist/search.html'), 'utf8');
  assert.match(html, /\.\/js\/archive-search\.js/);
  assert.doesNotMatch(html, /src="\.\/js\/(?:bundle|star-map-3d)\.js(?:\?[^"\s]*)?"/);
  assert.match(html, /<noscript>[\s\S]*启用 JavaScript/);
  assert.ok(fs.statSync(path.join(ROOT, 'dist/js/archive-search.js')).size < 18000);
  for (const page of ['index', 'arknights', 'wh40k', 'ff14', 'about']) {
    const output = fs.readFileSync(path.join(ROOT, `dist/${page}.html`), 'utf8');
    assert.equal((output.match(/href="\.\/search\.html"/g) || []).length, 2, page);
    assert.doesNotMatch(output, /src="[^\"]*(?:pagefind|archive-search)/);
  }
});
