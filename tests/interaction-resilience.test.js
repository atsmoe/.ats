const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// An optional immutable Git baseline reproduces failures without changing the worktree.
function source(name) {
  const file = `src/js/modules/${name}.js`;
  return process.env.INTERACTION_TEST_BASELINE
    ? execFileSync('git', ['show', `${process.env.INTERACTION_TEST_BASELINE}:${file}`], { cwd: ROOT, encoding: 'utf8' })
    : fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function node() {
  const listeners = new Map();
  const classes = new Set();
  return {
    style: {}, dataset: {}, hidden: false, isConnected: true,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    setAttribute() {}, removeAttribute() {}, focus() {},
    querySelectorAll: () => [], getContext: () => null,
    addEventListener(type, callback, options = {}) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
      options.signal?.addEventListener('abort', () => listeners.get(type).delete(callback), { once: true });
    },
    dispatch(type, event) { for (const callback of [...(listeners.get(type) || [])]) callback(event); },
    count(type) { return listeners.get(type)?.size || 0; },
  };
}

function key(value, extra = {}) {
  return { key: value, target: { tagName: 'DIV', closest: () => null }, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, ...extra };
}

test('star map survives a cached pagehide and still opens a world; final pagehide releases listeners', () => {
  const elements = new Map();
  const marker = node();
  marker.dataset.world = 'arknights';
  const document = Object.assign(node(), {
    body: node(), getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    querySelectorAll: selector => selector === '.galaxy-marker' ? [marker] : [],
  });
  const window = node();
  const context = { document, window, navigator: { maxTouchPoints: 0 }, AbortController,
    requestAnimationFrame: callback => callback(), setTimeout, clearTimeout,
    GALAXIES: { arknights: { name: '泰拉', subtitle: '明日方舟', description: '泰拉记录', calendar: '泰拉历' } }, ANIM: {} };
  vm.runInNewContext(source('star-map').replace(/^import .*;\r?\n/gm, '').replace(/export function /g, 'function ') + '\ninitStarMap();', context);
  window.dispatch('pagehide', { persisted: true });
  assert.equal(marker.count('click'), 1, 'bfcache must retain world interaction');
  marker.dispatch('click', { preventDefault() {}, stopPropagation() {} });
  assert.equal(document.getElementById('detail-title').textContent, '泰拉');
  assert.equal(document.getElementById('galaxy-detail').classList.contains('active'), true);
  window.dispatch('pagehide', { persisted: false });
  assert.equal(marker.count('click'), 0);
  assert.equal(document.count('keydown'), 0);
  assert.equal(window.count('pagehide'), 0);
});

for (const failureAt of ['scene', 'interaction', null]) {
  test(`homepage initialization preserves navigation with ${failureAt || 'no'} failure`, () => {
    const calls = [];
    const body = node();
    const context = { document: { body, getElementById: () => null }, ANIM: {}, console: { warn() {} },
      initNav: () => calls.push('navigation'),
      initStarMap3D() { calls.push('scene'); if (failureAt === 'scene') throw new Error('WebGL unavailable'); },
      initStarMap() { calls.push('interaction'); if (failureAt === 'interaction') throw new Error('partial setup'); },
      destroyStarMap: () => calls.push('dispose-interaction'), destroyStarMap3D: () => calls.push('dispose-scene') };
    assert.doesNotThrow(() => vm.runInNewContext(source('star-map-entry').replace(/^import .*;\r?\n/gm, ''), context));
    assert.equal(body.classList.contains('star-map-fallback'), Boolean(failureAt));
    if (failureAt) {
      assert.ok(calls.includes('navigation'));
      assert.ok(calls.includes('dispose-scene'));
      assert.ok(calls.includes('dispose-interaction'));
    } else assert.deepEqual(calls.slice().sort(), ['interaction', 'navigation', 'scene']);
  });
}

