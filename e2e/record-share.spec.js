const { test, expect } = require('@playwright/test');
const topics = require('../src/_data/arknightsTopics')();
const worlds = [['arknights', 'evt-375', '#evt-375'], ['wh40k', 'wh-017', '#reader-wh-017'], ['ff14', 'ff14-001', '#ff14-001']];

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

// Isolate clipboard behavior; never read or replace the user's OS clipboard.
async function clipboard(page, mode = 'success') {
  await page.addInitScript(mode => {
    window.__copiedLinks = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : {
      writeText(value) {
        window.__copiedLinks.push(value);
        if (mode === 'denied') return Promise.reject(new Error('denied'));
        if (mode === 'delayed') return new Promise((resolve, reject) => { window.__copyResolve = resolve; window.__copyReject = reject; });
        return Promise.resolve();
      },
    } });
  }, mode);
}

async function openReader(page, world, id, focus, base = '/.ats/') {
  await page.goto(`${base}${world}-chronicle.html?temporary=remove-me#${id}`);
  await expect(page.locator(focus)).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  return page.locator('.reader-tools .record-share-button');
}

async function acceptSpoilers(page) {
  await expect(page.locator('#is-topic')).toHaveAttribute('data-spoiler-locked', /true|false/);
  if (await page.locator('#ark-spoiler-gate').isVisible()) await page.getByRole('button', { name: '进入完整档案', exact: true }).click();
  await expect(page.locator('[data-topic-content]')).toHaveCSS('filter', 'none');
}

