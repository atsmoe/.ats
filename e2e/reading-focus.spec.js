const { test, expect } = require('@playwright/test');
const key = 'ats.arknights.reader.bookmarks.v1';
const worlds = [
  ['arknights', 'evt-375', 'evt-380', '#evt-375'],
  ['wh40k', 'wh-017', 'wh-018', '#reader-wh-017'],
  ['ff14', 'ff14-001', 'ff14-002', '#ff14-001'],
];

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const [world, first, second, focus] of worlds) {
  test(`${world}: direct bookmark removal keeps keyboard focus in the list`, async ({ page }) => {
    const key = `ats.${world}.reader.bookmarks.v1`;
    await page.goto('/.ats/about.html');
    await page.evaluate(({ key, first, second }) => localStorage.setItem(key, JSON.stringify([first, 'unresolved-record', second])), { key, first, second });
    await page.goto(`/.ats/${world}-chronicle.html#${first}`);
    await expect(page.locator(focus)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    const remove = id => page.locator(`[data-reader-remove="${id}"]`);
    const before = await page.evaluate(world => ({
      url: location.href,
      progress: localStorage.getItem(`ats.${world}.reader.progress.v1`),
      preferences: localStorage.getItem('ats.reader.preferences.v1'),
    }), world);
    await remove('unresolved-record').focus();
    await page.keyboard.press('Enter');
    await expect(remove(second)).toBeFocused({ timeout: 800 });
    expect(await remove(second).evaluate(node => node.matches(':focus-visible'))).toBe(true);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([first, second]);
    await page.keyboard.press('Space');
    await expect(remove(first)).toBeFocused();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([first]);
    await page.keyboard.press('Enter');
    await expect(page.locator('.reader-bookmarks-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: '收藏当前记录', exact: true })).toBeFocused();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([]);
    expect(await page.evaluate(world => ({
      url: location.href,
      progress: localStorage.getItem(`ats.${world}.reader.progress.v1`),
      preferences: localStorage.getItem('ats.reader.preferences.v1'),
    }), world)).toEqual(before);
    await expect(page.locator('.reader-tools')).toHaveAttribute('open');
  });
}

test('direct pointer removal keeps the next button reachable in a long list', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const data = require('../dist/data/arknights.json');
  const ids = data.branches[0].eras.flatMap(era => era.events).slice(0, 30).map(record => record.id);
  await page.goto('/.ats/about.html');
  await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids)), { key, ids });
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const remove = page.locator(`[data-reader-remove="${ids[27]}"]`);
  if (isMobile) await remove.tap();
  else await remove.click();
  const next = page.locator(`[data-reader-remove="${ids[28]}"]`);
  await expect(next).toBeFocused();
  await expect(next).toBeInViewport();
  expect(await page.locator('.reader-bookmarks').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(ids.filter(id => id !== ids[27]));
  expect(new URL(page.url()).hash).toBe('#evt-375');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await next.evaluate(node => node.offsetHeight)).toBeGreaterThanOrEqual(44);
  await page.locator('.reader-tools').screenshot({ path: testInfo.outputPath('direct-removal-position.png') });
});

test('direct removal preserves focus and the storage warning when saving fails', async ({ page }) => {
  const key = 'ats.ff14.reader.bookmarks.v1';
  await page.goto('/.ats/about.html');
  await page.evaluate(key => localStorage.setItem(key, '["ff14-001","ff14-002"]'), key);
  await page.goto('/.ats/ff14-chronicle.html#ff14-001');
  await expect(page.locator('#ff14-001')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await page.evaluate(key => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('quota', 'QuotaExceededError');
      return write.call(this, name, value);
    };
  }, key);
  await page.locator('[data-reader-remove="ff14-001"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-reader-remove="ff14-002"]')).toBeFocused();
  await expect(page.locator('.reader-tools-status')).toContainText('浏览器未允许保存');
  await page.keyboard.press('Enter');
  await expect(page.locator('.reader-bookmarks-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏当前记录', exact: true })).toBeFocused();
  await expect(page.locator('.reader-tools-status')).toContainText('浏览器未允许保存');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('["ff14-001","ff14-002"]');
  await page.reload();
  await expect(page.locator('#ff14-001')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(2);
});

