const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readDist(relativePath) {
  return fs.readFileSync(path.join(DIST, relativePath), 'utf8');
}

test('navigation positioning is scoped to the site header', () => {
  const css = read('src/css/nav.css');

  assert.match(css, /^#nav\s*\{/m);
  assert.match(css, /^#nav\.visible\s*\{/m);
  assert.doesNotMatch(css, /^nav(?:\.visible)?\s*\{/m);
});

test('site shell fails open when an entry bundle does not run', () => {
  const template = read('src/_includes/base.njk');
  const baseCss = read('src/css/base.css');
  const navCss = read('src/css/nav.css');

  assert.match(template, /id="portal-arrival"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(
    template,
    /id="portal-arrival"[^>]*style=/,
    'the blocking overlay must not depend on inline styles that cannot fail open',
  );
  assert.match(
    baseCss,
    /#portal-arrival\s*\{[^}]*animation:\s*portal-arrival-failsafe/s,
    'the overlay needs a CSS-only watchdog when the entry bundle is unavailable',
  );
  assert.match(
    baseCss,
    /@keyframes portal-arrival-failsafe\s*\{[\s\S]*opacity:\s*0;[\s\S]*pointer-events:\s*none;[\s\S]*visibility:\s*hidden;/,
  );
  assert.doesNotMatch(
    navCss,
    /^#nav\s*\{[^}]*transform:\s*translateY\(-100%\)/ms,
    'navigation must not remain off-screen when JavaScript fails',
  );
  assert.match(navCss, /^#nav\s*\{[^}]*animation:\s*nav-enter/ms);
});

test('site navigation exposes a bypass link and one current destination', () => {
  const cases = [
    ['index.html', ['群星之间']],
    ['arknights.html', ['明日方舟', '明日方舟']],
    ['changelog.html', ['更新日志', '更新日志']],
    ['about.html', ['关于', '关于']],
  ];

  for (const [page, expectedCurrentLabels] of cases) {
    const html = readDist(page);
    assert.match(html, /<a class="skip-link" href="#main-content">跳到主要内容<\/a>/);
    assert.match(html, /<main id="main-content" tabindex="-1">/);

    const currentLabels = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/g)]
      .map(match => match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ''));
    assert.deepEqual(currentLabels, expectedCurrentLabels, `${page} current navigation state`);
  }
});

test('integrated-strategy card metadata remains readable', () => {
  const css = read('src/css/arknights-world.css');
  assert.match(
    css,
    /\.is-index-runtime-meta\s*\{[^}]*font:\s*var\(--site-min-font-size\)\/1\.25/s,
    'card result metadata must honor the global 12px minimum',
  );
});

test('mobile navigation is hidden from assistive navigation until opened', () => {
  const html = readDist('arknights.html');

  assert.match(
    html,
    /id="nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="nav-mobile-menu"/,
  );
  assert.match(
    html,
    /id="nav-mobile-menu"[^>]*aria-hidden="true"[^>]*\binert\b/,
  );
});

test('star-map worlds are real links and the detail overlay is an inert dialog', () => {
  const html = readDist('index.html');
  const css = read('src/css/star-map.css');
  const interaction = read('src/js/modules/star-map.js');
  const markers = [...html.matchAll(
    /<a\b[^>]*class="galaxy-marker"[^>]*data-world="([^"]+)"[^>]*href="([^"]+)"/g,
  )].map(match => [match[1], match[2]]);

  assert.deepEqual(markers, [
    ['arknights', './arknights.html'],
    ['wh40k', './wh40k.html'],
    ['ff14', './ff14.html'],
  ]);
  assert.match(html, /<h1\b[^>]*class="sr-only"/);
  assert.match(
    html,
    /id="galaxy-detail"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="detail-title"[^>]*aria-describedby="detail-desc"[^>]*aria-hidden="true"[^>]*\binert\b/s,
  );
  assert.match(
    css,
    /\.galaxy-marker\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    'keyboard-focusable world markers need a real hit box',
  );
  assert.match(interaction, /new AbortController\(\)/);
  assert.match(interaction, /export function destroyStarMap\(\)/);
  assert.match(interaction, /if \(!event.persisted\) destroyStarMap\(\)/);
});

test('FFXIV no-script lenses remove inactive selector controls', () => {
  const reflections = readDist('ff14-reflections.html');
  const journeys = readDist('ff14-journeys.html');

  assert.match(reflections, /<noscript><style>[^<]*\.ff-prism-map\{display:none!important\}/);
  assert.match(journeys, /<noscript><style>[^<]*\.ff-constellation\{display:none!important\}/);
});

test('FFXIV full no-script chronicle stays within the PC-first transfer budget', () => {
  const html = fs.readFileSync(path.join(DIST, 'ff14-chronicle.html'));
  const data = fs.readFileSync(path.join(DIST, 'data', 'ff14.json'));
  const combinedGzipBytes = zlib.gzipSync(html).length + zlib.gzipSync(data).length;

  assert.ok(
    combinedGzipBytes < 1100 * 1024,
    `FFXIV chronicle + canonical data grew to ${(combinedGzipBytes / 1024).toFixed(1)} KiB gzip`,
  );
});

test('timeline records expose a native keyboard action for their detail dialog', () => {
  const timeline = read('src/js/lib/virtual-timeline.js');
  const timelineUi = read('src/js/modules/timeline-ui.js');
  const css = read('src/css/timeline.css');

  assert.ok(
    (timeline.match(/className = 'event-card-open'/g) || []).length >= 2,
    'virtual and legacy renderers must both expose the detail action',
  );
  assert.match(timelineUi, /className = 'event-card-open'/);
  assert.match(timelineUi, /setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(
    timelineUi,
    /<button type="button" class="event-ref cross-world-link"/,
    'direct-rendered cross-world references must remain keyboard operable',
  );
  assert.match(css, /\.event-card-open:focus-visible\s*\{/);
});

test('chronicle event dialogs advertise adjacent-event keyboard navigation', () => {
  for (const page of [
    'src/wh40k-chronicle.njk',
    'src/ff14-chronicle.njk',
  ]) {
    const template = read(page);
    assert.match(
      template,
      /role="dialog"[^>]*aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/,
      `${page} must expose the supported arrow keys`,
    );
    assert.match(template, /class="event-modal-navigation"/);
    assert.match(template, /滚轮或方向键切换相邻事件/);
    assert.match(template, /class="event-modal-navigation-position"/);
  }
});

test('Arknights continuous reader advertises close and retains explicit chapter controls', () => {
  const template = read('src/arknights-chronicle.njk');
  assert.match(
    template,
    /role="dialog"[^>]*aria-keyshortcuts="Escape"/,
  );
  assert.doesNotMatch(template, /aria-keyshortcuts="[^"]*Alt\+Arrow(?:Left|Right)/);
  assert.match(template, /data-ark-reader-previous/);
  assert.match(template, /data-ark-reader-next/);
  assert.match(template, /data-ark-reader-progress/);
  assert.match(template, /aria-live="polite"/);
});
test('timeline modal wires keyboard and non-passive wheel navigation once', () => {
  const timelineUi = read('src/js/modules/timeline-ui.js');
  const css = read('src/css/timeline.css');

  assert.match(timelineUi, /createEventModalNavigator/);
  assert.match(timelineUi, /modalNavigator\?\.handleKey\(e\)/);
  assert.match(
    timelineUi,
    /modal\.addEventListener\('wheel', onModalWheel, \{ passive: false \}\)/,
  );
  assert.match(
    timelineUi,
    /modal\.removeEventListener\('wheel', onModalWheel\)/,
  );
  assert.match(timelineUi, /getScrollState:\s*\(\) => modalCard/);
  assert.match(timelineUi, /function onPageHide\(event\)\s*\{\s*if \(!event\.persisted\) destroyEventModal\(\);/);
  assert.match(timelineUi, /window\.addEventListener\('pagehide', onPageHide\)/);
  assert.match(timelineUi, /window\.removeEventListener\('pagehide', onPageHide\)/);
  assert.match(timelineUi, /event-modal-navigation-position/);
  assert.match(
    css,
    /\.event-modal-navigation\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*grid-row:\s*4;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*var\(--space-sm\);[^}]*padding-top:\s*var\(--space-sm\);/s,
  );
});

test('timeline modal gives adjacent records a directional reduced-motion-aware transition', () => {
  const timelineUi = read('src/js/modules/timeline-ui.js');
  const css = read('src/css/timeline.css');

  assert.match(timelineUi, /createEventModalTransition/);
  assert.match(
    timelineUi,
    /createEventModalTransition\(modal\?\.querySelector\('\.event-modal-card'\)/,
  );
  assert.match(timelineUi, /duration:\s*ANIM\.duration\.fast/);
  assert.match(timelineUi, /easing:\s*ANIM\.easing\.out/);
  assert.match(timelineUi, /function openEventModal\(evt, direction = 0\)/);
  assert.match(timelineUi, /modalTransition\?\.play\(direction\)/);
  assert.match(timelineUi, /modalTransition\?\.cancel\(\)/);
  assert.match(css, /@keyframes event-modal-content-enter-a/);
  assert.match(css, /@keyframes event-modal-content-enter-b/);
  assert.match(css, /\.event-modal-card\.is-modal-switching-a/);
  assert.match(css, /\.event-modal-card\.is-modal-switching-b/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.event-modal-card:is\([^)]*is-modal-switching-a[^)]*is-modal-switching-b[^)]*\)/,
  );
});

test('a single chronicle branch does not render a redundant navigation rail', () => {
  const timelineUi = read('src/js/modules/timeline-ui.js');
  const css = read('src/css/timeline.css');

  assert.match(timelineUi, /container\.hidden = !hasMultipleBranches/);
  assert.match(timelineUi, /aria-hidden', String\(!hasMultipleBranches\)/);
  assert.match(css, /\.tl-branches\[hidden\]\s*\{\s*display:\s*none;/);
});

test('Arknights ending cards expose a native keyboard selection action', () => {
  const topic = read('src/js/modules/arknights-integrated-strategies.js');
  const css = read('src/css/arknights-world.css');

  assert.match(topic, /element\(\s*'button',\s*'is-ending-select'/);
  assert.match(topic, /selectButton\.type = 'button'/);
  assert.match(topic, /selectButton\.setAttribute\('aria-pressed'/);
  assert.match(topic, /event\.target\.closest\('a, button, \.is-route-guide'\)/);
  assert.match(css, /\.is-ending-select:focus-visible/);
});
