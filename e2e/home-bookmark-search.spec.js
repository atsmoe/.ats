const { test, expect } = require('@playwright/test');

const worlds = [
  ['arknights', 'evt-375', 'evt-380'],
  ['wh40k', 'wh-017', 'wh-018'],
  ['ff14', 'ff14-001', 'ff14-002'],
];

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

async function openHome(page, world, ids, progress = {}) {
  await page.goto('/.ats/about.html');
  await page.evaluate(({ world, ids, progress }) => {
    localStorage.setItem(`ats.${world}.reader.bookmarks.v1`, JSON.stringify(ids));
    localStorage.setItem(`ats.${world}.reader.progress.v1`, JSON.stringify(progress));
  }, { world, ids, progress });
  await page.goto(`/.ats/${world}.html`);
  const panel = page.locator('[data-reading-home]');
  await panel.locator('summary').click();
  await expect(panel).toHaveAttribute('data-reading-state', 'ready');
  return panel;
}

for (const [world, first, second] of worlds) {
  test(`${world}: home searches displayed bookmark titles without filtering reading positions`, async ({ page }, testInfo) => {
    let requests = 0;
    page.on('request', request => { if (request.url().includes(`/data/${world}.json`)) requests++; });
    const panel = await openHome(page, world, [first, second, 'missing-record'], { mainline: { eventId: first } });
    const search = panel.getByRole('searchbox', { name: '查找书签', exact: true });
    await expect(search).toBeVisible({ timeout: 800 });
    const list = panel.locator('.reading-home-bookmarks');
    const title = await list.locator(`a[href$="#${first}"] strong`).innerText();
    const before = await page.evaluate(() => ({ storage: { ...localStorage }, url: location.href }));
    await search.fill(title);
    await expect(list.locator('a')).toHaveAttribute('href', `./${world}-chronicle.html#${first}`);
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list.locator('h3')).toHaveText('书签 · 3');
    await expect(panel.locator('.reader-bookmark-filter-status')).toHaveText('找到 1 / 3 条书签。');
    await expect(panel.locator('.reading-home-positions a')).toHaveCount(1);
    await expect(panel.locator('.reading-home-note[role="status"]')).toContainText('已保留原有保存内容');
    await expect(search).toBeFocused();
    await panel.screenshot({ path: testInfo.outputPath(`${world}-home-search.png`) });
    await search.fill('<img src=x onerror=alert(1)>');
    await expect(list.locator('li')).toHaveCount(0);
    await expect(panel.locator('.reader-bookmark-filter-status')).toContainText('没有匹配的书签');
    await expect(panel.locator('.reading-home-positions a')).toHaveCount(1);
    await expect(panel.locator('.reader-bookmark-filter img')).toHaveCount(0);
    await search.fill('missing-record');
    await expect(list.locator('li')).toHaveCount(0);
    await search.fill('暂时无法读取');
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list.locator('strong')).toHaveText('暂时无法读取的书签 3');
    await panel.getByRole('button', { name: '清空书签查找', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(list.locator('li')).toHaveCount(3);
    expect(await page.evaluate(() => ({ storage: { ...localStorage }, url: location.href }))).toEqual(before);
    expect(requests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('home search uses dates, branches and display titles and defers composition updates', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const panel = await openHome(page, 'arknights', ['evt-001', 'evt-375', 'if-sarkaz-endless-ending-2']);
  const search = panel.getByRole('searchbox', { name: '查找书签', exact: true });
  const links = panel.locator('.reading-home-bookmarks a');
  await search.fill('１０９１');
  await expect(links).toHaveAttribute('href', './arknights-chronicle.html#evt-375');
  await search.fill('西蒙家族倒台');
  await expect(links).toHaveCount(1);
  await search.fill('ｄｗｄｂ');
  await expect(links).toHaveAttribute('href', './arknights-chronicle.html#evt-001');
  // Synthetic composition events verify handlers, not the operating system's IME.
  await search.evaluate(input => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '双王';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', isComposing: true }));
  });
  await expect(links).toHaveAttribute('href', './arknights-chronicle.html#evt-001');
  await search.dispatchEvent('compositionend', { data: '双王' });
  await expect(links).toHaveCount(1);
  const context = await links.locator('.reading-home-meta').innerText();
  await search.fill(`双王　${context}`);
  await expect(links).toHaveCount(1);
  await panel.locator('summary').click();
  await panel.locator('summary').click();
  await expect(search).toHaveValue(`双王　${context}`);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(panel).toHaveAttribute('open');
  expect(await search.evaluate(node => node.offsetHeight >= 44 && parseFloat(getComputedStyle(node).fontSize) >= 16)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('home-search-narrow.png') });
  await search.fill('双王');
  await search.press('Tab');
  await expect(panel.getByRole('button', { name: '清空书签查找', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(links).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/arknights-is-sarkaz\.html\?record=if-sarkaz-endless-ending-2#if-sarkaz-endless-ending-2$/);
  await expect(page.locator('#ark-spoiler-gate')).toBeVisible();
});

for (const [world, first, second] of worlds) {
  test(`${world}: filtered home removal returns to search and preserves cross-tab updates`, async ({ page, context }) => {
    const panel = await openHome(page, world, [first, second], { mainline: { eventId: first } });
    const search = panel.getByRole('searchbox', { name: '查找书签', exact: true });
    const list = panel.locator('.reading-home-bookmarks');
    const title = await list.locator(`a[href$="#${first}"] strong`).innerText();
    await search.fill(title);
    await panel.locator(`[data-reading-home-remove="${first}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue(title);
    await expect(list.locator('li')).toHaveCount(0);
    await expect(panel.locator('.reading-home-positions a')).toHaveCount(1);
    const other = await context.newPage();
    try {
      await other.goto('/.ats/about.html');
      await other.evaluate(({ world, first, second }) => localStorage.setItem(`ats.${world}.reader.bookmarks.v1`, JSON.stringify([first, second])), { world, first, second });
      await expect(list.locator('li')).toHaveCount(1);
      await expect(search).toBeFocused();
      await expect(search).toHaveValue(title);
      await other.evaluate(world => localStorage.setItem(`ats.${world}.reader.bookmarks.v1`, '[]'), world);
      await expect(panel.locator('.reader-bookmark-filter-status')).toHaveText('找到 0 / 0 条书签。');
      await expect(search).toBeFocused();
      await search.press('Escape');
      await expect(search).toBeHidden();
      await expect(panel.locator('summary')).toBeFocused();
      await expect(panel.locator('.reading-home-positions a')).toHaveCount(1);
    } finally { await other.close(); }
  });
}

test('last filtered bookmark keeps clear reachable and then returns to the reading entrance', async ({ page }) => {
  const panel = await openHome(page, 'arknights', ['evt-375']);
  const search = panel.getByRole('searchbox', { name: '查找书签', exact: true });
  await search.fill('西蒙');
  await panel.locator('[data-reading-home-remove="evt-375"]').click();
  await expect(search).toBeFocused();
  await expect(panel.locator('.reader-bookmark-filter-status')).toHaveText('找到 0 / 0 条书签。');
  await panel.getByRole('button', { name: '清空书签查找', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('.reading-paths a').first()).toBeFocused();
});

test('home search preserves failed-save warnings and resets on reload without writing queries', async ({ page }) => {
  const key = 'ats.ff14.reader.bookmarks.v1';
  const panel = await openHome(page, 'ff14', ['ff14-001', 'ff14-002']);
  const search = panel.getByRole('searchbox', { name: '查找书签', exact: true });
  const title = await panel.locator('.reading-home-bookmarks a[href$="#ff14-001"] strong').innerText();
  await page.evaluate(() => {
    window.writeAttempts = 0;
    Storage.prototype.setItem = function () { window.writeAttempts++; throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await search.fill(title);
  expect(await page.evaluate(() => window.writeAttempts)).toBe(0);
  await panel.locator('[data-reading-home-remove="ff14-001"]').click();
  await expect(search).toBeFocused();
  await expect(panel.locator('.reader-bookmark-filter-status')).toContainText('没有匹配的书签');
  await expect(panel.locator('.reading-home-note[role="status"]')).toContainText('刷新后可能重新出现');
  await search.press('Escape');
  await expect(panel.locator('.reading-home-bookmarks a')).toHaveAttribute('href', './ff14-chronicle.html#ff14-002');
  await expect(panel.locator('.reading-home-note[role="status"]')).toContainText('刷新后可能重新出现');
  expect(await page.evaluate(() => window.writeAttempts)).toBe(1);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('["ff14-001","ff14-002"]');
  await page.reload();
  await panel.locator('summary').click();
  await expect(search).toHaveValue('');
  await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(2);
});
