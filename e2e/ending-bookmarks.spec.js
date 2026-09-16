const { test, expect } = require('@playwright/test');
const topics = require('../src/_data/arknightsTopics')();
const key = 'ats.arknights.reader.bookmarks.v1';
const endingId = 'if-sarkaz-endless-ending-2';
const topicUrl = `/.ats/arknights-is-sarkaz.html?record=${endingId}#${endingId}`;

test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

async function acceptSpoilers(page) {
  await expect(page.locator('#is-topic')).toHaveAttribute('data-spoiler-locked', /true|false/);
  if (await page.locator('#ark-spoiler-gate').isVisible()) await page.getByRole('button', { name: '进入完整档案', exact: true }).click();
  await expect(page.locator('#is-topic')).toHaveAttribute('data-spoiler-locked', 'false');
  await expect(page.locator('[data-topic-content]')).toHaveCSS('filter', 'none');
}

test('all seven topics support 28 ending bookmarks and their canonical home links', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const topic of topics) {
    await page.goto(`/.ats/arknights-is-${topic.slug}.html`);
    await acceptSpoilers(page);
    await expect(page.locator('.is-ending-bookmark')).toHaveCount(topic.endings.length);
    for (const ending of topic.endings) {
      const button = page.locator(`#${ending.id} .is-ending-bookmark`);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(await button.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(page.locator('.is-ending-bookmark[aria-pressed="true"]')).toHaveCount(topic.endings.length);
    if (topic.slug === 'sarkaz' || topic.slug === 'blackflow') {
      await page.locator('.is-ending-heading').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`${topic.slug}-bookmarks.png`) });
    }
  }
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).length, key)).toBe(28);
  await page.goto('/.ats/arknights.html');
  await page.locator('[data-reading-home] > summary').click();
  await expect(page.locator('.reading-home-bookmarks a')).toHaveCount(28);
  for (const topic of topics) {
    const id = topic.endings[0].id;
    await expect(page.locator(`.reading-home-bookmarks a[href$="#${id}"]`)).toHaveAttribute('href', `./arknights-is-${topic.slug}.html?record=${id}#${id}`);
  }
  expect(errors).toEqual([]);
});

test('ending bookmarks survive the chronicle and reopen the exact route behind the spoiler gate', async ({ page }, testInfo) => {
  await page.goto(topicUrl);
  await expect(page.locator('#ark-spoiler-gate')).toBeVisible();
  await expect(page.locator('[data-topic-content]')).toHaveAttribute('inert');
  await acceptSpoilers(page);
  const card = page.locator(`#${endingId}`);
  await card.locator('.is-ending-bookmark').focus();
  await page.keyboard.press('Enter');
  await expect(card.locator('.is-ending-bookmark')).toHaveAttribute('aria-pressed', 'true');
  const otherCard = page.locator('#if-sarkaz-endless-ending-3');
  await otherCard.locator('.is-ending-bookmark').click();
  await expect(otherCard).not.toHaveClass(/active/);
  await expect(otherCard.locator('.is-route-guide')).not.toHaveAttribute('open');
  await otherCard.locator('.is-ending-bookmark').click();
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
  await expect(page.locator('.reader-bookmarks a')).toContainText('双王记 · 集成战略结局');
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(2);
  await page.locator(`.reader-bookmarks a[href$="#${endingId}"]`).click();
  await expect(page).toHaveURL(/arknights-is-sarkaz.html\?record=if-sarkaz-endless-ending-2/);
  await expect(card).toBeFocused();
  await expect(card.locator('.is-route-guide')).toHaveAttribute('open');
  await expect(card.locator('.is-ending-bookmark')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => localStorage.removeItem('ats:spoiler:arknights:v1'));
  await page.goto('/.ats/arknights.html');
  await page.locator('[data-reading-home] > summary').click();
  await expect(page.locator('.reading-home-bookmarks a')).toHaveCount(2);
  await page.locator(`.reading-home-bookmarks a[href$="#${endingId}"]`).click();
  await expect(page.locator('#ark-spoiler-gate')).toBeVisible();
  await acceptSpoilers(page);
  await expect(card).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('saved-ending-return.png') });
  await card.locator('.is-ending-bookmark').click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(['evt-375']);
});

test('open chronicle and topic tabs keep bookmark actions in sync', async ({ page, context }) => {
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  const other = await context.newPage();
  try {
    await other.goto(topicUrl);
    await acceptSpoilers(other);
    const bookmark = other.locator(`#${endingId} .is-ending-bookmark`);
    await bookmark.click();
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(2);
    await page.getByRole('button', { name: '移除书签：双王记', exact: true }).click();
    await expect(bookmark).toHaveAttribute('aria-pressed', 'false');
    await bookmark.click();
    await expect(page.locator('.reader-bookmarks a')).toHaveCount(2);
    await page.getByRole('button', { name: '取消当前书签', exact: true }).click();
    await expect(other.locator('[data-ending-bookmark-note]')).toContainText('书签 1/30');
    expect(await other.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual([endingId]);
  } finally { await other.close(); }
});

for (const mode of ['denied', 'full']) {
  test(`ending bookmarks explain ${mode} storage and retain temporary actions`, async ({ page }) => {
    await page.addInitScript(mode => {
      if (mode === 'denied') Object.defineProperty(window, 'localStorage', { get() { throw Error('denied'); } });
      else Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    }, mode);
    await page.goto(topicUrl);
    await acceptSpoilers(page);
    const card = page.locator(`#${endingId}`);
    const button = card.locator('.is-ending-bookmark');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByRole('status')).toContainText('仅在当前页面有效');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await acceptSpoilers(page);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });
}

test('the thirty-bookmark limit leaves previously saved chronicle records intact', async ({ page }) => {
  const ids = require('../dist/data/arknights.json').branches[0].eras.flatMap(era => era.events).slice(0, 30).map(record => record.id);
  await page.goto('/.ats/arknights.html');
  await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids)), { key, ids });
  await page.goto(topicUrl);
  await acceptSpoilers(page);
  const card = page.locator(`#${endingId}`);
  await card.locator('.is-ending-bookmark').click();
  await expect(card.getByRole('status')).toContainText('最多保存 30 条书签');
  await expect(card.locator('.is-ending-bookmark')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(ids);
});