for (const [world, first, second, focus] of worlds) for (const surface of ['home', 'chronicle']) {
  test(`${world} ${surface}: background bookmark updates keep the focused record`, async ({ page, context }) => {
    const key = `ats.${world}.reader.bookmarks.v1`;
    await page.goto('/.ats/about.html');
    await page.evaluate(({ key, first }) => localStorage.setItem(key, JSON.stringify([first])), { key, first });
    await page.goto(surface === 'home' ? `/.ats/${world}.html` : `/.ats/${world}-chronicle.html#${first}`);
    if (surface === 'chronicle') await expect(page.locator(focus)).toBeFocused();
    const panel = page.locator(surface === 'home' ? '[data-reading-home]' : '.reader-tools');
    await panel.locator(':scope > summary').click();
    const list = panel.locator(surface === 'home' ? '.reading-home-bookmarks' : '.reader-bookmarks');
    await expect(list.locator('a')).toHaveCount(1);
    const other = await context.newPage();
    try {
      await other.goto('/.ats/about.html');
      const link = list.locator(`a[href$="#${first}"]`);
      await link.focus();
      await expect(link).toBeFocused();
      const original = page.url();
      await other.evaluate(({ key, first, second }) => localStorage.setItem(key, JSON.stringify([first, second])), { key, first, second });
      await expect(list.locator('a')).toHaveCount(2);
      expect(page.url()).toBe(original);
      await expect(link).toBeFocused({ timeout: 800 });
    } finally { await other.close(); }
  });
}

for (const surface of ['home', 'chronicle']) {
  test(`${surface}: removed focus moves to an adjacent entry then a visible fallback`, async ({ page, context }) => {
    await page.goto('/.ats/about.html');
    await page.evaluate(key => localStorage.setItem(key, '["evt-375","evt-380","evt-381"]'), key);
    await page.goto(surface === 'home' ? '/.ats/arknights.html' : '/.ats/arknights-chronicle.html#evt-375');
    if (surface === 'chronicle') await expect(page.locator('#evt-375')).toBeFocused();
    const panel = page.locator(surface === 'home' ? '[data-reading-home]' : '.reader-tools');
    await panel.locator(':scope > summary').click();
    const list = panel.locator(surface === 'home' ? '.reading-home-bookmarks' : '.reader-bookmarks');
    const target = id => list.locator(surface === 'home' ? `a[href$="#${id}"]` : `[data-reader-remove="${id}"]`);
    const other = await context.newPage();
    try {
      await other.goto('/.ats/about.html');
      await target('evt-380').focus();
      await other.evaluate(key => localStorage.setItem(key, '["evt-375","evt-381"]'), key);
      await expect(target('evt-381')).toBeFocused();
      await other.evaluate(key => localStorage.setItem(key, '["evt-375"]'), key);
      await expect(target('evt-375')).toBeFocused();
      await other.evaluate(key => localStorage.removeItem(key), key);
      if (surface === 'home') {
        await expect(panel).toBeHidden();
        await expect(page.locator('.reading-paths a').first()).toBeFocused();
      } else {
        await expect(page.getByRole('button', { name: '收藏当前记录', exact: true })).toBeFocused();
        await expect(page.locator('.reader-bookmarks-empty')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await other.close(); }
  });

  test(`${surface}: background updates leave outside focus and a closed panel alone`, async ({ page, context }) => {
    await page.goto('/.ats/about.html');
    await page.evaluate(key => localStorage.setItem(key, '["evt-375"]'), key);
    await page.goto(surface === 'home' ? '/.ats/arknights.html' : '/.ats/arknights-chronicle.html#evt-375');
    if (surface === 'chronicle') await expect(page.locator('#evt-375')).toBeFocused();
    const panel = page.locator(surface === 'home' ? '[data-reading-home]' : '.reader-tools');
    await panel.locator(':scope > summary').click();
    const outside = surface === 'home' ? page.locator('.reading-coverage summary') : page.getByRole('combobox', { name: '正文字号', exact: true });
    const other = await context.newPage();
    try {
      await other.goto('/.ats/about.html');
      await outside.focus();
      await other.evaluate(key => localStorage.setItem(key, '["evt-375","evt-380"]'), key);
      await expect(panel.locator(surface === 'home' ? '.reading-home-bookmarks a' : '.reader-bookmarks a')).toHaveCount(2);
      await expect(outside).toBeFocused();
      await panel.locator(':scope > summary').click();
      await other.evaluate(key => localStorage.setItem(key, '["evt-375"]'), key);
      await expect(panel).not.toHaveAttribute('open');
      await expect(panel.locator(':scope > summary')).toBeFocused();
      await other.evaluate(key => localStorage.removeItem(key), key);
      if (surface === 'home') await expect(page.locator('.reading-paths a').first()).toBeFocused();
      else await expect(panel.locator(':scope > summary')).toBeFocused();
    } finally { await other.close(); }
  });
}

test('chronicle preserves a remove button and both scroll positions in a long bookmark list', async ({ page, context }, testInfo) => {
  const data = require('../dist/data/arknights.json');
  const ids = data.branches[0].eras.flatMap(era => era.events).slice(0, 30).map(record => record.id);
  await page.goto('/.ats/about.html');
  await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids.slice(0, 29))), { key, ids });
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  const other = await context.newPage();
  try {
    await other.goto('/.ats/about.html');
    const button = page.locator(`[data-reader-remove="${ids[27]}"]`);
    await page.locator(`[data-reader-bookmark="${ids[27]}"]`).focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    const before = await page.evaluate(() => ['.reader-tools', '.reader-bookmarks'].map(selector => document.querySelector(selector).scrollTop));
    expect(before[1]).toBeGreaterThan(0);
    await other.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids)), { key, ids });
    await expect(page.locator('.reader-bookmarks li')).toHaveCount(30);
    await expect(button).toBeFocused();
    expect(await button.evaluate(node => node.matches(':focus-visible'))).toBe(true);
    const after = await page.evaluate(() => ['.reader-tools', '.reader-bookmarks'].map(selector => document.querySelector(selector).scrollTop));
    for (let i = 0; i < before.length; i++) expect(Math.abs(after[i] - before[i])).toBeLessThanOrEqual(1);
    await page.locator('.reader-tools').screenshot({ path: testInfo.outputPath('preserved-list-focus.png') });
  } finally { await other.close(); }
});

