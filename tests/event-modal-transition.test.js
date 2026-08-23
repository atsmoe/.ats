const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

async function loadTransitionModule() {
  const source = fs.readFileSync(
    path.join(ROOT, 'src/js/modules/event-modal-transition.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function transitionRoot() {
  const classes = new Set();
  const styles = new Map();
  return {
    classes,
    styles,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
    },
    style: {
      setProperty: (name, value) => styles.set(name, value),
    },
  };
}

test('new modal content enters from the adjacent event direction', async () => {
  const { createEventModalTransition } = await loadTransitionModule();
  const root = transitionRoot();
  const transition = createEventModalTransition(root, {
    duration: 150,
    easing: 'ease-out',
    prefersReducedMotion: () => false,
  });

  assert.equal(transition.play(1), true);
  assert.equal(root.classes.has('is-modal-switching-next'), true);
  assert.equal(root.classes.has('is-modal-switching-a'), true);
  assert.equal(root.styles.get('--event-modal-switch-duration'), '150ms');
  assert.equal(root.styles.get('--event-modal-switch-easing'), 'ease-out');
  assert.equal(root.styles.get('--event-modal-switch-direction'), '1');

  assert.equal(transition.play(-1), true);
  assert.equal(root.classes.has('is-modal-switching-next'), false);
  assert.equal(root.classes.has('is-modal-switching-previous'), true);
  assert.equal(root.classes.has('is-modal-switching-a'), false);
  assert.equal(root.classes.has('is-modal-switching-b'), true);
  assert.equal(root.styles.get('--event-modal-switch-direction'), '-1');
});

test('reduced-motion preference keeps adjacent records instantaneous', async () => {
  const { createEventModalTransition } = await loadTransitionModule();
  const root = transitionRoot();
  const transition = createEventModalTransition(root, {
    duration: 150,
    easing: 'ease-out',
    prefersReducedMotion: () => true,
  });

  assert.equal(transition.play(1), false);
  assert.equal(root.classes.size, 0);
});

test('a rapid second switch cancels animations from the first record', async () => {
  const { createEventModalTransition } = await loadTransitionModule();
  const root = transitionRoot();
  const transition = createEventModalTransition(root, {
    duration: 150,
    easing: 'ease-out',
    prefersReducedMotion: () => false,
  });

  transition.play(1);
  transition.play(-1);

  assert.deepEqual([...root.classes].sort(), [
    'is-modal-switching-b',
    'is-modal-switching-previous',
  ]);

  transition.cancel();
  assert.equal(root.classes.size, 0);
});

test('transition refuses to invent motion parameters outside the shared tokens', async () => {
  const { createEventModalTransition } = await loadTransitionModule();
  const root = transitionRoot();
  const transition = createEventModalTransition(root, {
    prefersReducedMotion: () => false,
  });

  assert.equal(transition.play(1), false);
  assert.equal(root.classes.size, 0);
  assert.equal(root.styles.size, 0);
});
