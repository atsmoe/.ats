const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isReleaseVersion } = require('../scripts/check-release-notes.js');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARKNIGHTS_TOPIC_PAGES = [
  ['arknights-is-ceobe.html', 'if-ceobe'],
  ['arknights-is-phantom.html', 'if-phantom'],
  ['arknights-is-mizuki.html', 'if-mizuki'],
  ['arknights-is-sami.html', 'if-sami'],
  ['arknights-is-sarkaz.html', 'if-sarkaz-endless'],
  ['arknights-is-sui.html', 'if-sui-realm'],
  ['arknights-is-blackflow.html', 'if-blackflow'],
];
const FORMAL_PAGES = [
  'index.html',
  'arknights.html',
  'arknights-chronicle.html',
  'arknights-stories.html',
  'arknights-integrated-strategies.html',
  ...ARKNIGHTS_TOPIC_PAGES.map(([topicPage]) => topicPage),
  'wh40k.html',
  'wh40k-chronicle.html',
  'wh40k-factions.html',
  'wh40k-war-zones.html',
  'ff14.html',
  'ff14-chronicle.html',
  'ff14-reflections.html',
  'ff14-journeys.html',
  'about.html',
  'changelog.html',
];

function readDist(relativePath) {
  return fs.readFileSync(path.join(DIST, relativePath), 'utf8');
}

test('every local entry script uses the same revision as its page', () => {
  const versions = new Set();
  for (const page of fs.readdirSync(DIST).filter(file => file.endsWith('.html'))) {
    const html = readDist(page);
    const version = html.match(/<body\b[^>]*\bdata-version="([^"]+)"/)?.[1];
    assert.ok(version, `${page} must expose its build revision`);
    versions.add(version);
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
    assert.ok(scripts.length, `${page} must load its entry script`);
    for (const source of scripts) {
      const url = new URL(source.replaceAll('&amp;', '&'), 'https://archive.test/.ats/');
      assert.equal(url.origin, 'https://archive.test', `${page} keeps scripts on the same origin`);
      assert.equal(url.searchParams.get('v'), version, `${page}: ${source} must bypass earlier script revisions`);
      const file = url.pathname.replace(/^\/\.ats\//, '');
      assert.ok(fs.existsSync(path.join(DIST, file)), `${page}: ${source} resolves to a built script`);
    }
  }
  assert.equal(versions.size, 1, 'all pages in one deployment share a revision');
});

function collectAssetReferences(value, references = new Set()) {
  if (typeof value === 'string' && value.startsWith('./assets/')) {
    references.add(value.slice(2));
    return references;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectAssetReferences(item, references);
    return references;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssetReferences(item, references);
  }

  return references;
}

function collectOutputFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectOutputFiles(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

test('production build contains every public page and data file', () => {
  const required = [
    'index.html',
    'arknights.html',
    'arknights-chronicle.html',
    'arknights-integrated-strategies.html',
    ...ARKNIGHTS_TOPIC_PAGES.map(([page]) => page),
    'wh40k.html',
    'wh40k-chronicle.html',
    'wh40k-factions.html',
    'wh40k-war-zones.html',
    'ff14.html',
    'ff14-chronicle.html',
    'ff14-reflections.html',
    'ff14-journeys.html',
    'about.html',
    'changelog.html',
    'data/arknights.json',
    'data/wh40k.json',
    'data/ff14.json',
    'data/event-index.json',
    'js/bundle.js',
    'js/star-map-3d.js',
    'js/star-map-b4-prototype.js',
    'js/star-map-b5-prototype.js',
    'js/virtual-timeline.js',
    'star-map-b4-prototype.html',
    'star-map-b5-prototype.html',
  ];

  for (const relativePath of required) {
    assert.ok(fs.existsSync(path.join(DIST, relativePath)), `missing dist/${relativePath}`);
  }

  const outputFiles = collectOutputFiles(DIST);
  const prototypePages = outputFiles
    .filter(filePath => (
      /^star-map(?:-[a-z0-9]+)*-prototype\.html$/.test(path.basename(filePath))
      && path.basename(filePath) !== 'star-map-b4-prototype.html'
      && path.basename(filePath) !== 'star-map-b5-prototype.html'
    ));
  const prototypeScripts = outputFiles
    .filter(filePath => (
      (
        /^star-map(?:-[a-z0-9]+)*-prototype\.js$/.test(path.basename(filePath))
        && path.basename(filePath) !== 'star-map-b4-prototype.js'
        && path.basename(filePath) !== 'star-map-b5-prototype.js'
      )
      || path.basename(filePath) === 'b4-cosmic-stage.js'
    ));

  assert.deepEqual(prototypePages, [], 'throwaway star-map pages must never be published');
  assert.deepEqual(prototypeScripts, [], 'throwaway star-map scripts must never be published');
  assert.ok(
    !fs.existsSync(path.join(DIST, 'js', 'prototypes')),
    'throwaway prototype source directories must never be published',
  );
  assert.ok(
    !fs.existsSync(path.join(DIST, 'assets', 'prototypes')),
    'throwaway prototype assets must never be published',
  );
});

test('public page titles retain the complete site name', () => {
  for (const page of FORMAL_PAGES) {
    assert.match(readDist(page), /<title>[^<]*群星之间/, `${page} title must include 群星之间`);
  }
});

test('formal pages expose complete discovery and sharing metadata', () => {
  for (const page of FORMAL_PAGES) {
    const html = readDist(page);
    const canonicalUrl = page === 'index.html'
      ? 'https://atsmoe.github.io/.ats/'
      : `https://atsmoe.github.io/.ats/${page}`;

    assert.match(html, /<meta name="description" content="[^"]{20,}">/, `${page} description`);
    assert.ok(html.includes(`<link rel="canonical" href="${canonicalUrl}">`), `${page} canonical URL`);
    assert.match(html, /<meta property="og:title" content="[^"]+">/, `${page} Open Graph title`);
    assert.match(html, /<meta property="og:description" content="[^"]{20,}">/, `${page} Open Graph description`);
    assert.ok(html.includes(`<meta property="og:url" content="${canonicalUrl}">`), `${page} Open Graph URL`);
    assert.match(html, /<meta property="og:type" content="website">/);
    assert.match(html, /<meta property="og:site_name" content="群星之间 · 世界档案">/);
    assert.match(html, /<meta name="twitter:card" content="summary">/);
  }

  assert.match(readDist('index.html'), /<title>群星之间 · 世界档案<\/title>/);
  assert.doesNotMatch(readDist('index.html'), /<title>群星之间 — 群星之间/);
});

test('the About page describes the archive product rather than a timeline-only site', () => {
  const about = readDist('about.html');
  assert.match(about, /非官方的虚构世界档案/);
  assert.match(about, /明日方舟、战锤40K与最终幻想XIV/);
  assert.match(about, /编年页适合按时间查阅事件/);
  assert.doesNotMatch(about, /交互式编年史网站/);
});

test('the current project version is documented for visitors and maintainers', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const versionLabel = `V${pkg.version}`;
  const changelog = fs.readFileSync(path.join(ROOT, 'docs', '更新日志.md'), 'utf8');
  const developmentLog = fs.readFileSync(path.join(ROOT, 'docs', '开发日志.md'), 'utf8');

  assert.match(changelog, new RegExp(`^## ${versionLabel}\\b`, 'm'));
  assert.match(developmentLog, new RegExp(`^.*${versionLabel}：`, 'm'));
});

test('only three-part versions are eligible for GitHub deployment', () => {
  assert.equal(isReleaseVersion('2.5.6'), true);
  assert.equal(isReleaseVersion('2.5.6.1'), false);
  assert.equal(isReleaseVersion('2.5.6.12'), false);
});

test('GitHub deployment checks the complete pushed commit range', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

  assert.match(
    workflow,
    /fetch-depth:\s*0/,
    'release-note verification needs full history when one push contains multiple commits',
  );
});

