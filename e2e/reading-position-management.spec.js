const { test, expect } = require('@playwright/test');
const worlds = [['arknights', 'evt-375', 'evt-380'], ['wh40k', 'wh-017', 'wh-018'], ['ff14', 'ff14-001', 'ff14-002']];

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

async function openHome(page, world, positions, bookmarks = []) {
  await page.goto('/.ats/about.html');
  await page.evaluate(({ world, positions, bookmarks }) => {
    localStorage.setItem(`ats.${world}.reader.progress.v1`, JSON.stringify(positions));
    localStorage.setItem(`ats.${world}.reader.bookmarks.v1`, JSON.stringify(bookmarks));
    localStorage.setItem('ats.reader.preferences.v1', '{"size":"large"}');
    localStorage.setItem('ats.unrelated.reader.progress.v1', '{"saved":true}');
  }, { world, positions, bookmarks });
  await page.goto(`/.ats/${world}.html`);
  const panel = page.locator('[data-reading-home]');
  await panel.locator('summary').click();
  await expect(panel).toHaveAttribute('data-reading-state', 'ready');
  return panel;
}

for (const [world, id] of worlds) {
  test(`${world}: clear a reading position while retaining bookmarks and preferences`, async ({ page, isMobile }, testInfo) => {
    let requests = 0;
    page.on('request', request => { if (request.url().includes(`/data/${world}.json`)) requests++; });
    const panel = await openHome(page, world, { mainline: { eventId: id } }, [id]);
    const before = await page.evaluate(() => ({ ...localStorage }));
    const clear = panel.locator('[data-reading-home-clear="mainline"]');
    await expect(clear).toHaveText('清除');
    await expect(clear).toHaveAccessibleName(/^清除阅读位置：/);
    await expect(panel.locator('.reading-home-position-note')).toContainText('继续阅读时会重新保存位置');
    if (!isMobile) {
      const positionBox = await panel.locator('.reading-home-positions a').boundingBox();
      const bookmarkBox = await panel.locator('.reading-home-bookmarks a').boundingBox();
      expect(Math.abs(positionBox.y - bookmarkBox.y)).toBeLessThanOrEqual(1);
    }
    await panel.screenshot({ path: testInfo.outputPath(`${world}-clear-position.png`) });
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('.reading-home-positions')).toHaveCount(0);
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(1);
    await expect(panel.locator('summary')).toBeFocused();
    const after = await page.evaluate(() => ({ ...localStorage }));
    expect(after).toEqual({ ...before, [`ats.${world}.reader.progress.v1`]: '{}' });
    expect(requests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await panel.locator('summary').click();
    await expect(panel.locator('.reading-home-positions')).toHaveCount(0);
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(1);
  });
}

test('FFXIV keeps branch clear actions separate and allows clearing an unavailable position', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const data = require('../dist/data/ff14.json');
  const first = branch => branch.eras?.flatMap(era => era.events)[0] || branch.subBranches?.map(first).find(Boolean);
  const entries = Object.fromEntries(data.branches.map(branch => [branch.id, { eventId: first(branch).id }]));
  entries['missing-branch'] = { eventId: 'missing-record' };
  const panel = await openHome(page, 'ff14', entries, ['ff14-001']);
  const positions = panel.locator('.reading-home-positions');
  await expect(positions.locator('li')).toHaveCount(5);
  await expect(positions.locator('a')).toHaveCount(4);
  await expect(positions).toContainText('暂时无法读取的阅读位置 5');
  await expect(positions).not.toContainText('missing-branch');
  await expect(positions).not.toContainText('missing-record');
  await panel.screenshot({ path: testInfo.outputPath('ff14-five-positions-narrow.png') });
  const clear = root => positions.locator(`[data-reading-home-clear="${root}"]`);
  const lastRoot = data.branches.at(-1).id;
  await clear('missing-branch').focus();
  await page.keyboard.press('Space');
  await expect(clear(lastRoot)).toBeFocused();
  await expect(clear(lastRoot)).toBeInViewport();
  expect(await clear(lastRoot).evaluate(node => node.offsetHeight >= 44 && parseFloat(getComputedStyle(node).fontSize) >= 14)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const branch of [...data.branches].reverse()) {
    await expect(clear(branch.id)).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(positions).toHaveCount(0);
  await expect(panel.locator('summary')).toBeFocused();
  await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('ats.ff14.reader.progress.v1'))).toBe('{}');
});

