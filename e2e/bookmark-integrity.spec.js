const { test, expect } = require('@playwright/test');
const key = 'ats.arknights.reader.bookmarks.v1';

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const [world, id, focus] of [['arknights', 'evt-375', '#evt-375'], ['wh40k', 'wh-017', '#reader-wh-017'], ['ff14', 'ff14-001', '#ff14-001']]) {
  test(`${world}: opening a reader preserves an unresolved bookmark until explicitly removed`, async ({ page }, testInfo) => {
    const key = `ats.${world}.reader.bookmarks.v1`;
    await page.goto('/.ats/about.html');
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify(['future-record'])), key);
    await page.goto(`/.ats/${world}-chronicle.html#${id}`);
    await expect(page.locator(focus)).toBeFocused();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(['future-record']);
    await page.locator('.reader-tools > summary').click();
    await expect(page.locator('.reader-bookmark-unavailable')).toHaveText('暂时无法读取的书签 1');
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(0);
    await expect(page.locator('.reader-bookmarks-empty')).toBeHidden();
    await expect(page.locator('.reader-tools-status')).toContainText('书签 1/30');
    await expect(page.locator('.reader-tools-status')).toContainText('1 条暂时无法读取，已保留');
    await expect(page.locator('.reader-tools')).not.toContainText('future-record');
    await page.reload();
    await expect(page.locator(focus)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(['future-record']);
    const remove = page.locator('[data-reader-remove="future-record"]');
    await remove.focus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.reader-bookmark-unavailable').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    expect(await remove.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.locator('.reader-tools').screenshot({ path: testInfo.outputPath('unresolved-bookmark.png') });
    await page.keyboard.press('Enter');
    await expect(page.locator('.reader-bookmarks-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: '收藏当前记录', exact: true })).toBeFocused();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([]);
  });
}

for (const action of ['list remove', 'current cancel']) {
  test(`a stale ${action} button does not restore a bookmark removed in another page`, async ({ page, context }) => {
    await page.addInitScript(key => window.addEventListener('storage', event => {
      if (event.key === key) event.stopImmediatePropagation();
    }, true), key);
    await page.goto('/.ats/about.html');
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify(['evt-375'])), key);
    await page.goto('/.ats/arknights-chronicle.html#evt-375');
    await expect(page.locator('#evt-375')).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    const other = await context.newPage();
    try {
      await other.goto('/.ats/arknights-chronicle.html#evt-375');
      await expect(other.locator('#evt-375')).toBeFocused();
      await other.locator('.reader-tools > summary').click();
      await other.getByRole('button', { name: '取消当前书签', exact: true }).click();
      expect(await other.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([]);
      await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
      const name = action === 'list remove' ? '移除书签：西蒙家族倒台，安东尼入狱' : '取消当前书签';
      await page.getByRole('button', { name, exact: true }).click();
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([]);
      await expect(page.locator('.reader-bookmarks-empty')).toBeVisible();
    } finally { await other.close(); }
  });
}

test('a stale collect button keeps a bookmark already saved in another page', async ({ page, context }) => {
  await page.addInitScript(key => window.addEventListener('storage', event => {
    if (event.key === key) event.stopImmediatePropagation();
  }, true), key);
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const other = await context.newPage();
  try {
    await other.goto('/.ats/arknights-chronicle.html#evt-375');
    await expect(other.locator('#evt-375')).toBeFocused();
    await other.locator('.reader-tools > summary').click();
    await other.getByRole('button', { name: '收藏当前记录', exact: true }).click();
    await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(['evt-375']);
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '取消当前书签', exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally { await other.close(); }
});

test('unresolved bookmarks count toward capacity and remain after a home round trip', async ({ page }, testInfo) => {
  const ids = Array.from({ length: 30 }, (_, index) => `future-${index}`);
  await page.goto('/.ats/about.html');
  await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids)), { key, ids });
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.locator('.reader-bookmark-unavailable')).toHaveCount(30);
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  await expect(page.locator('.reader-tools-status')).toContainText('最多保存 30 条书签');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(ids);
  await page.locator('[data-reader-remove="future-0"]').click();
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  await expect(page.locator('.reader-bookmark-unavailable')).toHaveCount(29);
  await expect(page.locator('.reader-tools-status')).toContainText('书签 30/30');
  const expected = [...ids.slice(1), 'evt-375'];
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(expected);
  await page.locator('[data-reader-remove="evt-375"]').focus();
  await page.locator('.reader-tools').screenshot({ path: testInfo.outputPath('bookmark-capacity.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/.ats/arknights.html');
  await page.locator('[data-reading-home] > summary').click();
  await expect(page.locator('[data-reading-home] [role="status"]')).toContainText('已保留原有保存内容');
  await page.locator('.reading-home-bookmarks a').click();
  await expect(page.locator('#evt-375')).toBeFocused();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(expected);
});

test('stale ending buttons preserve both collect and cancel intent', async ({ page, context }) => {
  const ending = 'if-sarkaz-endless-ending-2';
  const url = `/.ats/arknights-is-sarkaz.html?record=${ending}#${ending}`;
  await page.addInitScript(key => window.addEventListener('storage', event => {
    if (event.key === key) event.stopImmediatePropagation();
  }, true), key);
  async function openTopic(reader) {
    await reader.goto(url);
    await expect(reader.locator('#is-topic')).toHaveAttribute('data-spoiler-locked', /true|false/);
    if (await reader.locator('#ark-spoiler-gate').isVisible()) await reader.getByRole('button', { name: '进入完整档案', exact: true }).click();
    await expect(reader.locator('[data-topic-content]')).toHaveCSS('filter', 'none');
    return reader.locator(`#${ending} .is-ending-bookmark`);
  }
  const first = await openTopic(page);
  const other = await context.newPage();
  try {
    const second = await openTopic(other);
    await second.click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await first.click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([ending]);
    await second.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await first.click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([]);
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(`#${ending} .is-ending-bookmark-status`)).toContainText('已取消');
  } finally { await other.close(); }
});
