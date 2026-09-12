const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(reducedMotion = false) {
  const frames = new Map();
  const timers = new Map();
  let nextId = 0;
  let paints = 0;
  const media = Object.assign(new EventTarget(), { matches: reducedMotion });
  const window = Object.assign(new EventTarget(), {
    innerWidth: 640, innerHeight: 480, matchMedia: () => media,
  });
  const document = Object.assign(new EventTarget(), { hidden: false, body: { style: {} } });
  const canvas = { width: 0, height: 0, getContext: () => ({
    clearRect() { paints++; }, fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  }) };
  const preset = { stars: 0, nebulaCount: 0, starColorMix: { cool: 1, neutral: 0 },
    coreGlow: { sizeRatio: 0.5, r: 0, g: 0, b: 0, alpha: 0.1 }, baseBackground: '#000' };
  const file = 'src/js/modules/particle-background.js';
  const source = fs.readFileSync(file, 'utf8');
  const context = { window, document, navigator: { userAgent: 'Desktop', hardwareConcurrency: 8 },
    BG_PRESETS: { test: preset, 'star-map': preset }, GALAXIES: {}, galaxyAnim: {},
    ANIM: { duration: { fast: 150 } }, AbortController,
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(fn) { const id = ++nextId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const Background = vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nParticleBackground;', context);
  const background = new Background(canvas, preset);
  return { background, canvas, document, window, frames, timers,
    paints: () => paints,
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    step(timestamp) { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(timestamp)); },
    motion(matches) { media.matches = matches; media.dispatchEvent(new Event('change')); },
    visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
    page(type, persisted) { window.dispatchEvent(Object.assign(new Event(type), { persisted })); },
  };
}

test('static background redraws once after a resize burst and after a preset change', () => {
  const f = fixture(true);
  assert.equal(f.frames.size, 0);
  const before = f.paints();
  f.window.innerWidth = 900;
  for (let i = 0; i < 8; i++) f.window.dispatchEvent(new Event('resize'));
  f.flushTimers();
  assert.equal(f.canvas.width, 900);
  assert.equal(f.paints(), before + 1, 'resizing must repaint the cleared canvas once in static mode');
  f.background.loadPreset('test');
  assert.equal(f.paints(), before + 2, 'changing presets must also refresh a static background');
  assert.equal(f.frames.size, 0, 'static updates must not start a continuous loop');
  f.background.destroy();
});

test('motion preference and page visibility pause and resume exactly one loop', () => {
  const f = fixture();
  assert.equal(f.frames.size, 1);
  f.step(100);
  assert.equal(f.frames.size, 1);
  f.motion(true);
  assert.equal(f.frames.size, 0, 'changing to reduced motion must stop the scheduled frame');
  const staticPaints = f.paints();
  f.step(200);
  assert.equal(f.paints(), staticPaints);
  f.motion(false);
  f.motion(false);
  assert.equal(f.frames.size, 1);
  f.visibility(true);
  assert.equal(f.frames.size, 0);
  f.visibility(false);
  f.visibility(false);
  assert.equal(f.frames.size, 1);
  f.background.destroy();
});

test('cached lifecycle resumes while final disposal cancels pending work permanently', () => {
  const f = fixture();
  f.page('pagehide', true);
  assert.equal(f.frames.size, 0);
  f.page('pageshow', true);
  f.page('pageshow', true);
  assert.equal(f.frames.size, 1);
  f.window.dispatchEvent(new Event('resize'));
  f.page('pagehide', false);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  const paints = f.paints();
  f.page('pageshow', true);
  f.motion(false);
  f.visibility(false);
  f.window.dispatchEvent(new Event('resize'));
  f.flushTimers();
  f.step(400);
  assert.equal(f.frames.size, 0);
  assert.equal(f.paints(), paints, 'disposed background must not redraw or restart');
});
