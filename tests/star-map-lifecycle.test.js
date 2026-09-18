const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Three = require('three');

// The scene code is real; only browser scheduling and the GPU/controls adapter
// are replaced so lifecycle behaviour can be observed without a WebGL device.
function fixture({ reducedMotion = false, failAt = null } = {}) {
  const frames = new Map();
  const timers = new Map();
  const renderers = [];
  const controllers = [];
  const resources = [];
  let nextId = 0;
  let now = 0;
  let materialCount = 0;
  const element = () => {
    const classes = new Set();
    return { style: {}, classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
    } };
  };
  const nodes = Object.fromEntries(['bg-canvas', 'marker-arknights', 'marker-wh40k', 'marker-ff14']
    .map(id => [id, element()]));
  const media = Object.assign(new EventTarget(), { matches: reducedMotion });
  const removeMediaListener = media.removeEventListener;
  media.removeEventListener = function (...args) {
    removeMediaListener.apply(this, args);
    if (failAt === 'media-cleanup') throw new Error('synthetic media cleanup failure');
  };
  const window = Object.assign(new EventTarget(), {
    innerWidth: 640, innerHeight: 480, devicePixelRatio: 1, matchMedia: () => media,
  });
  const document = Object.assign(new EventTarget(), {
    hidden: false, getElementById: id => nodes[id] || null,
  });
  class Geometry extends Three.BufferGeometry {
    constructor() { super(); this.disposals = 0; resources.push(this); }
    dispose() { this.disposals++; super.dispose(); }
  }
  class Material extends Three.PointsMaterial {
    constructor(options) {
      super(options);
      if (failAt === 'material' && ++materialCount === 3) throw new Error('synthetic material failure');
      this.disposals = 0; resources.push(this);
    }
    dispose() { this.disposals++; super.dispose(); }
  }
  class Renderer {
    constructor({ canvas }) {
      if (failAt === 'renderer') throw new Error('synthetic renderer failure');
      this.domElement = canvas; this.paints = 0; this.disposals = 0; this.sizes = [];
      renderers.push(this);
    }
    setSize(width, height) { this.sizes.push([width, height]); }
    setPixelRatio() {}
    render(scene, camera) {
      if (failAt === 'render' || failAt === 'render-cleanup') throw new Error('synthetic render failure');
      this.paints++; this.scene = scene; this.camera = camera;
      camera.updateMatrixWorld();
    }
    dispose() {
      this.disposals++;
      if (failAt === 'render-cleanup') throw new Error('synthetic cleanup failure');
    }
  }
  class Controls extends EventTarget {
    constructor(camera) {
      super();
      if (failAt === 'controls') throw new Error('synthetic controls failure');
      this.camera = camera; this.disposals = 0; controllers.push(this);
    }
    update() {}
    dispose() { this.disposals++; }
  }
  class Clock {
    constructor() { this.start = now; }
    getElapsedTime() { return (now - this.start) / 1000; }
  }
  const source = fs.readFileSync('src/js/modules/star-map-3d.js', 'utf8');
  const context = {
    THREE: { ...Three, WebGLRenderer: Renderer, BufferGeometry: Geometry, PointsMaterial: Material, Clock },
    OrbitControls: Controls, GALAXIES: {}, ANIM: { duration: { fast: 150 }, galaxy: { enterDelay: 400 } },
    window, document, navigator: { userAgent: 'Test', deviceMemory: 2, hardwareConcurrency: 2 },
    performance: { now: () => now }, console: { ...console, warn() {} }, AbortController,
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(fn) { const id = ++nextId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const api = vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')
    + '\n({ init, destroy });', context);
  return { ...api, frames, timers, renderers, controllers, resources, nodes, window, document,
    setFailure(value) { failAt = value; },
    step(timestamp) { now = timestamp; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    motion(matches) { media.matches = matches; media.dispatchEvent(new Event('change')); },
    visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
    page(type, persisted) { window.dispatchEvent(Object.assign(new Event(type), { persisted })); },
  };
}

test('a destroyed star map releases its work and can initialize again', () => {
  const f = fixture();
  f.init('bg-canvas');
  assert.equal(f.frames.size, 1);
  f.destroy();
  assert.equal(f.frames.size, 0, 'destroy cancels the outstanding animation frame');
  assert.equal(f.timers.size, 0, 'destroy cancels pending marker entrances');
  assert.equal(f.controllers[0].disposals, 1);
  assert.ok(f.resources.every(resource => resource.disposals === 1));
  f.destroy();
  assert.equal(f.renderers[0].disposals, 1, 'repeated destroy is harmless');
  f.init('bg-canvas');
  assert.equal(f.renderers[1].paints, 1);
  assert.equal(f.frames.size, 1, 'the second scene has exactly one animation loop');
  f.destroy();
});

test('hidden and cached pages pause one loop without advancing scene time', () => {
  const f = fixture();
  f.init('bg-canvas');
  f.step(1000);
  const background = f.renderers[0].scene.children[0];
  const rotation = background.rotation.y;
  f.visibility(true);
  assert.equal(f.frames.size, 0);
  f.step(120000);
  assert.equal(background.rotation.y, rotation);
  f.visibility(false);
  f.visibility(false);
  assert.equal(f.frames.size, 1);
  f.step(120016);
  assert.equal(background.rotation.y, rotation, 'background time excludes the pause');
  f.page('pagehide', true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.renderers[0].disposals, 0, 'bfcache keeps the scene');
  f.page('pageshow', true);
  f.page('pageshow', true);
  assert.equal(f.frames.size, 1);
  f.page('pagehide', false);
  assert.equal(f.frames.size, 0);
  assert.equal(f.renderers[0].disposals, 1);
  f.page('pageshow', true);
  assert.equal(f.frames.size, 0, 'final departure cannot revive disposed resources');
});

test('reduced motion draws on demand and live changes resume only one loop', () => {
  const f = fixture({ reducedMotion: true });
  f.init('bg-canvas');
  assert.equal(f.renderers[0].paints, 1);
  assert.equal(f.frames.size, 0, 'a static scene has no idle animation loop');
  assert.equal(f.controllers[0].autoRotate, false);
  assert.equal(f.controllers[0].enableDamping, false);
  f.controllers[0].dispatchEvent(new Event('change'));
  f.controllers[0].dispatchEvent(new Event('change'));
  assert.equal(f.frames.size, 1, 'drag and zoom changes coalesce into one repaint');
  f.step(1000);
  assert.equal(f.renderers[0].paints, 2);
  assert.equal(f.frames.size, 0);
  f.motion(false);
  f.step(2000);
  f.step(3000);
  assert.equal(f.frames.size, 1);
  const rotation = f.renderers[0].scene.children[0].rotation.y;
  f.motion(true);
  f.step(4000);
  assert.equal(f.frames.size, 0);
  f.step(60000);
  assert.equal(f.renderers[0].scene.children[0].rotation.y, rotation);
  f.motion(false);
  f.motion(false);
  assert.equal(f.frames.size, 1);
  f.destroy();
  f.motion(true);
  f.controllers[0].dispatchEvent(new Event('change'));
  assert.equal(f.frames.size, 0);
});

test('resize is debounced, repaints a static scene, and old work stays cancelled', () => {
  const f = fixture({ reducedMotion: true });
  f.init('bg-canvas');
  const staleEntrances = [...f.timers.values()];
  f.window.innerWidth = 800;
  f.window.dispatchEvent(new Event('resize'));
  f.window.dispatchEvent(new Event('resize'));
  assert.equal(f.renderers[0].sizes.length, 1, 'resize waits for its debounce');
  f.flushTimers();
  assert.deepEqual(f.renderers[0].sizes.at(-1), [800, 480]);
  assert.equal(f.frames.size, 1);
  f.step(200);
  assert.equal(f.frames.size, 0);
  const oldRenderer = f.renderers[0];
  f.init('bg-canvas');
  assert.equal(oldRenderer.disposals, 1, 'repeat init disposes the previous scene');
  staleEntrances.forEach(fn => fn());
  assert.equal(f.nodes['marker-arknights'].classList.contains('visible'), false,
    'stale entrance callbacks cannot reveal the new scene');
  f.window.dispatchEvent(new Event('resize'));
  f.destroy();
  f.flushTimers();
  f.window.dispatchEvent(new Event('resize'));
  assert.equal(f.timers.size, 0);
  assert.equal(oldRenderer.sizes.length, 2, 'old renderer is never resized again');
  assert.ok(f.resources.every(resource => resource.disposals === 1));
});

test('partial initialization failures release acquired resources and permit retry', () => {
  for (const failAt of ['renderer', 'controls', 'material', 'render', 'render-cleanup']) {
    const f = fixture({ failAt });
    assert.throws(() => f.init('bg-canvas'), /synthetic (renderer|controls|material|render) failure/);
    assert.equal(f.frames.size, 0, failAt);
    assert.equal(f.timers.size, 0, failAt);
    assert.ok(f.resources.every(resource => resource.disposals === 1), `${failAt}: all allocated resources released`);
    assert.ok(f.renderers.every(renderer => renderer.disposals === 1), `${failAt}: renderer released`);
    assert.ok(f.controllers.every(controls => controls.disposals === 1), `${failAt}: controls released`);
    assert.doesNotThrow(() => f.destroy());
    f.setFailure(null);
    f.init('bg-canvas');
    assert.equal(f.renderers.at(-1).paints, 1);
    assert.equal(f.frames.size, 1);
    f.destroy();
  }
});

test('static marker positions use the camera from the current interaction', () => {
  const f = fixture({ reducedMotion: true });
  f.init('bg-canvas');
  const camera = f.controllers[0].camera;
  camera.position.x = 9;
  f.controllers[0].dispatchEvent(new Event('change'));
  f.step(1000);
  const projected = new Three.Vector3(-12, 2, -8).project(camera);
  const expected = (projected.x * .5 + .5) * f.window.innerWidth;
  assert.ok(Math.abs(parseFloat(f.nodes['marker-arknights'].style.left) - expected) < .01);
  f.destroy();
});

test('a deferred first paint failure cleans up and notifies the page fallback', () => {
  const f = fixture({ failAt: 'render' });
  f.document.hidden = true;
  let failure;
  f.init('bg-canvas', { onError: error => { failure = error; } });
  assert.equal(f.frames.size, 0);
  f.visibility(false);
  assert.doesNotThrow(() => f.step(1000));
  assert.match(failure.message, /synthetic render failure/);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.ok(f.resources.every(resource => resource.disposals === 1));
  assert.equal(f.renderers[0].disposals, 1);
});

test('a listener cleanup exception does not prevent GPU resource cleanup', () => {
  const f = fixture({ failAt: 'media-cleanup' });
  f.init('bg-canvas');
  assert.doesNotThrow(() => f.destroy());
  assert.ok(f.resources.every(resource => resource.disposals === 1));
  assert.equal(f.renderers[0].disposals, 1);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.doesNotThrow(() => f.destroy());
});