function ff14Keyboard() {
  const branchNav = node();
  const document = node();
  const clicks = [];
  const jumps = [];
  const buttons = [0, 1, 2].map(id => ({ click: () => clicks.push(id), focus() {} }));
  branchNav.querySelectorAll = () => buttons;
  document.activeElement = buttons[1];
  const chapters = [0, 1, 2].map(id => ({ id: `chapter-${id}`, eventIds: [`event-${id}`] }));
  const context = { branchNav, document, window: node(), root: node(), returnBar: { querySelector: () => node() },
    signal: new AbortController().signal, chaptersFor: () => chapters, activeRootId: 'mainline', activeEventId: 'event-1',
    model: { chapterByEventId: new Map([['event-1', chapters[1]]]) }, scrollToEvent: id => jumps.push(id) };
  const text = source('ff14-reader');
  // Execute the actual event registrations; render/data routines are outside this keyboard boundary.
  vm.runInNewContext(text.slice(text.indexOf("  branchNav.addEventListener('click'"), text.indexOf("  if (typeof IntersectionObserver !== 'function') {", text.indexOf("  branchNav.addEventListener('click'"))), context);
  return { branchNav, document, clicks, jumps };
}

test('FFXIV leaves Alt+arrows available for browser history, including while a branch button has focus', () => {
  const reader = ff14Keyboard();
  for (const arrow of ['ArrowLeft', 'ArrowRight']) {
    const event = key(arrow, { altKey: true });
    reader.document.dispatch('keydown', event);
    assert.equal(event.defaultPrevented, false);
    reader.branchNav.dispatch('keydown', event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(reader.clicks, []);
  assert.deepEqual(reader.jumps, []);
});

test('FFXIV branch navigation keeps plain arrows and ignores composing or already handled keystrokes', () => {
  const reader = ff14Keyboard();
  reader.branchNav.dispatch('keydown', key('ArrowRight'));
  assert.deepEqual(reader.clicks, [2]);
  for (const flags of [{ isComposing: true }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    reader.branchNav.dispatch('keydown', key('ArrowLeft', flags));
  }
  assert.deepEqual(reader.clicks, [2]);
});

function wh40kKeyboard() {
  const changes = [];
  const context = { overlay: { hidden: false, querySelectorAll: () => [] }, document: {},
    adjacentChapter: delta => changes.push(delta), closeReader: () => changes.push('close'), search: { focus: () => changes.push('search') } };
  const text = source('wh40k-chronicle-reader');
  vm.runInNewContext(text.slice(text.indexOf('  function onKeydown(event)'), text.indexOf("  reading.addEventListener('scroll'")) + '\nglobalThis.handle = onKeydown;', context);
  return { handle: context.handle, changes };
}

test('WH40K permits brackets and slash as text in all supported editable targets', () => {
  const reader = wh40kKeyboard();
  const editableCases = [
    ['INPUT', 'input'], ['TEXTAREA', 'textarea'], ['SELECT', 'select'],
    ['SPAN', '[contenteditable]:not([contenteditable="false"])'], ['DIV', '[role="textbox"]'],
  ];
  for (const [tagName, matchingSelector] of editableCases) {
    const target = { tagName, closest: selector => selector.split(',').map(part => part.trim()).includes(matchingSelector) ? {} : null };
    for (const character of ['[', ']', '/']) {
      const event = key(character, { target });
      reader.handle(event);
      assert.equal(event.defaultPrevented, false, `${tagName} ${character} must remain available for text entry`);
    }
  }
  assert.deepEqual(reader.changes, []);
});

test('WH40K retains plain chapter shortcuts and Escape while respecting modifiers and composition', () => {
  const reader = wh40kKeyboard();
  for (const character of ['[', ']', '/']) reader.handle(key(character));
  assert.deepEqual(reader.changes, [-1, 1, 'search']);
  for (const flags of [{ isComposing: true }, { defaultPrevented: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    reader.handle(key(']', flags));
  }
  assert.deepEqual(reader.changes, [-1, 1, 'search']);
  reader.handle(key('Escape', { target: { closest: () => ({}) } }));
  assert.deepEqual(reader.changes, [-1, 1, 'search', 'close']);
});
