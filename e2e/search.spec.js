const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // External font availability must not determine search test results.
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const prefix of ['', '/.ats']) {
  test(`Chinese search and canonical ending links work at ${prefix || '/'}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${prefix}/search.html?q=迷尘幻梦`);
    const link = page.getByRole('link', { name: '迷尘幻梦', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `http://127.0.0.1:4173${prefix}/arknights-is-ceobe.html?record=if-ceobe-ending-1#if-ceobe-ending-1`);
    await expect(page.locator('.search-excerpt mark').first()).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/arknights-is-ceobe\.html\?record=if-ceobe-ending-1#if-ceobe-ending-1$/);
    await expect(page.locator('.is-ending-card#if-ceobe-ending-1')).toBeAttached();
    const consent = page.locator('[data-spoiler-accept]');
    if (await consent.isVisible()) await consent.click();
    await expect(page.locator('[id="if-ceobe-ending-1"]').first()).toBeVisible();
    await expect(page.locator('[id="if-ceobe-ending-1"]').first()).toHaveClass(/active/);
    await page.goBack();
    await expect(page.getByRole('searchbox')).toHaveValue('迷尘幻梦');
    await expect(link).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('world filters, pagination, reload and browser history preserve the query', async ({ page }) => {
  await page.goto('/.ats/search.html?q=世界');
  await expect(page.locator('.search-result')).toHaveCount(10);
  await page.getByRole('button', { name: '显示更多记录' }).click();
  await expect(page.locator('.search-result')).toHaveCount(20);
  await page.getByRole('radio', { name: '最终幻想XIV', exact: true }).check();
  await expect(page).toHaveURL(/world=ff14/);
  await expect(page.locator('.search-result')).toHaveCount(10);
  await expect(page.locator('.search-result:not([data-world="ff14"])')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('radio', { name: '最终幻想XIV', exact: true })).toBeChecked();
  await expect(page.locator('.search-result')).toHaveCount(10);
  await page.goBack();
  await expect(page.getByRole('radio', { name: '全部世界' })).toBeChecked();
  await expect(page.getByRole('searchbox')).toHaveValue('世界');
  await expect(page.locator('.search-result')).toHaveCount(10);
});

for (const prefix of ['', '/.ats']) {
  test(`story search preserves event destinations and the guide spoiler gate at ${prefix || '/'}`, async ({ page }, testInfo) => {
    await page.goto(`${prefix}/search.html?q=临光姐妹`);
    await expect(page.locator('.search-result')).toHaveCount(6);
    const links = await page.locator('.search-result-link').evaluateAll(nodes => nodes.map(node => node.href));
    expect(new Set(links).size).toBe(6);
    expect(links.every(href => href.startsWith(`http://127.0.0.1:4173${prefix}/arknights-chronicle.html#evt-`))).toBe(true);
    const result = page.locator('.search-result').filter({ has: page.getByRole('link', { name: '骑士协会回应耀骑士身份', exact: true }) });
    await expect(result.locator('.search-match-location')).toContainText('故事导读');
    await expect(result.locator('.search-excerpt')).toHaveText(require('../src/_data/arknightsStories.json').find(story => story.id === 'nearl').steps.at(-1).summary);
    await result.locator('.search-date-note > summary').click();
    await expect(result.locator('.search-date-note p')).toContainText('11 月 7 日');
    await expect(result.locator('.search-result-meta')).toContainText('1097年11月6日');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await result.screenshot({ path: testInfo.outputPath(`story-search-${prefix ? 'subpath' : 'root'}.png`) });
    await result.locator('.search-result-link').click();
    await expect(page.locator('#evt-589')).toBeFocused();
    await page.goBack();
    await expect(page.getByRole('searchbox')).toHaveValue('临光姐妹');
    await result.locator('.search-story-link').click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/arknights-stories.html#nearl$`));
    await expect(page.locator('#nearl .story-sequence')).toBeHidden();
    await page.locator('#nearl .story-spoiler > summary').click();
    await expect(page.locator('#nearl .story-sequence > li')).toHaveCount(6);
  });
}

test('guide prose and date notes are searchable, while world filters remain independent', async ({ page }) => {
  for (const [query, expected] of [
    ['阿黛尔 火山博物馆', '阿黛尔与旅人来到新汐斯塔'],
    ['免费寄送明信片', '火山喷发，人们告别旧汐斯塔'],
    ['发布会日期待复核', '骑士协会回应耀骑士身份'],
  ]) {
    await page.goto(`/.ats/search.html?q=${encodeURIComponent(query)}`);
    await expect(page.getByRole('link', { name: expected, exact: true })).toBeVisible();
    if (query === '免费寄送明信片') await expect(page.locator('.search-excerpt mark')).toHaveText(query);
  }
  await expect(page.locator('.search-match-location')).toContainText('日期提示');
  await page.getByRole('radio', { name: '最终幻想XIV', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('没有找到');
  await expect(page.locator('.search-story-link')).toHaveCount(0);
  await page.getByRole('radio', { name: '明日方舟', exact: true }).check();
  await expect(page.getByRole('link', { name: '骑士协会回应耀骑士身份', exact: true })).toBeVisible();
});

for (const record of [
  { title: '星神降生', file: 'wh40k-chronicle.html', id: 'wh-017', selector: '#reader-wh-017' },
  { title: '古代人与古代社会', file: 'ff14-chronicle.html', id: 'ff14-001', selector: '#ff14-001' },
]) {
  test(`search opens the chronicle at ${record.id}`, async ({ page }) => {
    await page.goto(`/.ats/search.html?q=${encodeURIComponent(record.title)}`);
    const link = page.getByRole('link', { name: record.title, exact: true });
    await expect(link).toHaveAttribute('href', `http://127.0.0.1:4173/.ats/${record.file}#${record.id}`);
    await link.click();
    await expect(page.locator(record.selector).first()).toBeVisible();
    await expect(page.locator(record.selector).first()).toContainText(record.title);
  });
}

test('idle page loads no index, IME waits for composition, and clearing resets results', async ({ page }) => {
  const requested = [];
  page.on('request', request => { if (request.url().includes('/pagefind/')) requested.push(request.url()); });
  await page.goto('/.ats/search.html');
  const input = page.getByRole('searchbox');
  await expect(input).toBeEnabled();
  expect(requested).toEqual([]);
  await input.dispatchEvent('compositionstart');
  await input.fill('水');
  await page.waitForTimeout(350);
  expect(requested).toEqual([]);
  await input.fill('水月');
  await input.dispatchEvent('compositionend');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await expect(page).toHaveURL(/q=%E6%B0%B4%E6%9C%88/);
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('.search-result')).toHaveCount(0);
  await expect(page).toHaveURL('/.ats/search.html');
});

test('Chinese proper names match contiguous text and spaced keywords intersect', async ({ page }) => {
  await page.goto('/.ats/search.html?q=水月');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await expect(page.locator('.search-result:not([data-world="arknights"])')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '水晶塔', exact: true })).toHaveCount(0);
  await expect(page.locator('.search-excerpt').first()).toContainText('水月');
  await page.getByRole('searchbox').fill('亚马乌罗提');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await expect(page.locator('.search-result:not([data-world="ff14"])')).toHaveCount(0);
  await page.getByRole('searchbox').fill('水月 伊莎玛拉');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await expect(page.locator('.search-result:not([data-world="arknights"])')).toHaveCount(0);
});

test('failed index download can be retried without reloading the page', async ({ page }) => {
  let failed = false;
  await page.route('**/pagefind/pagefind.js*', route => {
    if (!failed) { failed = true; return route.abort(); }
    return route.continue();
  });
  await page.goto('/.ats/search.html?q=荷鲁斯');
  await expect(page.getByRole('button', { name: '重新尝试' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('检索暂时无法完成');
  await page.getByRole('button', { name: '重新尝试' }).click();
  await expect(page.locator('.search-result').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '重新尝试' })).toBeHidden();
});

test('unmatched and HTML-like input is shown as text and never overflows', async ({ page }) => {
  const query = '<img src=x onerror=alert(1)>找不到的档案'.repeat(4);
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await page.goto(`/.ats/search.html?q=${encodeURIComponent(query)}&world=unknown`);
  await expect(page.getByRole('status')).toContainText('没有找到');
  await expect(page.getByRole('status')).toContainText('<img');
  await expect(page.locator('#search-status img')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '全部世界' })).toBeChecked();
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keyboard navigation and narrow layouts keep search usable', async ({ page }) => {
  await page.goto('/.ats/search.html');
  await expect(page.getByRole('heading', { name: '档案检索', exact: true })).toBeVisible();
  const input = page.getByRole('searchbox');
  await input.focus();
  await input.fill('亚马乌罗提');
  await input.press('Enter');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await page.getByRole('radio', { name: '全部世界' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '明日方舟', exact: true })).toBeChecked();
  await expect(page.getByRole('status')).toContainText('没有找到');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('without JavaScript all three worlds remain reachable', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('http://127.0.0.1:4173/.ats/search.html');
  await expect(page.locator('.search-noscript')).toBeVisible();
  await expect(page.locator('.search-world-cards > a')).toHaveCount(3);
  await expect(page.locator('.search-world-cards > a').last()).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeDisabled();
  await context.close();
});

