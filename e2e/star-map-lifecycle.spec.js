const { test, expect } = require('@playwright/test');
const { buildSync } = require('esbuild');
const path = require('node:path');

// Real Three.js/OrbitControls, with only browser/GPU calls observed. The test-only
// bundle exposes existing lifecycle exports; production gets no debug globals.
const harness = buildSync({
  stdin: { contents: `
    import './src/js/modules/star-map-entry.js';
    export { init, destroy } from './src/js/modules/star-map-3d.js';`,
  resolveDir: path.resolve(__dirname, '..') },
  bundle: true, format: 'iife', globalName: 'StarMapLifecycle', write: false,
}).outputFiles[0].text;

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.addInitScript(() => {
    window.starAudit = { paints: 0, buffers: 0, programs: 0 };
    for (const Type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const [method, field, delta] of [
        ['clear', 'paints', 1], ['createBuffer', 'buffers', 1], ['deleteBuffer', 'buffers', -1],
        ['createProgram', 'programs', 1], ['deleteProgram', 'programs', -1],
      ]) {
        const original = Type.prototype[method];
        Type.prototype[method] = function (...args) {
          const result = original.apply(this, args);
          if (this.canvas.id === 'bg-canvas' && (delta > 0 || args[0])) window.starAudit[field] += delta;
          return result;
        };
      }
    }
  });
});

const paints = page => page.evaluate(() => window.starAudit.paints);
async function settled(page) {
  await page.waitForTimeout(250);
  const count = await paints(page);
  await page.waitForTimeout(250);
  expect(await paints(page)).toBe(count);
  return count;
}

test('formal star map keeps all three world details and navigation available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/.ats/');
  await expect(page.locator('body')).not.toHaveClass(/star-map-fallback/);
  await expect.poll(() => paints(page)).toBeGreaterThan(0);
  for (const world of ['arknights', 'wh40k', 'ff14']) {
    const marker = page.locator(`#marker-${world}`);
    await expect(marker).toHaveAttribute('href', `./${world}.html`);
    await expect(marker).toHaveClass(/visible/);
    await marker.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#galaxy-detail')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#detail-title')).not.toBeEmpty();
    await page.locator('#detail-enter-btn').click();
    await expect(page).toHaveURL(new RegExp(`/${world}\\.html$`));
    await page.goto('/.ats/');
  }
});

test('reduced motion repaints after drag, zoom and resize, then settles', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/.ats/');
  await expect.poll(() => paints(page)).toBeGreaterThan(0);
  const initial = await settled(page);
  const before = await page.locator('#marker-arknights').evaluate(el => el.style.left);
  const size = page.viewportSize();
  await page.mouse.move(size.width * .5, size.height * .7);
  await page.mouse.down();
  await page.mouse.move(size.width * .7, size.height * .6, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => paints(page)).toBeGreaterThan(initial);
  await expect.poll(() => page.locator('#marker-arknights').evaluate(el => el.style.left)).not.toBe(before);
  const dragged = await settled(page);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => paints(page)).toBeGreaterThan(dragged);
  const zoomed = await settled(page);
  await page.setViewportSize({ width: size.width + 31, height: size.height + 23 });
  await expect.poll(() => paints(page)).toBeGreaterThan(zoomed);
  await expect.poll(() => page.locator('#bg-canvas').evaluate(el => el.clientWidth === innerWidth && el.clientHeight === innerHeight)).toBe(true);
  await settled(page);
});

test('live motion preference changes stop and resume WebGL drawing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/.ats/');
  await expect.poll(() => paints(page)).toBeGreaterThan(3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stopped = await settled(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => paints(page)).toBeGreaterThan(stopped + 3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settled(page);
});

test('repeat lifecycle releases GPU buffers and programs without growth', async ({ page }) => {
  await page.route(/\/js\/star-map-3d\.js(?:\?|$)/, route => route.fulfill({ contentType: 'text/javascript', body: harness }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/.ats/');
  await expect.poll(() => paints(page)).toBeGreaterThan(0);
  const live = await page.evaluate(() => ({ buffers: starAudit.buffers, programs: starAudit.programs }));
  expect(live.buffers).toBeGreaterThan(0);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { StarMapLifecycle.destroy(); StarMapLifecycle.destroy(); });
    expect(await page.evaluate(() => ({ buffers: starAudit.buffers, programs: starAudit.programs })))
      .toEqual({ buffers: 0, programs: 0 });
    await settled(page);
    await page.evaluate(() => StarMapLifecycle.init('bg-canvas'));
    const current = await page.evaluate(() => ({ buffers: starAudit.buffers, programs: starAudit.programs }));
    // Random geometry can put a cluster outside the frustum, delaying its GPU
    // upload. Seven point clouds have at most three attribute buffers each.
    expect(current.buffers).toBeGreaterThan(0);
    expect(current.buffers).toBeLessThanOrEqual(21);
    expect(current.programs).toBe(live.programs);
  }
});

test('renderer failure preserves static world links and navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (this.id === 'bg-canvas' && /webgl/.test(type)) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/.ats/');
  await expect(page.locator('body')).toHaveClass(/star-map-fallback/);
  await expect(page.locator('.star-map-fallback-message')).toBeVisible();
  for (const world of ['arknights', 'wh40k', 'ff14']) {
    await expect(page.locator(`#marker-${world}`)).toBeVisible();
  }
  await page.locator('#marker-arknights').click();
  await expect(page).toHaveURL(/\/arknights\.html$/);
});

test('a first paint deferred while hidden still reaches the static fallback on failure', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Synthetic visibility exercises the deferred-paint handler; this is not
    // evidence of real operating-system tab suspension.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    for (const Type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const clear = Type.prototype.clear;
      Type.prototype.clear = function (...args) {
        if (this.canvas.id === 'bg-canvas') throw new Error('synthetic deferred paint failure');
        return clear.apply(this, args);
      };
    }
  });
  await page.goto('/.ats/');
  await expect(page.locator('body')).not.toHaveClass(/star-map-fallback/);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('body')).toHaveClass(/star-map-fallback/);
  expect(await page.evaluate(() => ({ buffers: starAudit.buffers, programs: starAudit.programs })))
    .toEqual({ buffers: 0, programs: 0 });
  expect(errors).toEqual([]);
  await page.locator('#marker-wh40k').click();
  await expect(page).toHaveURL(/\/wh40k\.html$/);
});

for (const cleanupThrows of [false, true]) {
test(`interaction failure releases the scene (cleanup throws: ${cleanupThrows})`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(cleanupThrows => {
    let failed = false;
    const abort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (...args) {
      const result = abort.apply(this, args);
      if (failed && cleanupThrows) { failed = false; throw new Error('synthetic cleanup failure'); }
      return result;
    };
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...args) {
      if (this.id === 'marker-wh40k' && type === 'click') {
        failed = true;
        throw new Error('synthetic marker listener failure');
      }
      return original.call(this, type, ...args);
    };
  }, cleanupThrows);
  await page.goto('/.ats/');
  await expect(page.locator('body')).toHaveClass(/star-map-fallback/);
  expect(await page.evaluate(() => ({ buffers: starAudit.buffers, programs: starAudit.programs })))
    .toEqual({ buffers: 0, programs: 0 });
  await settled(page);
  expect(errors).toEqual([]);
  await page.locator('#marker-ff14').click();
  await expect(page).toHaveURL(/\/ff14\.html$/);
});
}
