const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

async function loadNavigatorModule() {
  const source = fs.readFileSync(
    path.join(ROOT, 'src/js/modules/event-modal-navigation.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function keyEvent(key, overrides = {}) {
  return {
    key,
    preventDefaultCalled: false,
    preventDefault() { this.preventDefaultCalled = true; },
    ...overrides,
  };
}

function wheelEvent(deltaY, deltaMode = 0, overrides = {}) {
  return {
    deltaY,
    deltaMode,
    preventDefaultCalled: false,
    preventDefault() { this.preventDefaultCalled = true; },
    ...overrides,
  };
}

test('arrow keys move through adjacent events and stop at sequence boundaries', async () => {
  const { createEventModalNavigator } = await loadNavigatorModule();
  const events = [
    { id: 'event-a', title: 'A' },
    { id: 'event-b', title: 'B' },
    { id: 'event-c', title: 'C' },
  ];
  let currentId = 'event-b';
  const opened = [];
  const navigator = createEventModalNavigator({
    getEvents: () => events,
    getCurrentEventId: () => currentId,
    openEvent: event => {
      currentId = event.id;
      opened.push(event.id);
    },
  });

  const previous = keyEvent('ArrowUp');
  assert.equal(navigator.handleKey(previous), true);
  assert.equal(previous.preventDefaultCalled, true);
  assert.deepEqual(opened, ['event-a']);

  const beyondStart = keyEvent('ArrowLeft');
  assert.equal(navigator.handleKey(beyondStart), true);
  assert.equal(beyondStart.preventDefaultCalled, true);
  assert.deepEqual(opened, ['event-a']);

  const next = keyEvent('ArrowDown');
  assert.equal(navigator.handleKey(next), true);
  assert.equal(next.preventDefaultCalled, true);
  assert.deepEqual(opened, ['event-a', 'event-b']);

  const nextAgain = keyEvent('ArrowRight');
  assert.equal(navigator.handleKey(nextAgain), true);
  assert.deepEqual(opened, ['event-a', 'event-b', 'event-c']);
});

test('adjacent navigation reports its direction to the event presenter', async () => {
  const { createEventModalNavigator } = await loadNavigatorModule();
  const events = [
    { id: 'event-a' },
    { id: 'event-b' },
    { id: 'event-c' },
  ];
  let currentId = 'event-b';
  const opened = [];
  const navigator = createEventModalNavigator({
    getEvents: () => events,
    getCurrentEventId: () => currentId,
    openEvent: (event, direction) => {
      currentId = event.id;
      opened.push({ id: event.id, direction });
    },
  });

  navigator.handleKey(keyEvent('ArrowUp'));
  navigator.handleKey(keyEvent('ArrowDown'));

  assert.deepEqual(opened, [
    { id: 'event-a', direction: -1 },
    { id: 'event-b', direction: 1 },
  ]);
});

test('wheel gestures accumulate once and pause before another event switch', async () => {
  const { createEventModalNavigator } = await loadNavigatorModule();
  const events = [
    { id: 'event-a', title: 'A' },
    { id: 'event-b', title: 'B' },
    { id: 'event-c', title: 'C' },
  ];
  let currentId = 'event-b';
  let now = 1000;
  const opened = [];
  const navigator = createEventModalNavigator({
    getEvents: () => events,
    getCurrentEventId: () => currentId,
    openEvent: event => {
      currentId = event.id;
      opened.push(event.id);
    },
    now: () => now,
  });

  const firstPart = wheelEvent(20);
  assert.equal(navigator.handleWheel(firstPart), false);
  assert.equal(firstPart.preventDefaultCalled, false);
  assert.deepEqual(opened, []);

  const thresholdPart = wheelEvent(30);
  assert.equal(navigator.handleWheel(thresholdPart), true);
  assert.equal(thresholdPart.preventDefaultCalled, true);
  assert.deepEqual(opened, ['event-c']);

  now += 160;
  navigator.handleWheel(wheelEvent(-120));
  assert.deepEqual(opened, ['event-c']);

  now += 160;
  navigator.handleWheel(wheelEvent(-120));
  assert.deepEqual(opened, ['event-c']);

  now += 181;
  navigator.handleWheel(wheelEvent(-120));
  assert.deepEqual(opened, ['event-c', 'event-b']);

  const emptyGesture = wheelEvent(0);
  assert.equal(navigator.handleWheel(emptyGesture), false);
  assert.equal(emptyGesture.preventDefaultCalled, false);
});

test('wheel navigation preserves native reading until the scroll container reaches an edge', async () => {
  const { createEventModalNavigator } = await loadNavigatorModule();
  const events = [{ id: 'event-a' }, { id: 'event-b' }, { id: 'event-c' }];
  let currentId = 'event-b';
  let now = 1000;
  const opened = [];
  const scrollState = { scrollTop: 180, scrollHeight: 1200, clientHeight: 600 };
  const navigator = createEventModalNavigator({
    getEvents: () => events,
    getCurrentEventId: () => currentId,
    openEvent: event => {
      currentId = event.id;
      opened.push(event.id);
    },
    getScrollState: () => scrollState,
    now: () => now,
  });

  const readingDown = wheelEvent(120);
  assert.equal(navigator.handleWheel(readingDown), false);
  assert.equal(readingDown.preventDefaultCalled, false);
  assert.deepEqual(opened, []);

  scrollState.scrollTop = 600;
  const beyondBottom = wheelEvent(120);
  assert.equal(navigator.handleWheel(beyondBottom), true);
  assert.equal(beyondBottom.preventDefaultCalled, true);
  assert.deepEqual(opened, ['event-c']);

  now += 181;
  const sequenceEnd = wheelEvent(120);
  assert.equal(navigator.handleWheel(sequenceEnd), false);
  assert.equal(sequenceEnd.preventDefaultCalled, false);
  assert.deepEqual(opened, ['event-c']);

  scrollState.scrollTop = 200;
  now += 181;
  const readingUp = wheelEvent(-120);
  assert.equal(navigator.handleWheel(readingUp), false);
  assert.equal(readingUp.preventDefaultCalled, false);

  scrollState.scrollTop = 0;
  const beyondTop = wheelEvent(-120);
  assert.equal(navigator.handleWheel(beyondTop), true);
  assert.equal(beyondTop.preventDefaultCalled, true);
  assert.deepEqual(opened, ['event-c', 'event-b']);
});

test('one inertial wheel gesture cannot cross multiple event records', async () => {
  const { createEventModalNavigator } = await loadNavigatorModule();
  const events = [{ id: 'event-a' }, { id: 'event-b' }, { id: 'event-c' }, { id: 'event-d' }];
  let currentId = 'event-b';
  let now = 1000;
  const opened = [];
  const scrollState = { scrollTop: 600, scrollHeight: 1200, clientHeight: 600 };
  const navigator = createEventModalNavigator({
    getEvents: () => events,
    getCurrentEventId: () => currentId,
    openEvent: event => {
      currentId = event.id;
      opened.push(event.id);
    },
    getScrollState: () => scrollState,
    now: () => now,
  });

  assert.equal(navigator.handleWheel(wheelEvent(120)), true);
  assert.deepEqual(opened, ['event-c']);

  scrollState.scrollTop = 240;
  now += 20;
  assert.equal(navigator.handleWheel(wheelEvent(120)), false);

  scrollState.scrollTop = 600;
  now += 20;
  assert.equal(navigator.handleWheel(wheelEvent(120)), false);
  assert.deepEqual(opened, ['event-c']);

  now += 181;
  assert.equal(navigator.handleWheel(wheelEvent(120)), true);
  assert.deepEqual(opened, ['event-c', 'event-d']);
});

test('navigation leaves modified gestures and editable controls untouched', async () => {
  const { createEventModalNavigator } = await loadNavigatorModule();
  const events = [{ id: 'event-a' }, { id: 'event-b' }];
  let currentId = 'event-a';
  const navigator = createEventModalNavigator({
    getEvents: () => events,
    getCurrentEventId: () => currentId,
    openEvent: event => { currentId = event.id; },
  });

  const modifiedKey = keyEvent('ArrowDown', { ctrlKey: true });
  assert.equal(navigator.handleKey(modifiedKey), false);
  assert.equal(modifiedKey.preventDefaultCalled, false);

  const editableKey = keyEvent('ArrowDown', { target: { tagName: 'INPUT' } });
  assert.equal(navigator.handleKey(editableKey), false);
  assert.equal(editableKey.preventDefaultCalled, false);

  const zoomWheel = wheelEvent(120, 0, { ctrlKey: true });
  assert.equal(navigator.handleWheel(zoomWheel), false);
  assert.equal(zoomWheel.preventDefaultCalled, false);
  assert.equal(currentId, 'event-a');
});

test('reset clears wheel momentum between modal sessions', async () => {
  const { createEventModalNavigator } = await loadNavigatorModule();
  const events = [{ id: 'event-a' }, { id: 'event-b' }, { id: 'event-c' }];
  let currentId = 'event-b';
  const opened = [];
  const navigator = createEventModalNavigator({
    getEvents: () => events,
    getCurrentEventId: () => currentId,
    openEvent: event => {
      currentId = event.id;
      opened.push(event.id);
    },
    now: () => 1000,
  });

  navigator.handleWheel(wheelEvent(120));
  navigator.reset();
  navigator.handleWheel(wheelEvent(-120));

  assert.deepEqual(opened, ['event-c', 'event-b']);
});
