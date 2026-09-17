const { test, expect } = require('@playwright/test');

const readers = [
  ['arknights', 'evt-375', '#evt-375'],
  ['wh40k', 'wh-018', '#reader-wh-018'],
  ['ff14', 'ff14-323', '#ff14-323'],
  ['ff14', 'ff14-s1-013', '#ff14-s1-013'],
];

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const [world, id, target] of readers) {
  test(`${world} ${id}: return from reading tools to the current record`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/.ats/${world}-chronicle.html#${id}`);
    await expect(page.locator(target)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    await page.getByLabel('正文字号', { exact: true }).selectOption('large');
    await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
    const back = page.getByRole('button', { name: '回到当前记录', exact: true });
    await expect(back).toBeEnabled();
    await expect(back).toHaveAttribute('aria-describedby', `reader-bookmark-current-${world}`);
    const before = await page.evaluate(() => ({
      hash: location.hash, history: history.length,
      preferences: localStorage.getItem('ats.reader.preferences.v1'),
      bookmarks: Object.fromEntries(['arknights', 'wh40k', 'ff14'].map(world => [world, localStorage.getItem(`ats.${world}.reader.bookmarks.v1`)])),
    }));
    await back.focus();
    await page.screenshot({ path: testInfo.outputPath(`${world}-${id}-tools.png`) });
    await page.keyboard.press('Enter');
    await expect(page.locator('.reader-tools')).not.toHaveAttribute('open');
    await expect(page.locator(target)).toBeFocused();
    await expect(page.locator(target)).toBeInViewport();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => ({
      hash: location.hash, history: history.length,
      preferences: localStorage.getItem('ats.reader.preferences.v1'),
      bookmarks: Object.fromEntries(['arknights', 'wh40k', 'ff14'].map(world => [world, localStorage.getItem(`ats.${world}.reader.bookmarks.v1`)])),
    }))).toEqual(before);
    expect(before.hash).toBe(`#${id}`);
    await expect(page.locator('[data-reading-content]')).toHaveAttribute('data-reader-size', 'large');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${world}-${id}-returned.png`) });
    expect(errors).toEqual([]);
  });
}

for (const [world, initial, target] of [
  ['arknights', 'evt-375', 'evt-003'],
  ['wh40k', 'wh-018', 'wh-019'],
  ['ff14', 'ff14-323', 'ff14-s1-013'],
]) {
  test(`${world}: return follows a newly selected bookmark without revealing hidden prose`, async ({ page }) => {
    await page.addInitScript(({ world, target }) => {
      localStorage.setItem(`ats.${world}.reader.bookmarks.v1`, JSON.stringify([target]));
    }, { world, target });
    await page.goto(`/.ats/${world}-chronicle.html#${initial}`);
    const prefix = world === 'wh40k' ? 'reader-' : '';
    await expect(page.locator(`#${prefix}${initial}`)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    await page.locator(`[data-reader-bookmark="${target}"]`).click();
    await expect(page.locator(`#${prefix}${target}`)).toBeFocused();
    await page.getByLabel('剧情正文', { exact: true }).selectOption('titles');
    await page.getByRole('button', { name: '回到当前记录', exact: true }).click();
    await expect(page.locator('.reader-tools')).not.toHaveAttribute('open');
    await expect(page.locator(`#${prefix}${target}`)).toBeFocused();
    await expect(page.locator('[data-reading-content]')).toHaveAttribute('data-reader-spoilers', 'titles');
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(new RegExp(`#${target}$`));
    const prose = { arknights: '.ark-reader-record-description', wh40k: '.wh-reader-copy', ff14: '.ff-reader-prose' }[world];
    await expect(page.locator(`#${prefix}${target} ${prose}`)).toBeHidden();
    expect(await page.evaluate(world => JSON.parse(localStorage.getItem(`ats.${world}.reader.bookmarks.v1`)), world)).toEqual([target]);
  });
}

test('return to the current record works without storage on narrow screens', async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('denied', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  for (const [world, id, target] of readers.slice(0, 3)) {
    await page.goto(`/.ats/${world}-chronicle.html#${id}`);
    await expect(page.locator(target)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    await expect(page.locator('.reader-tools-status')).toContainText('未允许保存');
    const back = page.getByRole('button', { name: '回到当前记录', exact: true });
    expect(await back.evaluate(node => node.offsetHeight)).toBeGreaterThanOrEqual(44);
    expect(await back.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    await back.click();
    await expect(page.locator(target)).toBeFocused();
    await expect(page.locator(target)).toBeInViewport();
    await expect(page.locator('.reader-tools')).not.toHaveAttribute('open');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
