const { test, expect } = require('@playwright/test');

test('INTENTIONAL REHEARSAL: release gate stops a broken search page', async ({ page }) => {
  const scenario = process.env.REHEARSAL_SCENARIO;
  test.skip(!scenario || scenario === 'success', 'fault injection only on the rehearsal branch');
  if (scenario === 'cancellation') test.setTimeout(600000);
  await page.goto('/search.html');
  if (scenario === 'cancellation') {
    await page.waitForTimeout(600000);
  } else {
    await expect(page.locator('h1')).toHaveText('INTENTIONAL REHEARSAL FAILURE', { timeout: 1000 });
  }
});
