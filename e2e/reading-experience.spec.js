const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

test('story guide has a spoiler gate, source evidence and original chronological targets', async ({ page }, testInfo) => {
  await page.goto('/.ats/arknights-stories.html');
  await expect(page.locator('.story-sequence')).toBeHidden();
  await page.getByText('展开故事导读 · 含剧情转折', { exact: true }).click();
  await expect(page.locator('.story-sequence > li')).toHaveCount(4);
  await expect(page.locator('.reading-caution')).toContainText('建造年份待复核');
  await page.screenshot({ path: testInfo.outputPath('story-guide.png') });
  await page.locator('.story-evidence summary').first().click();
  await expect(page.locator('.story-evidence').first().getByRole('link')).toHaveAttribute('href', /prts.wiki/);
  await page.locator('#story-evt-375 > a').click();
  await expect(page.locator('#evt-375')).toBeFocused();
  await expect(page.locator('#evt-375 h3')).toHaveText('西蒙家族倒台，安东尼入狱');
  await expect(page.locator('#evt-375 .ark-reader-record-description')).toContainText('7月24日');
});

test('world entrances expose three working reading choices and dated scope', async ({ page }, testInfo) => {
  for (const world of ['arknights', 'wh40k', 'ff14']) {
    await page.goto(`/.ats/${world}.html`);
    await expect(page.locator('.reading-paths > a')).toHaveCount(3);
    await page.locator('.reading-coverage summary').click();
    await expect(page.locator('.reading-coverage')).toContainText('2026-07');
    const palette = await page.locator('.reading-entrance').evaluate(node => {
      const style = getComputedStyle(node);
      const world = document.body.dataset.world;
      const token = { arknights: '--ark-amber', wh40k: '--wh-brass', ff14: '--ff-crystal' }[world];
      return [style.getPropertyValue('--reading-accent').trim(), style.getPropertyValue(token).trim()];
    });
    expect(palette[0]).toBe(palette[1]);
    await page.locator('.reading-entrance').screenshot({ path: testInfo.outputPath(`entrance-${world}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.reading-paths > a').last().click();
    await expect(page).toHaveURL(new RegExp(`search.html\\?world=${world}`));
  }
});

test('search aliases retain multiword intersection and explain matches', async ({ page }) => {
  await page.goto('/.ats/search.html?q=小刻%20手铳');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await expect(page.locator('#search-status')).toContainText('小刻 → 刻俄柏');
  await expect(page.locator('.search-match-location').first()).toContainText('路线步骤');
  await expect(page.locator('.search-result').first()).toContainText('刻俄柏');
});

test('Arknights settings and bookmarks persist and preferences carry into FFXIV', async ({ page }, testInfo) => {
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.locator('.reader-bookmark-current')).toContainText('西蒙家族倒台，安东尼入狱');
  await expect(page.locator('.reader-bookmarks-empty')).toHaveText('还没有书签。可收藏当前记录，稍后回来接着读。');
  await page.getByLabel('正文字号', { exact: true }).selectOption('larger');
  await page.getByLabel('行距', { exact: true }).selectOption('relaxed');
  await page.getByLabel('正文行宽', { exact: true }).selectOption('wide');
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  const bookmark = page.locator('.reader-bookmarks a').first();
  await expect(bookmark).toHaveAttribute('href', /#evt-375$/);
  await expect(page.locator('.reader-bookmarks-empty')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('reader-settings.png') });
  await page.getByLabel('剧情正文', { exact: true }).selectOption('titles');
  await expect(page.locator('#evt-375 .ark-reader-record-description')).toBeHidden();
  await page.getByLabel('剧情正文', { exact: true }).selectOption('full');
  await page.reload();
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(bookmark).toHaveAttribute('href', /#evt-375$/);
  await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
  await page.goto('/.ats/ff14-chronicle.html#ff14-001');
  await expect(page.locator('#ff14-001')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('larger');
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(0);
  expect(await page.locator('#ff14-001 .ff-reader-prose p').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('WH40K stores a resume target and offers independent reading tools', async ({ page }) => {
  await page.goto('/.ats/wh40k-chronicle.html#wh-017');
  await expect(page.locator('#reader-wh-017')).toBeFocused();
  await page.getByRole('button', { name: '关闭卷宗', exact: true }).click();
  const resume = page.locator('.reader-resume-link');
  await expect(resume).toHaveAttribute('href', '#wh-017');
  await page.reload();
  await expect(resume).toHaveAttribute('href', '#wh-017');
  await resume.click();
  await expect(page.locator('#reader-wh-017')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.getByLabel('正文字号', { exact: true })).toBeVisible();
  await page.getByLabel('正文字号', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reading tools remain usable when browser storage is denied', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }));
  await page.goto('/.ats/arknights-chronicle.html#evt-003');
  await expect(page.locator('#evt-003')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await page.getByLabel('正文字号', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: '收藏当前记录', exact: true }).click();
  await expect(page.locator('.reader-tools-status')).toContainText('未允许保存');
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('blocked storage methods are explained as soon as reading tools open', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('denied', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  await page.goto('/.ats/arknights-chronicle.html#evt-375');
  await expect(page.locator('#evt-375')).toBeFocused();
  await page.locator('.reader-tools > summary').click();
  await expect(page.locator('.reader-tools-status')).toContainText('未允许保存');
  await expect(page.locator('.reader-bookmark-current')).toContainText('西蒙家族倒台，安东尼入狱');
  const button = page.getByRole('button', { name: '收藏当前记录', exact: true });
  await expect(button).toHaveAccessibleDescription(/西蒙家族倒台，安东尼入狱/);
  await button.click();
  await expect(page.locator('.reader-bookmarks a')).toHaveCount(1);
  await page.getByRole('button', { name: '移除书签：西蒙家族倒台，安东尼入狱' }).click();
  await expect(page.locator('.reader-bookmarks-empty')).toBeVisible();
});