test('the star map and all archive pages keep the documented two-entry boundary', () => {
  const index = readDist('index.html');
  assert.match(index, /src="\.\/js\/star-map-3d\.js(?:\?[^"\s]*)?"/);
  assert.doesNotMatch(index, /src="\.\/js\/bundle\.js(?:\?[^"\s]*)?"/);
  assert.match(index, /data-star-map-version-switch/);
  assert.match(index, /href="\.\/star-map-b4-prototype\.html"/);
  assert.match(index, /href="\.\/star-map-b5-prototype\.html"/);
  assert.match(readDist('star-map-b5-prototype.html'), /src="\.\/js\/star-map-b5-prototype\.js(?:\?[^"\s]*)?"/);

  const arknightsChronicle = readDist('arknights-chronicle.html');
  assert.match(arknightsChronicle, /src="\.\/js\/bundle\.js(?:\?[^"\s]*)?"/);
  assert.doesNotMatch(arknightsChronicle, /src="\.\/js\/virtual-timeline\.js(?:\?[^"\s]*)?"/);

  for (const page of ['wh40k-chronicle.html', 'ff14-chronicle.html']) {
    const html = readDist(page);
    assert.match(html, /src="\.\/js\/bundle\.js(?:\?[^"\s]*)?"/, `${page} must load the world bundle`);
    assert.match(html, /src="\.\/js\/virtual-timeline\.js(?:\?[^"\s]*)?"/, `${page} must load the timeline engine`);
    assert.doesNotMatch(html, /src="\.\/js\/star-map-3d\.js(?:\?[^"\s]*)?"/, `${page} must not load Three.js`);
  }

  for (const page of [
    'arknights.html',
    'arknights-integrated-strategies.html',
    ...ARKNIGHTS_TOPIC_PAGES.map(([topicPage]) => topicPage),
  ]) {
    const html = readDist(page);
    assert.match(html, /src="\.\/js\/bundle\.js(?:\?[^"\s]*)?"/, `${page} needs the shared archive bundle`);
    assert.doesNotMatch(html, /src="\.\/js\/virtual-timeline\.js(?:\?[^"\s]*)?"/, `${page} must not load the timeline engine`);
  }

  for (const page of ['wh40k.html', 'wh40k-factions.html', 'wh40k-war-zones.html']) {
    const html = readDist(page);
    assert.match(html, /src="\.\/js\/bundle\.js(?:\?[^"\s]*)?"/, `${page} needs the shared archive bundle`);
    assert.doesNotMatch(html, /src="\.\/js\/virtual-timeline\.js(?:\?[^"\s]*)?"/, `${page} must not load the timeline engine`);
  }

  for (const page of ['ff14.html', 'ff14-reflections.html', 'ff14-journeys.html']) {
    const html = readDist(page);
    assert.match(html, /src="\.\/js\/bundle\.js(?:\?[^"\s]*)?"/, `${page} needs the shared archive bundle`);
    assert.doesNotMatch(html, /src="\.\/js\/virtual-timeline\.js(?:\?[^"\s]*)?"/, `${page} must not load the timeline engine`);
  }
});

test('world data and the global event index are valid build artifacts', () => {
  const index = JSON.parse(readDist('data/event-index.json'));
  const locations = Object.values(index);
  const minimumEvents = {
    arknights: 895,
    wh40k: 115,
    ff14: 433,
  };

  assert.ok(locations.length >= 1440, `event index unexpectedly shrank to ${locations.length} events`);
  assert.ok(index['ff14-s1-001'], 'FF14 first-shard cross-reference target must be indexed');
  assert.ok(index['ff14-s13-001'], 'FF14 thirteenth-shard cross-reference target must be indexed');

  for (const [worldId, minimum] of Object.entries(minimumEvents)) {
    const count = locations.filter(location => location.worldId === worldId).length;
    assert.ok(count >= minimum, `${worldId} event index unexpectedly shrank to ${count}`);
  }

  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    const data = JSON.parse(readDist(`data/${worldId}.json`));
    assert.equal(data.world.id, worldId);
    assert.ok(Array.isArray(data.branches) && data.branches.length > 0, `${worldId} needs branches`);
  }

  const arknights = JSON.parse(readDist('data/arknights.json'));
  const wh40k = JSON.parse(readDist('data/wh40k.json'));
  assert.equal(
    arknights.branches.some(branch => branch.id === 'if-other'),
    false,
    'unsourced speculative Arknights IF records must not be published',
  );
  assert.equal(
    wh40k.branches.some(branch => branch.id === 'if-heresy'),
    false,
    'uncited fan counterfactuals must not be published as WH40K canon',
  );
  assert.equal(wh40k.archive?.factionFamilies?.length, 9);
  assert.equal(wh40k.archive?.warZones?.length, 6);
});