test('a slow earlier query cannot overwrite the latest results', async ({ page }) => {
  await page.route('**/search-started*', route => route.fulfill({ body: 'ok' }));
  await page.route('**/pagefind/pagefind.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: String.raw`export function createInstance() {
      return {
        async search(query) {
          query = query.replace(/[\s"]/g, '');
          await fetch('./search-started?q=' + encodeURIComponent(query));
          if (query === '旧线索') await new Promise(resolve => setTimeout(resolve, 1200));
          return { results: [{ data: async () => ({
            url: './ff14-chronicle.html#ff14-001',
            meta: { title: query, worldId: 'ff14', world: '最终幻想XIV' },
            excerpt: '<mark>' + query + '</mark>',
          }) }] };
        },
        async destroy() {},
      };
    }`,
  }));
  const started = page.waitForRequest(request => request.url().includes('/search-started'));
  await page.goto('/.ats/search.html?q=旧线索');
  await started;
  await page.getByRole('searchbox').fill('新线索');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('.search-result-link')).toHaveText('新线索');
  await page.waitForTimeout(1400);
  await expect(page.locator('.search-result-link')).toHaveText('新线索');
  await page.goBack();
  await expect(page.getByRole('searchbox')).toHaveValue('旧线索');
});

test('excerpt rendering allows highlighting but strips executable markup', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await page.route('**/pagefind/pagefind.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export function createInstance() {
      return {
        async search() { return { results: [{ data: async () => ({
          url: './ff14-chronicle.html#ff14-001',
          meta: { title: '<svg onload=alert(1)>', worldId: 'arknights', world: '明日方舟', storyId: '../../outside', storyTitle: '<img src=x onerror=alert(1)>', dateNote: '<img src=x onerror=alert(1)>' },
          excerpt: '<mark onclick="alert(1)">海德林</mark><img src=x onerror="alert(1)"><script>alert(1)</script>',
        }) }] }; },
        async destroy() {},
      };
    }`,
  }));
  await page.goto('/.ats/search.html?q=海德林');
  await expect(page.locator('.search-result-link')).toHaveText('<svg onload=alert(1)>');
  await expect(page.locator('.search-excerpt mark')).toHaveText('海德林');
  await expect(page.locator('.search-excerpt mark')).not.toHaveAttribute('onclick');
  await expect(page.locator('.search-result img, .search-result script, .search-result svg')).toHaveCount(0);
  await expect(page.locator('.search-story-link')).toHaveCount(0);
  await page.locator('.search-date-note > summary').click();
  await expect(page.locator('.search-date-note p')).toHaveText('<img src=x onerror=alert(1)>');
  await page.locator('.search-excerpt mark').click();
  expect(dialogs).toEqual([]);
});