for (const [world, first, second] of worlds) {
  test(`${world}: a stale home action never clears the newer record saved by a reader`, async ({ page, context }) => {
    const key = `ats.${world}.reader.progress.v1`;
    // Suppress only notifications on this home tab; the reader writes real browser storage.
    await page.addInitScript(key => window.addEventListener('storage', event => {
      if (event.key === key) event.stopImmediatePropagation();
    }, true), key);
    const panel = await openHome(page, world, { mainline: { eventId: first } });
    const clear = panel.locator('[data-reading-home-clear="mainline"]');
    const other = await context.newPage();
    try {
      await other.goto(`/.ats/${world}-chronicle.html#${second}`);
      await expect.poll(() => other.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').mainline?.eventId, key)).toBe(second);
      await expect(clear).toHaveAttribute('data-event-id', first);
      const newest = await other.evaluate(key => localStorage.getItem(key), key);
      await clear.click();
      await expect(panel.locator('.reading-home-note[role="status"]')).toContainText('阅读位置已更新');
      await expect(clear).toHaveAttribute('data-event-id', second);
      await expect(clear).toBeFocused();
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(newest);
      await page.keyboard.press('Enter');
      await expect(panel).toBeHidden();
      await expect(page.locator('.reading-paths a').first()).toBeFocused();
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{}');
    } finally { await other.close(); }
  });
}

test('denied saving keeps the position visible, preserves the warning during search and allows retry', async ({ page }) => {
  const key = 'ats.ff14.reader.progress.v1';
  const panel = await openHome(page, 'ff14', { mainline: { eventId: 'ff14-001' } }, ['ff14-001']);
  await page.evaluate(key => {
    window.restoreProgressWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('quota', 'QuotaExceededError');
      return window.restoreProgressWrite.call(this, name, value);
    };
  }, key);
  const clear = panel.locator('[data-reading-home-clear="mainline"]');
  await clear.click();
  await expect(clear).toBeFocused();
  await expect(panel.locator('.reading-home-note[role="status"]')).toContainText('未能清除阅读位置');
  const search = panel.getByRole('searchbox', { name: '查找书签', exact: true });
  await search.fill('没有匹配');
  await expect(panel.locator('.reader-bookmark-filter-status')).toContainText('没有匹配的书签');
  await expect(panel.locator('.reading-home-note[role="status"]')).toContainText('保存内容保持不变');
  await expect(panel.locator('.reading-home-positions a')).toHaveCount(1);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual({ mainline: { eventId: 'ff14-001' } });
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreProgressWrite; });
  await clear.click();
  await expect(panel.locator('.reading-home-positions')).toHaveCount(0);
  await expect(panel.locator('.reading-home-note[role="status"]')).not.toContainText('未能清除');
  await expect(search).toHaveValue('没有匹配');
});

test('denied reading leaves the visible position and makes no write attempt', async ({ page }) => {
  const key = 'ats.arknights.reader.progress.v1';
  const panel = await openHome(page, 'arknights', { mainline: { eventId: 'evt-375' } });
  await page.evaluate(key => {
    const read = Storage.prototype.getItem;
    window.progressWrites = 0;
    Storage.prototype.getItem = function (name) { if (name === key) throw Error('denied'); return read.call(this, name); };
    Storage.prototype.setItem = function () { window.progressWrites++; };
  }, key);
  const clear = panel.locator('[data-reading-home-clear="mainline"]');
  await clear.click();
  await expect(panel).toBeVisible();
  await expect(clear).toBeFocused();
  await expect(panel.locator('.reading-home-note[role="status"]')).toContainText('未能清除阅读位置');
  expect(await page.evaluate(() => window.progressWrites)).toBe(0);
});

test('home tabs synchronize clearing without moving focus into bookmarks', async ({ page, context }) => {
  const panel = await openHome(page, 'arknights', { mainline: { eventId: 'evt-375' } }, ['evt-375']);
  const other = await context.newPage();
  try {
    await other.goto('/.ats/arknights.html');
    await other.locator('[data-reading-home] > summary').click();
    const clear = panel.locator('[data-reading-home-clear="mainline"]');
    await clear.focus();
    await other.locator('[data-reading-home-clear="mainline"]').click();
    await expect(panel.locator('.reading-home-positions')).toHaveCount(0);
    await expect(panel.locator('summary')).toBeFocused();
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('ats.arknights.reader.bookmarks.v1'))).toBe('["evt-375"]');
  } finally { await other.close(); }
});
