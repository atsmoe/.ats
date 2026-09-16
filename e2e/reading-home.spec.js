const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const [world, id, target] of [
  ['arknights', 'evt-375', '#evt-375'],
  ['wh40k', 'wh-017', '#reader-wh-017'],
  ['ff14', 'ff14-001', '#ff14-001'],
]) {
  test(`${world} home resumes real reading and bookmarks with a keyboard-safe spoiler fold`, async ({ page }, testInfo) => {
    await page.goto(`/.ats/${world}-chronicle.html#${id}`);
    await expect(page.locator(target)).toBeFocused();
    await page.locator('.reader-tools > summary').click();
    await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
    const fetched = [];
    page.on('request', request => { if (request.url().includes(`/data/${world}.json`)) fetched.push(request.url()); });
    await page.goto(`/.ats/${world}.html`);
    const panel = page.locator('[data-reading-home]');
    await expect(panel).toHaveAttribute('data-reading-state', 'saved');
    await expect(panel.locator('.reading-home-body')).toBeHidden();
    expect(fetched).toHaveLength(0);
    await panel.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveAttribute('data-reading-state', 'ready');
    expect(fetched).toHaveLength(1);
    await expect(panel.locator('.reading-home-positions a')).toHaveAttribute('href', `./${world}-chronicle.html#${id}`);
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveAttribute('href', `./${world}-chronicle.html#${id}`);
    if (world === 'arknights') await expect(panel.locator('.reading-home-bookmarks strong')).toHaveText('西蒙家族倒台，安东尼入狱');
    expect(await panel.locator('a').first().evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`${world}-continue-reading.png`) });
    await panel.locator('summary').click();
    await panel.locator('summary').click();
    expect(fetched).toHaveLength(1);
    await panel.locator('.reading-home-positions a').click();
    await expect(page.locator(target)).toBeFocused();
    await page.goBack();
    await expect(panel).toBeVisible();
  });
}

test('fresh, denied and damaged storage leave home unchanged without world-data downloads', async ({ page }) => {
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/data\/(arknights|wh40k|ff14)\.json/.test(request.url())) requests.push(request.url()); });
  for (const world of ['arknights', 'wh40k', 'ff14']) {
    await page.goto(`/.ats/${world}.html`);
    await expect(page.locator('[data-reading-home]')).toHaveAttribute('data-reading-state', 'empty');
    await expect(page.locator('[data-reading-home]')).toBeHidden();
  }
  await page.evaluate(() => {
    localStorage.setItem('ats.arknights.reader.progress.v1', '{');
    localStorage.setItem('ats.arknights.reader.bookmarks.v1', 'null');
  });
  await page.goto('/.ats/arknights.html');
  await expect(page.locator('[data-reading-home]')).toHaveAttribute('data-reading-state', 'empty');
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw Error('denied'); } }));
  await page.reload();
  await expect(page.locator('[data-reading-home]')).toHaveAttribute('data-reading-state', 'empty');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('FFXIV keeps all four saved branches distinct and opens a nested mirror-world record', async ({ page }, testInfo) => {
  const data = require('../dist/data/ff14.json');
  const firstRecord = branch => branch.eras?.flatMap(era => era.events)[0] || branch.subBranches?.map(firstRecord).find(Boolean);
  const positions = Object.fromEntries(data.branches.map(branch => [branch.id, { eventId: firstRecord(branch).id }]));
  await page.goto('/.ats/ff14.html');
  await page.evaluate(value => localStorage.setItem('ats.ff14.reader.progress.v1', JSON.stringify(value)), positions);
  await page.reload();
  const panel = page.locator('[data-reading-home]');
  await expect(panel).toHaveAttribute('data-reading-state', 'saved');
  await panel.locator('summary').click();
  await expect(panel.locator('.reading-home-positions a')).toHaveCount(4);
  await expect(panel.locator('.reading-home-bookmarks')).toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath('ff14-four-positions.png') });
  await panel.locator(`a[href$="#${positions.shards.eventId}"]`).click();
  await expect(page.locator(`#${positions.shards.eventId}`)).toBeFocused();
});

test('home ignores stale or other-world IDs and supports retry without deleting bookmarks', async ({ page }) => {
  await page.goto('/.ats/arknights.html');
  const bookmarks = JSON.stringify(['evt-375', 'missing', 'ff14-001']);
  await page.evaluate(value => localStorage.setItem('ats.arknights.reader.bookmarks.v1', value), bookmarks);
  await page.reload();
  await page.route('**/data/arknights.json*', route => route.abort());
  const panel = page.locator('[data-reading-home]');
  await expect(panel).toBeVisible();
  await panel.locator('summary').click();
  await expect(panel).toHaveAttribute('data-reading-state', 'error');
  await expect(panel.getByRole('status')).toContainText('保存内容仍在');
  await page.unroute('**/data/arknights.json*');
  await panel.getByRole('button', { name: '重试', exact: true }).click();
  await expect(panel).toHaveAttribute('data-reading-state', 'ready');
  await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(1);
  await expect(panel.getByRole('status')).toContainText('已保留原有保存内容');
  expect(await page.evaluate(() => localStorage.getItem('ats.arknights.reader.bookmarks.v1'))).toBe(bookmarks);
});

test('home refreshes after another tab changes saved content and accommodates thirty long bookmarks', async ({ page, context }, testInfo) => {
  const data = require('../dist/data/arknights.json');
  const ids = data.branches[0].eras.flatMap(era => era.events).slice(0, 30).map(record => record.id);
  await page.goto('/.ats/arknights.html');
  await expect(page.locator('[data-reading-home]')).toHaveAttribute('data-reading-state', 'empty');
  const other = await context.newPage();
  try {
    await other.goto('/.ats/about.html');
    await other.evaluate(values => localStorage.setItem('ats.arknights.reader.bookmarks.v1', JSON.stringify(values)), ids);
    const panel = page.locator('[data-reading-home]');
    await expect(panel).toHaveAttribute('data-reading-state', 'saved');
    await panel.locator('summary').click();
    await expect(panel.locator('.reading-home-bookmarks a')).toHaveCount(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('thirty-bookmarks.png') });
    await other.evaluate(() => localStorage.removeItem('ats.arknights.reader.bookmarks.v1'));
    await expect(panel).toBeHidden();
    await expect(panel.locator('a')).toHaveCount(0);
  } finally { await other.close(); }
});
