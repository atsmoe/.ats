const { test, expect } = require('@playwright/test');

const worlds = [['arknights', 'evt-375'], ['wh40k', 'wh-018'], ['ff14', 'ff14-323']];

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const [world, id] of worlds) {
  test(`${world}: home shows unresolved bookmarks and removes only the requested bookmark`, async ({ page }, testInfo) => {
    const key = `ats.${world}.reader.bookmarks.v1`;
    const progressKey = `ats.${world}.reader.progress.v1`;
    await page.addInitScript(({ key, progressKey, id }) => {
      localStorage.setItem(key, JSON.stringify([id, 'missing-record']));
      localStorage.setItem(progressKey, JSON.stringify({ mainline: { eventId: id } }));
    }, { key, progressKey, id });
    await page.goto(`/.ats/${world}.html`);
    await page.locator('[data-reading-home] > summary').click();
    const list = page.locator('.reading-home-bookmarks');
    await expect(list.locator('li')).toHaveCount(2);
    await expect(list.locator('a')).toHaveCount(1);
    await expect(list).toContainText('暂时无法读取的书签 2');
    await expect(list).not.toContainText('missing-record');
    await page.locator('[data-reading-home]').screenshot({ path: testInfo.outputPath(`${world}-bookmark-management.png`) });
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([id, 'missing-record']);
    const remove = page.locator('[data-reading-home-remove="missing-record"]');
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(list.locator('li')).toHaveCount(1);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([id]);
    await page.locator(`[data-reading-home-remove="${id}"]`).click();
    await expect(list).toHaveCount(0);
    await expect(page.locator('.reading-home-positions a')).toHaveCount(1);
    await expect(page.locator('[data-reading-home]')).toBeVisible();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), progressKey)).toEqual({ mainline: { eventId: id } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${world}-reading-position-retained.png`) });
  });
}

test('keyboard removal keeps adjacent remove focus and leaves other worlds untouched', async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/.ats/about.html');
  await page.evaluate(() => {
    localStorage.setItem('ats.arknights.reader.bookmarks.v1', '["evt-375","missing-record","evt-380"]');
    localStorage.setItem('ats.ff14.reader.bookmarks.v1', '["ff14-001"]');
    localStorage.setItem('ats.reader.preferences.v1', '{"size":"large"}');
  });
  await page.goto('/.ats/arknights.html');
  await page.locator('[data-reading-home] > summary').click();
  const remove = id => page.locator(`[data-reading-home-remove="${id}"]`);
  await remove('missing-record').focus();
  await page.keyboard.press('Enter');
  await expect(remove('evt-380')).toBeFocused();
  expect(await remove('evt-380').evaluate(node => node.matches(':focus-visible'))).toBe(true);
  expect(await remove('evt-380').evaluate(node => node.offsetHeight)).toBeGreaterThanOrEqual(44);
  expect(await remove('evt-380').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(remove('evt-375')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-reading-home]')).toBeHidden();
  await expect(page.locator('.reading-paths a').first()).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('ats.arknights.reader.bookmarks.v1'))).toBe('[]');
  expect(await page.evaluate(() => localStorage.getItem('ats.ff14.reader.bookmarks.v1'))).toBe('["ff14-001"]');
  expect(await page.evaluate(() => localStorage.getItem('ats.reader.preferences.v1'))).toBe('{"size":"large"}');
});

for (const [world, id] of worlds) {
  test(`${world}: failed removal saving remains visible and does not claim a permanent change`, async ({ page }) => {
    const key = `ats.${world}.reader.bookmarks.v1`;
    await page.goto('/.ats/about.html');
    await page.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify([id])), { key, id });
    let requests = 0;
    page.on('request', request => { if (request.url().includes(`/data/${world}.json`)) requests++; });
    await page.goto(`/.ats/${world}.html`);
    const panel = page.locator('[data-reading-home]');
    await panel.locator('summary').click();
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(1);
    await page.evaluate(key => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('quota', 'QuotaExceededError');
        return write.call(this, name, value);
      };
    }, key);
    await page.locator(`[data-reading-home-remove="${id}"]`).click();
    await expect(panel.getByRole('status')).toContainText('刷新后可能重新出现');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.reading-home-bookmarks')).toHaveCount(0);
    await expect(panel.locator('summary')).toBeFocused();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([id]);
    expect(requests).toBe(1);
    await page.reload();
    await panel.locator('summary').click();
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(1);
  });
}

test('home removal synchronizes with the chronicle and stale actions never restore bookmarks', async ({ page, context }) => {
  const key = 'ats.arknights.reader.bookmarks.v1';
  await page.goto('/.ats/about.html');
  await page.evaluate(key => localStorage.setItem(key, '["evt-375","evt-380"]'), key);
  // Missed notifications exercise explicit removal intent; writes below remain real.
  await page.addInitScript(key => window.addEventListener('storage', event => {
    if (event.key === key) event.stopImmediatePropagation();
  }, true), key);
  await page.goto('/.ats/arknights.html');
  await page.locator('[data-reading-home] > summary').click();
  const other = await context.newPage();
  try {
    await other.goto('/.ats/arknights-chronicle.html#evt-375');
    await expect(other.locator('#evt-375')).toBeFocused();
    await other.locator('.reader-tools > summary').click();
    await other.locator('[data-reader-remove="evt-375"]').click();
    await expect(page.locator('[data-reading-home-remove="evt-375"]')).toBeVisible();
    await page.locator('[data-reading-home-remove="evt-375"]').click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(['evt-380']);
    await page.locator('[data-reading-home-remove="evt-380"]').click();
    await expect(other.locator('.reader-bookmarks a')).toHaveCount(0);
    await expect(other.getByRole('button', { name: '收藏当前记录', exact: true })).toBeEnabled();
  } finally { await other.close(); }
});
