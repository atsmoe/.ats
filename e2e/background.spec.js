const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

function centerAlpha(canvas) {
  return canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3];
}

test('all three world backgrounds remain painted when resized in reduced-motion mode', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const initial = page.viewportSize();
  for (const world of ['arknights', 'wh40k', 'ff14']) {
    await page.goto(`/.ats/${world}.html`);
    const canvas = page.locator('#bg-canvas');
    await expect.poll(() => canvas.evaluate(centerAlpha)).toBeGreaterThan(0);
    await page.setViewportSize({ width: initial.width + 23, height: initial.height + 17 });
    await expect.poll(() => canvas.evaluate(node => node.width === innerWidth && node.height === innerHeight)).toBe(true);
    await expect.poll(() => canvas.evaluate(centerAlpha)).toBeGreaterThan(0);
    await page.setViewportSize(initial);
  }
});

test('changing motion preference stops live paints and can resume without a reload', async ({ page }) => {
  await page.addInitScript(() => {
    window.__backgroundPaints = 0;
    const clearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'bg-canvas') window.__backgroundPaints++;
      return clearRect.apply(this, args);
    };
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/.ats/about.html');
  const paints = () => page.evaluate(() => window.__backgroundPaints);
  await expect.poll(paints).toBeGreaterThan(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const stopped = await paints();
  await page.waitForTimeout(200);
  expect(await paints()).toBe(stopped);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(paints).toBeGreaterThan(stopped + 2);
});
