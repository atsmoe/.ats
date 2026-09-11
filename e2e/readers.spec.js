const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

test('Arknights resumes a saved record while an explicit deep link takes priority', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/.ats/arknights-chronicle.html#evt-480');
  await expect(page.locator('#ark-reader')).toBeVisible();
  await expect(page.locator('#evt-480')).toBeFocused();
  await page.getByRole('button', { name: '关闭连续阅读器' }).click();
  const resume = page.locator('[data-ark-reader-resume]');
  await expect(resume).toHaveAttribute('href', '#evt-480');
  await page.reload();
  await expect(resume).toBeVisible();
  await expect(page.locator('#ark-reader')).toBeHidden();
  await resume.click();
  await expect(page.locator('#evt-480')).toBeFocused();
  await page.getByRole('button', { name: '关闭连续阅读器' }).click();
  await expect(resume).toBeFocused();
  await page.goto('/.ats/arknights-chronicle.html#evt-003');
  await expect(page.locator('#evt-003')).toBeFocused();
  await expect(page).toHaveURL(/#evt-003$/);
  expect(errors).toEqual([]);
});

test('Arknights mobile keeps sources reachable and reserves space for prose', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Narrow-screen layout');
  await page.goto('/.ats/arknights-chronicle.html#evt-003');
  await expect(page.locator('#evt-003')).toBeFocused();
  const panel = page.locator('.ark-reader-context-panel');
  await expect(panel).not.toHaveAttribute('open');
  const prose = page.locator('#ark-reader-scroll');
  const size = await prose.boundingBox();
  expect(size.height).toBeGreaterThan(400);
  await page.getByText('当前记录与来源', { exact: true }).click();
  await expect(page.locator('#ark-reader-context .ark-reader-source a').first()).toBeVisible();
  await expect(panel).toHaveAttribute('open');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('当前记录与来源', { exact: true }).press('Enter');
  await expect(panel).not.toHaveAttribute('open');
});

test('FFXIV tolerates corrupt progress and restores the first canonical record', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('ats.ff14.reader.progress.v1', 'null'));
  await page.goto('/.ats/ff14-chronicle.html');
  await expect(page.locator('.ff-reader-context h2')).toHaveText('古代人与古代社会');
  await expect(page.locator('#ff14-001')).toBeInViewport();
  expect(errors).toEqual([]);
});

test('FFXIV rejects a bookmark from another branch and honors a direct link', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ats.ff14.reader.progress.v1', JSON.stringify({
    mainline: { eventId: 'ff14-s1-013' }, shards: { eventId: 'missing-record' },
  })));
  await page.goto('/.ats/ff14-chronicle.html');
  await expect(page.locator('.ff-reader-context h2')).toHaveText('古代人与古代社会');
  await page.goto('/.ats/ff14-chronicle.html#ff14-323');
  await expect(page.locator('#ff14-323')).toBeFocused();
  await expect(page).toHaveURL(/#ff14-323$/);
});
