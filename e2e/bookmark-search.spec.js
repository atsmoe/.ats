const { test, expect } = require('@playwright/test');
const worlds = [
  ['arknights', 'evt-375', 'evt-380', '#evt-375'],
  ['wh40k', 'wh-017', 'wh-018', '#reader-wh-017'],
  ['ff14', 'ff14-001', 'ff14-002', '#ff14-001'],
];

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const [world, first, second, focus] of worlds) {
  test(`${world}: bookmark search narrows visible titles and preserves saved reading`, async ({ page }, testInfo) => {
    const key = `ats.${world}.reader.bookmarks.v1`;
    await page.goto('/.ats/about.html');
    await page.evaluate(({ key, first, second }) => localStorage.setItem(key, JSON.stringify([first, second, 'missing-record'])), { key, first, second });
    const requests = [];
    page.on('request', request => { if (request.url().includes(`/data/${world}.json`)) requests.push(request.url()); });
    await page.goto(`/.ats/${world}-chronicle.html#${first}`);
    await expect(page.locator(focus)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    const search = page.getByRole('searchbox', { name: '查找书签', exact: true });
    const list = page.locator('.reader-bookmarks');
    const firstText = await list.locator(`[data-reader-bookmark="${first}"]`).innerText();
    const before = await page.evaluate(({ key, world }) => ({
      bookmarks: localStorage.getItem(key), progress: localStorage.getItem(`ats.${world}.reader.progress.v1`),
      preferences: localStorage.getItem('ats.reader.preferences.v1'), url: location.href,
    }), { key, world });
    await search.fill(firstText);
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list.locator('a')).toHaveAttribute('data-reader-bookmark', first);
    await expect(search).toBeFocused();
    await expect(page.locator('.reader-bookmark-filter-status')).toHaveText('找到 1 / 3 条书签。');
    await expect(page.locator('.reader-tools-status')).toContainText('书签 3/30');
    await expect(page.locator('.reader-tools-status')).toContainText('1 条暂时无法读取');
    await expect(list.locator('a')).toBeInViewport();
    await expect(search).toBeInViewport();
    await page.locator('.reader-tools').screenshot({ path: testInfo.outputPath(`${world}-bookmark-search.png`) });
    await search.fill('<img src=x onerror=alert(1)>');
    await expect(list.locator('li')).toHaveCount(0);
    await expect(page.locator('.reader-bookmark-filter-status')).toContainText('没有匹配的书签');
    await expect(page.locator('.reader-bookmarks-empty')).toBeHidden();
    await expect(page.locator('.reader-bookmark-filter img')).toHaveCount(0);
    await page.getByRole('button', { name: '清空书签查找', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(list.locator('li')).toHaveCount(3);
    expect(await page.evaluate(({ key, world }) => ({
      bookmarks: localStorage.getItem(key), progress: localStorage.getItem(`ats.${world}.reader.progress.v1`),
      preferences: localStorage.getItem('ats.reader.preferences.v1'), url: location.href,
    }), { key, world })).toEqual(before);
    expect(requests).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('bookmark search handles full-width text, dates, IME composition and ending links', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/.ats/about.html');
  await page.evaluate(() => localStorage.setItem('ats.arknights.reader.bookmarks.v1', '["evt-001","evt-375","if-sarkaz-endless-ending-2"]'));
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const search = page.getByRole('searchbox', { name: '查找书签', exact: true });
  const links = page.locator('.reader-bookmarks a');
  await search.fill('１０９１');
  await expect(links).toHaveAttribute('data-reader-bookmark', 'evt-375');
  await search.fill('ｄｗｄｂ');
  await expect(links).toHaveAttribute('data-reader-bookmark', 'evt-001');
  // Synthetic composition events test event handling, not the operating system's IME.
  await search.evaluate(input => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '双王';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', isComposing: true }));
  });
  await expect(links).toHaveAttribute('data-reader-bookmark', 'evt-001');
  await expect(page.locator('#ark-reader')).toBeVisible();
  await search.dispatchEvent('compositionend', { data: '双王' });
  await expect(links).toHaveAttribute('data-reader-bookmark', 'if-sarkaz-endless-ending-2');
  await search.fill('双王　集成战略');
  await expect(links).toHaveCount(1);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.locator('#ark-reader')).toBeVisible();
  await expect(links).toHaveCount(3);
  expect(await search.evaluate(node => node.offsetHeight >= 44 && parseFloat(getComputedStyle(node).fontSize) >= 16)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.reader-tools').screenshot({ path: testInfo.outputPath('bookmark-search-keyboard.png') });
  await search.fill('双王 集成战略');
  await search.press('Tab');
  await expect(page.getByRole('button', { name: '清空书签查找', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(links).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/arknights-is-sarkaz\.html\?record=if-sarkaz-endless-ending-2#if-sarkaz-endless-ending-2$/);
  await expect(page.locator('#ark-spoiler-gate')).toBeVisible();
});

for (const [world, first, second, focus] of worlds) {
  test(`${world}: filtered lists preserve queries and focus across real cross-tab removals`, async ({ page, context }) => {
    const key = `ats.${world}.reader.bookmarks.v1`;
    await page.goto('/.ats/about.html');
    await page.evaluate(({ key, first, second }) => localStorage.setItem(key, JSON.stringify([first, second])), { key, first, second });
    await page.goto(`/.ats/${world}-chronicle.html#${first}`);
    await expect(page.locator(focus)).toBeFocused();
    const panel = page.locator('.reader-tools');
    await panel.locator('summary').click();
    const search = page.getByRole('searchbox', { name: '查找书签', exact: true });
    const firstText = await page.locator(`[data-reader-bookmark="${first}"]`).innerText();
    const secondText = await page.locator(`[data-reader-bookmark="${second}"]`).innerText();
    await search.fill(firstText);
    await panel.locator('summary').click();
    await panel.locator('summary').click();
    await expect(search).toHaveValue(firstText);
    await page.getByRole('combobox', { name: '行距', exact: true }).selectOption('relaxed');
    await expect(search).toHaveValue(firstText);
    const other = await context.newPage();
    try {
      await other.goto(`/.ats/${world}-chronicle.html#${first}`);
      await expect(other.locator(focus)).toBeFocused();
      await other.locator('.reader-tools > summary').click();
      await search.focus();
      await other.getByRole('button', { name: '取消当前书签', exact: true }).click();
      await expect(page.locator('.reader-bookmark-filter-status')).toContainText('没有匹配的书签');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue(firstText);
      await expect(page.locator('.reader-tools-status')).toContainText('书签 1/30');
      await search.fill(secondText);
      await page.locator(`[data-reader-remove="${second}"]`).focus();
      await page.keyboard.press('Enter');
      await expect(search).toBeFocused();
      await expect(page.locator('.reader-bookmarks-empty')).toBeVisible();
      await expect(page.locator('.reader-bookmark-filter-status')).toHaveText('找到 0 / 0 条书签。');
      await page.getByRole('button', { name: '清空书签查找', exact: true }).click();
      await expect(page.locator('.reader-bookmark-filter')).toBeHidden();
      await expect(page.getByRole('button', { name: '收藏当前记录', exact: true })).toBeFocused();
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([]);
      await other.getByRole('button', { name: '收藏当前记录', exact: true }).click();
      await expect(search).toBeVisible();
      await expect(search).toHaveValue('');
      await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
      await expect(page.getByRole('button', { name: '取消当前书签', exact: true })).toBeFocused();
    } finally { await other.close(); }
  });
}

test('bookmark filtering never writes storage and retains failed-removal warnings', async ({ page }) => {
  const key = 'ats.ff14.reader.bookmarks.v1';
  await page.goto('/.ats/about.html');
  await page.evaluate(key => localStorage.setItem(key, '["ff14-001","ff14-002"]'), key);
  await page.goto('/.ats/ff14-chronicle.html#ff14-001');
  await expect(page.locator('#ff14-001')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const firstText = await page.locator('[data-reader-bookmark="ff14-001"]').innerText();
  await page.evaluate(key => {
    window.bookmarkWriteAttempts = 0;
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) { window.bookmarkWriteAttempts++; throw new DOMException('quota', 'QuotaExceededError'); }
      return write.call(this, name, value);
    };
  }, key);
  const search = page.getByRole('searchbox', { name: '查找书签', exact: true });
  await search.fill(firstText);
  expect(await page.evaluate(() => window.bookmarkWriteAttempts)).toBe(0);
  await page.locator('[data-reader-remove="ff14-001"]').click();
  await expect(search).toBeFocused();
  await expect(page.locator('.reader-bookmark-filter-status')).toContainText('没有匹配的书签');
  await expect(page.locator('.reader-tools-status')).toContainText('浏览器未允许保存');
  await page.getByRole('button', { name: '清空书签查找', exact: true }).click();
  await expect(page.locator('.reader-bookmarks a')).toHaveAttribute('data-reader-bookmark', 'ff14-002');
  await expect(page.locator('.reader-tools-status')).toContainText('浏览器未允许保存');
  expect(await page.evaluate(() => window.bookmarkWriteAttempts)).toBe(1);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('["ff14-001","ff14-002"]');
  await page.reload();
  await expect(page.locator('#ff14-001')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(2);
});

test('empty readers keep bookmark search out of the way until a bookmark exists', async ({ page }) => {
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.locator('.reader-bookmark-filter')).toBeHidden();
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '查找书签', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消当前书签', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '清空书签查找', exact: true })).toBeDisabled();
});
