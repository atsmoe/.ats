const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

test('already open readers synchronize shared preferences across worlds', async ({ page, context }) => {
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const second = await context.newPage();
  const third = await context.newPage();
  try {
    await second.goto('/.ats/ff14-chronicle.html#ff14-001');
    await expect(second.locator('#ff14-001')).toBeFocused();
    await second.locator('.reader-tools > summary').click();
    await third.goto('/.ats/wh40k-chronicle.html#wh-017');
    await expect(third.locator('#reader-wh-017')).toBeFocused();
    await third.locator('.reader-tools > summary').click();
    await page.getByLabel('正文字号', { exact: true }).selectOption('larger');
    await expect.poll(() => second.evaluate(() => JSON.parse(localStorage.getItem('ats.reader.preferences.v1')).size)).toBe('larger');
    await expect(second.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
    await expect(third.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
    expect(await second.locator('#ff14-001 .ff-reader-prose p').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(20);
    await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
    const bookmark = page.locator('.reader-bookmarks a').first();
    await bookmark.focus();
    await second.getByLabel('行距', { exact: true }).selectOption('relaxed');
    await expect(page.getByLabel('行距', { exact: true })).toHaveValue('relaxed');
    await expect(bookmark).toBeFocused();
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
    await third.getByLabel('正文行宽', { exact: true }).selectOption('wide');
    await second.getByLabel('剧情正文', { exact: true }).selectOption('titles');
    for (const reader of [page, second, third]) {
      await expect(reader.locator('[data-reading-content]')).toHaveAttribute('data-reader-width', 'wide');
      await expect(reader.locator('[data-reading-content]')).toHaveAttribute('data-reader-spoilers', 'titles');
      await expect(reader.getByLabel('行距', { exact: true })).toHaveValue('relaxed');
    }
    await expect(page.locator('#evt-375 .ark-reader-record-description')).toBeHidden();
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
    await expect(second.locator('.reader-bookmarks a')).toHaveCount(0);
    await expect(third.locator('.reader-bookmarks a')).toHaveCount(0);
  } finally { await second.close(); await third.close(); }
});

test('resetting and clearing shared preferences preserves world bookmarks', async ({ page, context }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ats.reader.preferences.v1', JSON.stringify({ size: 'larger', leading: 'relaxed', width: 'wide', spoilers: 'titles' }));
    localStorage.setItem('ats.arknights.reader.bookmarks.v1', JSON.stringify(['evt-375']));
  });
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const second = await context.newPage();
  const third = await context.newPage();
  try {
    await second.goto('/.ats/ff14-chronicle.html#ff14-001');
    await expect(second.locator('#ff14-001')).toBeFocused();
    await second.locator('.reader-tools > summary').click();
    await third.goto('/.ats/wh40k-chronicle.html#wh-017');
    await expect(third.locator('#reader-wh-017')).toBeFocused();
    await third.locator('.reader-tools > summary').click();
    for (const reader of [page, second, third]) {
      await expect(reader.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
      await expect(reader.getByLabel('行距', { exact: true })).toHaveValue('relaxed');
      await expect(reader.getByLabel('正文行宽', { exact: true })).toHaveValue('wide');
      await expect(reader.getByLabel('剧情正文', { exact: true })).toHaveValue('titles');
    }
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    for (const reader of [page, second, third]) {
      await expect(reader.getByLabel('正文字号', { exact: true })).toHaveValue('normal');
      await expect(reader.getByLabel('行距', { exact: true })).toHaveValue('normal');
      await expect(reader.getByLabel('正文行宽', { exact: true })).toHaveValue('comfortable');
      await expect(reader.getByLabel('剧情正文', { exact: true })).toHaveValue('full');
    }
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
    await expect(second.locator('.reader-bookmarks a')).toHaveCount(0);
    await expect(third.locator('.reader-bookmarks a')).toHaveCount(0);
    await second.getByLabel('正文字号', { exact: true }).selectOption('large');
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('large');
    await second.evaluate(() => localStorage.removeItem('ats.reader.preferences.v1'));
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('normal');
    await expect(third.getByLabel('正文字号', { exact: true })).toHaveValue('normal');
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
  } finally { await second.close(); await third.close(); }
});

for (const [world, record] of [['arknights', 'evt-375'], ['ff14', 'ff14-001'], ['wh40k', 'wh-017']]) {
  test(`${world}: expanded reading preferences keep the tools readable`, async ({ page }, testInfo) => {
    await page.goto(`/.ats/${world}-chronicle.html#${record}`);
    await expect(page.locator(world === 'wh40k' ? `#reader-${record}` : `#${record}`)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    for (const [label, value] of [['正文字号', 'larger'], ['行距', 'relaxed'], ['正文行宽', 'wide'], ['剧情正文', 'titles']]) {
      await page.getByLabel(label, { exact: true }).selectOption(value);
    }
    if (world === 'arknights') await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.reader-tools-help').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    expect(await page.locator('.reader-tools-help').evaluate(node => getComputedStyle(node).color))
      .toBe(await page.locator('.reader-tools-status').evaluate(node => getComputedStyle(node).color));
    const panel = page.locator('.reader-tools');
    await panel.evaluate(node => { node.scrollTop = 0; });
    await panel.screenshot({ path: testInfo.outputPath(`shared-settings-${world}.png`) });
    if (await panel.evaluate(node => node.scrollHeight > node.clientHeight)) {
      await panel.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await panel.screenshot({ path: testInfo.outputPath(`shared-settings-${world}-bottom.png`) });
    }
  });
}

test('a stale settings panel changes only the selected field', async ({ page, context }) => {
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const second = await context.newPage();
  try {
    // Simulate a missed notification without changing the real storage or save path.
    await second.addInitScript(() => window.addEventListener('storage', event => {
      if (event.key === 'ats.reader.preferences.v1') event.stopImmediatePropagation();
    }, true));
    await second.goto('/.ats/ff14-chronicle.html#ff14-001');
    await expect(second.locator('#ff14-001')).toBeFocused();
    await second.locator('.reader-tools > summary').click();
    await page.getByLabel('正文字号', { exact: true }).selectOption('larger');
    await page.getByLabel('正文行宽', { exact: true }).selectOption('wide');
    await page.getByLabel('剧情正文', { exact: true }).selectOption('titles');
    await expect(second.getByLabel('正文字号', { exact: true })).toHaveValue('normal');
    await second.getByLabel('行距', { exact: true }).selectOption('relaxed');
    for (const reader of [page, second]) {
      await expect(reader.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
      await expect(reader.getByLabel('正文行宽', { exact: true })).toHaveValue('wide');
      await expect(reader.getByLabel('剧情正文', { exact: true })).toHaveValue('titles');
      await expect(reader.getByLabel('行距', { exact: true })).toHaveValue('relaxed');
    }
  } finally { await second.close(); }
});

test('unsaved session preferences survive other pages and a persisted-pageshow handler', async ({ page, context }) => {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ats.reader.preferences.v1') throw new DOMException('quota', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await page.getByLabel('正文字号', { exact: true }).selectOption('larger');
  await expect(page.locator('.reader-tools-status')).toContainText('未允许保存');
  const second = await context.newPage();
  try {
    await second.goto('/.ats/ff14-chronicle.html#ff14-001');
    await expect(second.locator('#ff14-001')).toBeFocused();
    await second.locator('.reader-tools > summary').click();
    await second.getByLabel('正文行宽', { exact: true }).selectOption('wide');
    await page.getByLabel('行距', { exact: true }).selectOption('relaxed');
    // Handler coverage only: this event does not establish a native bfcache hit.
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
    await expect(page.getByLabel('行距', { exact: true })).toHaveValue('relaxed');
    await expect(page.getByLabel('正文行宽', { exact: true })).toHaveValue('comfortable');
    await expect(page.locator('.reader-tools-status')).toContainText('未允许保存');
  } finally { await second.close(); }
});

test('returning readers refresh preferences and ignore unrelated session storage', async ({ page, context }) => {
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  const second = await context.newPage();
  try {
    await second.goto('/.ats/ff14-chronicle.html#ff14-001');
    await expect(second.locator('#ff14-001')).toBeFocused();
    await second.locator('.reader-tools > summary').click();
    await page.goto('/.ats/about.html');
    await second.getByLabel('正文字号', { exact: true }).selectOption('larger');
    await page.goBack();
    await expect(page.locator('#evt-375')).toBeFocused();
    const panel = page.locator('.reader-tools');
    if (!(await panel.evaluate(node => node.open))) await panel.locator('summary').click();
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
    await page.evaluate(() => {
      localStorage.setItem('ats.reader.preferences.v1', JSON.stringify({ size: 'large', leading: 'relaxed' }));
      dispatchEvent(new StorageEvent('storage', { key: 'ats.reader.preferences.v1', storageArea: sessionStorage }));
    });
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
    // Explicitly test the persisted handler independently of browser cache policy.
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('large');
    await expect(page.getByLabel('行距', { exact: true })).toHaveValue('relaxed');
    await second.evaluate(() => localStorage.clear());
    await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('normal');
    await expect(page.getByLabel('行距', { exact: true })).toHaveValue('normal');
  } finally { await second.close(); }
});