test('story excerpts highlight aliases as text and never interpret guide markup', async ({ page }) => {
  const fixture = {
    url: './arknights-chronicle.html#evt-291',
    meta: {
      title: '测试记录', worldId: 'arknights', world: '明日方舟',
      storyId: 'mansfield', storyTitle: '<img src=x onerror=alert(1)>',
      storyPosition: '1 / 4', storyLabel: '背景',
      storySummary: '小刻与刻俄柏是同一个人物。<svg onload=alert(1)>',
      matchFields: JSON.stringify([['故事导读', '小刻与刻俄柏']]),
    },
    excerpt: '这一份自动摘要不应显示',
  };
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await page.route('**/pagefind/pagefind.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export function createInstance() { return { async search() { return { results: [{ id: 'one', data: async () => (${JSON.stringify(fixture)}) }] }; }, async destroy() {} }; }`,
  }));
  await page.goto('/.ats/search.html?q=小刻');
  await expect(page.locator('.search-excerpt')).toHaveText(fixture.meta.storySummary);
  await expect(page.locator('.search-excerpt mark')).toHaveText(['小刻', '刻俄柏']);
  await expect(page.locator('.search-story-link')).toHaveText(`故事导读 · ${fixture.meta.storyTitle}`);
  await expect(page.locator('.search-story-link')).toHaveAttribute('href', 'http://127.0.0.1:4173/.ats/arknights-stories.html#mansfield');
  await expect(page.locator('.search-result img, .search-result svg, .search-result script')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