for (const base of ['/', '/.ats/']) {
  for (const [world, id, focus] of worlds) {
    test(`${world}: copy a canonical record link at ${base} and reopen it`, async ({ page }) => {
      await clipboard(page);
      const button = await openReader(page, world, id, focus, base);
      const original = page.url();
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.record-share-feedback [role="status"]')).toHaveText('记录链接已复制。');
      const expected = new URL(`${base}${world}-chronicle.html#${id}`, page.url()).href;
      expect(await page.evaluate(() => window.__copiedLinks)).toEqual([expected]);
      expect(page.url()).toBe(original);
      await expect(button).toBeFocused();
      await expect(page.locator('.record-share-feedback input')).toBeHidden();
      expect(await button.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await page.goto(expected);
      await expect(page.locator(focus)).toBeFocused();
    });
  }
}

for (const [index, [world, id, focus]] of worlds.entries()) {
  test(`${world}: unavailable clipboard provides a readable keyboard-selectable link`, async ({ page }, testInfo) => {
    await clipboard(page, index === 1 ? 'missing' : 'denied');
    const button = await openReader(page, world, id, focus);
    await button.focus();
    await page.keyboard.press('Enter');
    const field = page.getByRole('textbox', { name: '记录链接，可手动复制', exact: true });
    await expect(field).toBeFocused();
    const expected = new URL(`/.ats/${world}-chronicle.html#${id}`, page.url()).href;
    await expect(field).toHaveValue(expected);
    expect(await field.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([0, expected.length]);
    await expect(page.locator('.record-share-feedback [role="status"]')).toContainText('无法自动复制');
    expect(await field.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.locator('.record-share-feedback p').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.reader-tools').screenshot({ path: testInfo.outputPath(`${world}-share-fallback.png`) });
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await expect(page.locator('.record-share-feedback')).toBeHidden();
    await expect(page.locator('.reader-tools')).toBeVisible();
  });
}

for (const topic of topics) {
  test(`${topic.slug}: all endings copy their own links without changing selection or routes`, async ({ page }, testInfo) => {
    await clipboard(page);
    await page.goto(`/.ats/arknights-is-${topic.slug}.html?temporary=remove-me`);
    await acceptSpoilers(page);
    const original = page.url();
    await expect(page.locator('.is-ending-actions .record-share-button')).toHaveCount(topic.endings.length);
    for (const ending of topic.endings) {
      const card = page.locator(`#${ending.id}`);
      const routeWasOpen = await card.locator('.is-route-guide').evaluate(node => node.open);
      await card.locator('.record-share-button').click();
      await expect(card.locator('.record-share-feedback [role="status"]')).toHaveText('记录链接已复制。');
      const expected = new URL(`/.ats/arknights-is-${topic.slug}.html?record=${ending.id}#${ending.id}`, page.url()).href;
      expect(await page.evaluate(() => window.__copiedLinks.at(-1))).toBe(expected);
      expect(page.url()).toBe(original);
      expect(await card.locator('.is-route-guide').evaluate(node => node.open)).toBe(routeWasOpen);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (topic.slug === 'sarkaz') await page.locator('.is-ending-heading').last().screenshot({ path: testInfo.outputPath('ending-share.png') });
  });
}

test('a shared ending still requires spoiler consent, then supports manual copying', async ({ page }, testInfo) => {
  await clipboard(page, 'denied');
  const id = 'if-sarkaz-endless-ending-2';
  await page.goto(`/.ats/arknights-is-sarkaz.html?record=${id}#${id}`);
  await expect(page.locator('#ark-spoiler-gate')).toBeVisible();
  await expect(page.locator('[data-topic-content]')).toHaveAttribute('inert', '');
  await acceptSpoilers(page);
  const card = page.locator(`#${id}`);
  await expect(card).toBeFocused();
  await card.locator('.record-share-button').focus();
  await page.keyboard.press('Enter');
  const field = card.getByRole('textbox', { name: '记录链接，可手动复制', exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(page.url());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.locator('.is-ending-heading').screenshot({ path: testInfo.outputPath('ending-share-fallback.png') });
  await page.keyboard.press('Escape');
  await expect(card.locator('.record-share-button')).toBeFocused();
  const other = page.locator('#if-sarkaz-endless-ending-3');
  const original = page.url();
  await other.locator('.record-share-button').click();
  await other.getByRole('textbox').click();
  expect(page.url()).toBe(original);
  await expect(other.locator('.is-route-guide')).not.toHaveAttribute('open');
  await expect(other.locator('.is-ending-select')).toHaveAttribute('aria-pressed', 'false');
});

test('delayed permission results neither duplicate requests nor steal a new focus', async ({ page }) => {
  await clipboard(page, 'delayed');
  const button = await openReader(page, ...worlds[0]);
  await button.click();
  await button.click();
  expect(await page.evaluate(() => window.__copiedLinks.length)).toBe(1);
  await expect(button).toHaveAttribute('aria-busy', 'true');
  const bookmark = page.getByRole('button', { name: '收藏当前记录', exact: true });
  await bookmark.focus();
  await page.evaluate(() => window.__copyReject(new Error('denied')));
  await expect(page.locator('.record-share-feedback input')).toBeVisible();
  await expect(bookmark).toBeFocused();
  await expect(button).toHaveAttribute('aria-busy', 'false');
});

test('changing records clears old copy feedback and ignores an earlier pending result', async ({ page }) => {
  await clipboard(page, 'delayed');
  await page.goto('/.ats/about.html');
  await page.evaluate(() => localStorage.setItem('ats.arknights.reader.bookmarks.v1', '["evt-375","evt-380"]'));
  const button = await openReader(page, ...worlds[0]);
  await button.click();
  await page.locator('[data-reader-bookmark="evt-380"]').click();
  await expect(page.locator('#evt-380')).toBeFocused();
  await page.evaluate(() => window.__copyReject(new Error('denied')));
  await expect(page.locator('.record-share-feedback')).toBeHidden();
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await button.click();
  expect(await page.evaluate(() => window.__copiedLinks.at(-1))).toMatch(/arknights-chronicle\.html#evt-380$/);
  await page.evaluate(() => window.__copyResolve());
  await expect(page.locator('.record-share-feedback [role="status"]')).toHaveText('记录链接已复制。');
});