test('home keeps focus when a branch position changes and when a bookmarked record remains in both groups', async ({ page, context }, testInfo) => {
  const progressKey = 'ats.arknights.reader.progress.v1';
  await page.goto('/.ats/about.html');
  await page.evaluate(({ key, progressKey }) => {
    localStorage.setItem(key, '["evt-375"]');
    localStorage.setItem(progressKey, '{"mainline":{"eventId":"evt-375"}}');
  }, { key, progressKey });
  await page.goto('/.ats/arknights.html');
  const panel = page.locator('[data-reading-home]');
  await panel.locator(':scope > summary').click();
  const other = await context.newPage();
  try {
    await other.goto('/.ats/about.html');
    const position = panel.locator('.reading-home-positions a');
    await position.focus();
    await other.evaluate(progressKey => localStorage.setItem(progressKey, '{"mainline":{"eventId":"evt-380"}}'), progressKey);
    await expect(position).toHaveAttribute('href', /#evt-380$/);
    await expect(position).toBeFocused();
    const bookmark = panel.locator('.reading-home-bookmarks a');
    await page.keyboard.press('Tab');
    await expect(panel.locator('[data-reading-home-clear="mainline"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(bookmark).toBeFocused();
    await other.evaluate(progressKey => localStorage.setItem(progressKey, '{"mainline":{"eventId":"evt-375"}}'), progressKey);
    await expect(position).toHaveAttribute('href', /#evt-375$/);
    await expect(bookmark).toBeFocused();
    expect(await bookmark.evaluate(node => node.matches(':focus-visible'))).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath('preserved-home-focus.png') });
  } finally { await other.close(); }
});

test('a delayed home load does not take focus from a new choice', async ({ page, context }) => {
  await page.goto('/.ats/about.html');
  await page.evaluate(key => localStorage.setItem(key, '["evt-375"]'), key);
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/data/arknights.json*', async route => { await wait; await route.continue(); });
  await page.goto('/.ats/arknights.html');
  const panel = page.locator('[data-reading-home]');
  await panel.locator(':scope > summary').click();
  await expect(panel).toHaveAttribute('data-reading-state', 'loading');
  const other = await context.newPage();
  try {
    await other.goto('/.ats/about.html');
    await other.evaluate(key => localStorage.setItem(key, '["evt-380"]'), key);
    const outside = page.locator('.reading-coverage summary');
    await outside.focus();
    release();
    await expect(panel).toHaveAttribute('data-reading-state', 'ready');
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveAttribute('href', /#evt-380$/);
    await expect(outside).toBeFocused();
  } finally { release(); await other.close(); }
});

test('keyboard retry returns focus to the open home summary instead of the page body', async ({ page }) => {
  await page.goto('/.ats/about.html');
  await page.evaluate(key => localStorage.setItem(key, '["evt-375"]'), key);
  await page.route('**/data/arknights.json*', route => route.abort());
  await page.goto('/.ats/arknights.html');
  const panel = page.locator('[data-reading-home]');
  await panel.locator(':scope > summary').click();
  await expect(panel).toHaveAttribute('data-reading-state', 'error');
  await page.unroute('**/data/arknights.json*');
  await panel.getByRole('button', { name: '重试', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveAttribute('data-reading-state', 'ready');
  await expect(panel.locator(':scope > summary')).toBeFocused();
  await expect(panel).toHaveAttribute('open');
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('searchbox', { name: '查找书签', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.locator('.reading-home-bookmarks a')).toBeFocused();
});
