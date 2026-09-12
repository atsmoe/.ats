const { test, expect } = require('@playwright/test');

test('new pages select revised scripts even when the unversioned script is stale', async ({ page, isMobile }) => {
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  let staleRequests = 0;
  const entries = [];
  // This fixture simulates an old script response; it is not an HTTP-cache hit test.
  await page.route(/\/js\/[^/]+\.js(?:\?.*)?$/, route => {
    const url = new URL(route.request().url());
    entries.push(url);
    if (!url.searchParams.has('v')) {
      staleRequests++;
      return route.fulfill({ contentType: 'text/javascript', body: '// earlier cached entry' });
    }
    return route.continue();
  });

  for (const path of ['/.ats/about.html', '/search.html']) {
    entries.length = 0;
    await page.goto(path);
    await expect(page.locator('#nav')).toHaveClass(/nav-enhanced/);
    const revision = await page.locator('body').getAttribute('data-version');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(url => url.searchParams.get('v') === revision)).toBe(true);
    const trigger = page.locator(isMobile ? '#nav-toggle' : '.nav-worlds-trigger');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
  expect(staleRequests).toBe(0);
});
