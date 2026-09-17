const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

test('opening Warhammer reading tools preserves the selected event', async ({ page, isMobile }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Do not touch the operating-system clipboard.
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async value => { window.copiedRecord = value; } },
  }));
  await page.goto('/.ats/wh40k-chronicle.html#wh-018');
  await expect(page.locator('#reader-wh-018')).toBeFocused();
  await expect(page.locator('.reader-bookmark-current')).toContainText("C'tan 的最初形态");
  const initialTop = await page.locator('#reader-wh-018').evaluate(node => node.getBoundingClientRect().top);
  await page.locator('.reader-tools > summary').click();
  await expect(page.locator('.reader-tools')).toHaveAttribute('open', '');
  // Allow queued scroll callbacks to settle after the panel changes height.
  await page.waitForTimeout(750);
  await expect(page).toHaveURL(/#wh-018$/);
  await expect(page.locator('.reader-bookmark-current')).toContainText("C'tan 的最初形态");
  if (!isMobile) {
    expect(await page.locator('.wh-reader-shell').evaluate(node => node.scrollTop)).toBe(0);
    expect(await page.locator('#reader-wh-018').evaluate(node => node.getBoundingClientRect().top)).toBeCloseTo(initialTop, 0);
  }
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  await expect(page.locator('[data-reader-bookmark="wh-018"]')).toBeVisible();
  await page.locator('.reader-tools .record-share-button').click();
  expect(await page.evaluate(() => window.copiedRecord)).toBe(new URL('/.ats/wh40k-chronicle.html#wh-018', page.url()).href);
  await page.getByLabel('正文字号', { exact: true }).selectOption('larger');
  await page.getByLabel('行距', { exact: true }).selectOption('relaxed');
  await page.getByLabel('剧情正文', { exact: true }).selectOption('titles');
  await page.waitForTimeout(750);
  await expect(page).toHaveURL(/#wh-018$/);
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.locator('.reader-tools > summary').press('Enter');
  await expect(page.locator('.reader-tools')).not.toHaveAttribute('open');
  await page.locator('.reader-tools > summary').press('Space');
  await expect(page.locator('.reader-tools')).toHaveAttribute('open', '');
  await page.waitForTimeout(750);
  await expect(page).toHaveURL(/#wh-018$/);
  await page.locator('.reader-tools').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('reading-tools-position.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Warhammer tools retain the record in tablet, short and narrow layouts', async ({ page, isMobile }, testInfo) => {
  const viewports = isMobile
    ? [{ width: 320, height: 740 }, { width: 760, height: 844 }]
    : [{ width: 900, height: 900 }, { width: 1280, height: 600 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/.ats/wh40k-chronicle.html#wh-018');
    await expect(page.locator('#reader-wh-018')).toBeFocused();
    const summary = page.locator('.reader-tools > summary');
    await summary.press('Enter');
    await expect(page.locator('.reader-tools')).toHaveAttribute('open', '');
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/#wh-018$/);
    await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
    await expect(page.locator('[data-reader-bookmark="wh-018"]')).toBeVisible();
    await page.getByRole('button', { name: '取消当前书签', exact: true }).click();
    await summary.press('Enter');
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/#wh-018$/);
    await expect(page.locator('.reader-bookmark-current')).toContainText("C'tan 的最初形态");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reading-position-${viewport.width}x${viewport.height}.png`) });
  }
});

test('Warhammer scroll tracking still follows prose and preserves explicit late-record links', async ({ page, isMobile }) => {
  await page.goto('/.ats/wh40k-chronicle.html#wh-019');
  await expect(page.locator('#reader-wh-019')).toBeFocused();
  await page.waitForTimeout(750);
  await expect(page).toHaveURL(/#wh-019$/);
  // Put the first record at the marker, then drive a genuine browser wheel event.
  const reading = page.locator(isMobile ? '.wh-reader-shell' : '.wh-reader-reading');
  await page.locator('#reader-wh-017').evaluate(node => node.scrollIntoView({ block: 'start' }));
  await expect(page).toHaveURL(/#wh-017$/);
  const box = await reading.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 240);
  await page.mouse.wheel(0, 370);
  await expect(page).toHaveURL(/#wh-018$/);
  await expect(page.locator('.reader-bookmark-current')).toContainText("C'tan 的最初形态");
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-resume-link')).toHaveAttribute('href', '#wh-018');
  await page.locator('.reader-resume-link').click();
  await expect(page.locator('#reader-wh-018')).toBeFocused();
  await page.waitForTimeout(750);
  await expect(page).toHaveURL(/#wh-018$/);
});