test('Arknights publishes seven sourced integrated-strategy contexts with stable records', () => {
  const arknights = JSON.parse(readDist('data/arknights.json'));
  const eventIndex = JSON.parse(readDist('data/event-index.json'));
  const integrated = arknights.branches.find(branch => branch.id === 'if-integrated');
  const topics = [...(integrated?.subBranches || [])].sort((a, b) => a.order - b.order);

  assert.deepEqual(topics.map(topic => topic.id), [
    'if-ceobe',
    'if-phantom',
    'if-mizuki',
    'if-sami',
    'if-sarkaz-endless',
    'if-sui-realm',
    'if-blackflow',
  ]);
  assert.deepEqual(topics.map(topic => topic.endings.length), [3, 4, 4, 4, 5, 5, 3]);
  for (const topic of topics) {
    assert.ok(topic.sources.some(source => /^https?:\/\//.test(source.url)), `${topic.id} needs a source`);
    assert.ok(topic.lastReviewedAt, `${topic.id} needs a review date`);
    for (const ending of topic.endings) {
      assert.ok(ending.id, `${topic.id} ending needs a stable ID`);
      assert.ok(eventIndex[ending.id], `${ending.id} must use the global event index`);
      assert.ok(ending.sources.some(source => /^https?:\/\//.test(source.url)), `${ending.id} needs a source`);
      assert.ok(ending.aftermath?.length >= 12, `${ending.id} needs a substantive aftermath`);
    }
  }
  assert.doesNotMatch(JSON.stringify(topics), /二手整理|待完工/);
});

test('public pages retain the critical navigation and interaction containers', () => {
  const index = readDist('index.html');
  assert.match(index, /id="galaxy-markers"/);
  assert.match(index, /data-world="arknights"/);
  assert.match(index, /data-world="wh40k"/);
  assert.match(index, /data-world="ff14"/);

  const arknightsChronicle = readDist('arknights-chronicle.html');
  assert.match(arknightsChronicle, /<main id="main-content"[^>]*>/);
  assert.match(arknightsChronicle, /id="ark-chronicle-directory"/);
  assert.match(arknightsChronicle, /id="ark-reader"/);
  assert.match(arknightsChronicle, /id="ark-reader-scroll"/);
  assert.doesNotMatch(arknightsChronicle, /id="tl-container"|id="event-modal"|id="tl-branches"/);
  assert.ok(
    (arknightsChronicle.match(/https:\/\/prts\.wiki/g) || []).length >= 800,
    'Arknights no-script output must retain the PRTS source trail',
  );

  for (const page of ['wh40k-chronicle.html', 'ff14-chronicle.html']) {
    const html = readDist(page);
    assert.match(html, /<main id="main-content"[^>]*>/, `${page} needs a main content landmark`);
    assert.match(html, /id="tl-container"/, `${page} needs the timeline container`);
    assert.match(html, /id="event-modal"/, `${page} needs the event modal`);
    assert.match(html, /id="tl-branches"/, `${page} needs branch navigation`);
  }

  const arknights = readDist('arknights.html');
  assert.match(arknights, /id="terra-world"/, 'Arknights needs a Terra world portal');
  assert.match(arknights, /href="\.\/arknights-chronicle\.html"/);
  assert.match(arknights, /href="\.\/arknights-integrated-strategies\.html"/);
  assert.match(arknights, /id="terra-map-dialog"/);
  assert.match(arknights, /terra-community-administrative-map\.png/);
  assert.match(arknights, /terra-community-administrative-map-preview\.webp/);
  assert.equal(
    (arknights.match(/class="terra-chronicle-launch"/g) || []).length,
    1,
    'Arknights home should expose one route that actually leaves the page',
  );
  assert.doesNotMatch(arknights, /class="terra-entry-grid"/);
  assert.match(arknights, /data-terra-map-zoom/);
  assert.match(arknights, /download="terra-community-administrative-map\.png"/);
  assert.doesNotMatch(arknights, />专题观测</);
  for (const [topicPage] of ARKNIGHTS_TOPIC_PAGES) {
    assert.match(arknights, new RegExp(`href="\\.\\/${topicPage}"`));
  }
  assert.doesNotMatch(arknights, /id="tl-container"|id="ark-dossier"/);

  const isIndex = readDist('arknights-integrated-strategies.html');
  assert.match(isIndex, /id="is-index"/);
  for (const [topicPage] of ARKNIGHTS_TOPIC_PAGES) {
    assert.match(isIndex, new RegExp(`href="\\.\\/${topicPage}"`));
  }

  for (const [topicPage, contextId] of ARKNIGHTS_TOPIC_PAGES) {
    const topic = readDist(topicPage);
    assert.match(topic, /id="is-topic"/);
    assert.match(topic, new RegExp(`data-context="${contextId}"`));
    assert.match(topic, /id="ark-spoiler-gate"/);
    assert.match(topic, /data-topic-content/);
    assert.doesNotMatch(topic, /二手整理|待完工|CALIBRATING/);
  }

  const wh40k = readDist('wh40k.html');
  assert.match(wh40k, /id="imperium-nihilus"/);
  assert.match(wh40k, /href="\.\/wh40k-chronicle\.html"/);
  assert.match(wh40k, /href="\.\/wh40k-factions\.html"/);
  assert.match(wh40k, /href="\.\/wh40k-war-zones\.html"/);
  assert.doesNotMatch(wh40k, /id="tl-container"/);

  const factions = readDist('wh40k-factions.html');
  assert.match(factions, /id="faction-index"/);
  assert.equal((factions.match(/data-faction-filter=/g) || []).length, 4);
  assert.equal((factions.match(/data-faction-filter="all" aria-pressed="true"/g) || []).length, 1);
  assert.equal((factions.match(/aria-pressed="false"/g) || []).length, 3);
  assert.equal((factions.match(/class="wh-faction-card/g) || []).length, 9);
  for (const recordId of ['wh-121', 'wh-122', 'wh-123']) {
    assert.match(factions, new RegExp(`href="\\.\\/wh40k-chronicle\\.html#${recordId}"`));
  }
  assert.match(factions, /wh-faction-detail\[hidden\]\{display:block!important\}/);
  assert.doesNotMatch(factions, /下一轮|后续核验|VERIFIED/);

  const warZones = readDist('wh40k-war-zones.html');
  assert.match(warZones, /id="war-zone-index"/);
  assert.equal((warZones.match(/class="wh-zone-card/g) || []).length, 6);
  assert.match(warZones, /href="\.\/wh40k-chronicle\.html#wh-115"/);
  assert.match(warZones, /wh-zone-source\[hidden\]\{display:block!important\}/);

  const whChronicle = readDist('wh40k-chronicle.html');
  assert.match(whChronicle, /CURATED SEQUENCE/);
  assert.doesNotMatch(whChronicle, /VERIFIED SEQUENCE/);
  assert.match(whChronicle, /id="wh-noscript-title"/);
  assert.equal((whChronicle.match(/class="wh-noscript-record/g) || []).length, 123);
  assert.equal((whChronicle.match(/class="wh-noscript-record is-disputed/g) || []).length, 7);
  for (const recordId of ['wh-115', 'wh-121', 'wh-122', 'wh-123']) {
    assert.match(whChronicle, new RegExp(`id="${recordId}"`));
  }

  const ff14 = readDist('ff14.html');
  assert.match(ff14, /id="ff14-world"/);
  assert.match(ff14, /href="\.\/ff14-chronicle\.html"/);
  assert.match(ff14, /href="\.\/ff14-reflections\.html"/);
  assert.match(ff14, /href="\.\/ff14-journeys\.html"/);
  assert.doesNotMatch(ff14, /id="tl-container"/);

  const reflections = readDist('ff14-reflections.html');
  assert.match(reflections, /id="reflection-atlas"/);
  assert.equal((reflections.match(/data-reflection-id=/g) || []).length, 14);
  assert.match(reflections, /data-reflection-id="reflection-9"/);
  assert.match(reflections, /SOURCE \/ ORIGIN/);
  assert.doesNotMatch(reflections, /REFLECTION \/ 00/);

  const journeys = readDist('ff14-journeys.html');
  assert.match(journeys, /id="journey-constellation"/);
  assert.equal((journeys.match(/data-journey-id=/g) || []).length, 8);
  assert.match(journeys, /data-journey-id="dawntrail"/);

  const ff14Chronicle = readDist('ff14-chronicle.html');
  assert.match(ff14Chronicle, /id="ff14-noscript-title"/);
  assert.match(ff14Chronicle, /id="ff14-337"/);
});

test('every media file referenced by production data exists', () => {
  for (const worldId of ['arknights', 'wh40k', 'ff14']) {
    const data = JSON.parse(readDist(`data/${worldId}.json`));
    const references = collectAssetReferences(data);
    for (const relativePath of references) {
      assert.ok(
        fs.existsSync(path.join(DIST, relativePath)),
        `${worldId} references missing dist/${relativePath}`,
      );
    }
  }
});

test('bundle sizes stay within the intended page budgets', () => {
  const worldBundle = fs.statSync(path.join(DIST, 'js', 'bundle.js')).size;
  const starMapBundle = fs.statSync(path.join(DIST, 'js', 'star-map-3d.js')).size;
  const b4Bundle = fs.statSync(path.join(DIST, 'js', 'star-map-b4-prototype.js')).size;
  const b5Bundle = fs.statSync(path.join(DIST, 'js', 'star-map-b5-prototype.js')).size;

  assert.ok(worldBundle <= 180 * 1024, `world bundle is ${(worldBundle / 1024).toFixed(1)} KiB`);
  assert.ok(starMapBundle <= 600 * 1024, `star map bundle is ${(starMapBundle / 1024).toFixed(1)} KiB`);
  assert.ok(b4Bundle <= 600 * 1024, `B4 preview bundle is ${(b4Bundle / 1024).toFixed(1)} KiB`);
  assert.ok(b5Bundle <= 80 * 1024, `B5 preview bundle is ${(b5Bundle / 1024).toFixed(1)} KiB`);
});

test('desktop timeline geometry keeps both event columns inside the viewport', () => {
  const timelineCss = fs.readFileSync(path.join(ROOT, 'src', 'css', 'timeline.css'), 'utf8');
  const responsiveCss = fs.readFileSync(path.join(ROOT, 'src', 'css', 'responsive.css'), 'utf8');

  assert.match(timelineCss, /\.tl-axis\s*\{[^}]*left:\s*50%/s);
  assert.match(timelineCss, /\.tl-event\.left\s*\{\s*margin-left:\s*calc\(50% - 440px - 48px\)/);
  assert.match(timelineCss, /\.tl-event\.right\s*\{\s*margin-left:\s*calc\(50% \+ 48px\)/);
  assert.match(timelineCss, /\.axis-node\s*\{[^}]*top:\s*50%/s);
  assert.match(responsiveCss, /@media \(min-width: 769px\) and \(max-width: 1024px\)[\s\S]*\.tl-axis\s*\{\s*left:\s*32px/);

  for (const viewportWidth of [1920, 1440, 1280, 1024, 900, 768, 390]) {
    const cardBounds = viewportWidth > 1024
      ? [
        { left: viewportWidth / 2 - 440 - 48, width: 440 },
        { left: viewportWidth / 2 + 48, width: 440 },
      ]
      : viewportWidth > 768
        ? [{ left: 64, width: Math.min(viewportWidth - 96, 640) }]
        : [{ left: 36, width: Math.min(viewportWidth - 52, 440) }];

    for (const bounds of cardBounds) {
      assert.ok(bounds.left >= 0, `${viewportWidth}px timeline starts outside the viewport`);
      assert.ok(
        bounds.left + bounds.width <= viewportWidth,
        `${viewportWidth}px timeline ends outside the viewport`,
      );
    }
  }
});
