const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

for (const [pageName, parameter] of [['reflections', 'reflection'], ['journeys', 'journey']]) {
  test(`FFXIV ${pageName} preserves modified keys and supports plain selection keys`, async ({ page }) => {
    await page.goto(`/.ats/ff14-${pageName}.html`);
    const buttons = page.locator(`[data-${parameter}-id]`);
    await expect(buttons.first()).toHaveAttribute('tabindex', '0');
    await buttons.first().press('ArrowRight');
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.nth(1)).toBeFocused();
    const selectedUrl = page.url();

    // Synthetic events verify handler boundaries, not OS input-method behavior.
    for (const options of [
      { key: 'ArrowLeft', altKey: true },
      { key: 'Home', ctrlKey: true },
      { key: 'End', metaKey: true },
      { key: 'ArrowRight', isComposing: true },
    ]) {
      const allowed = await buttons.nth(1).evaluate((node, options) => {
        return node.dispatchEvent(new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true }));
      }, options);
      expect(allowed).toBe(true);
      await expect(page).toHaveURL(selectedUrl);
      await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    }
    await buttons.nth(1).evaluate(node => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      event.preventDefault();
      node.dispatchEvent(event);
    });
    await expect(page).toHaveURL(selectedUrl);

    await buttons.nth(1).press('End');
    await expect(buttons.last()).toBeFocused();
    await expect(buttons.last()).toHaveAttribute('aria-pressed', 'true');
    await buttons.last().press('ArrowRight');
    await expect(buttons.first()).toBeFocused();
    await buttons.first().press('ArrowLeft');
    await expect(buttons.last()).toBeFocused();
    await buttons.last().press('Home');
    await expect(buttons.first()).toBeFocused();
    await expect(page.locator(`[data-${parameter}-panel]:visible`)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`FFXIV ${pageName} does not duplicate a selection and restores back, forward and reload`, async ({ page }) => {
    await page.goto(`/ff14-${pageName}.html`);
    const buttons = page.locator(`[data-${parameter}-id]`);
    await expect(buttons.first()).toHaveAttribute('tabindex', '0');
    const secondId = await buttons.nth(1).getAttribute(`data-${parameter}-id`);
    const thirdId = await buttons.nth(2).getAttribute(`data-${parameter}-id`);
    await buttons.nth(1).click();
    await buttons.nth(2).click();
    await buttons.nth(2).click();
    await page.goBack();
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`[data-${parameter}-panel="${secondId}"]`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#${secondId}$`));
    await page.goForward();
    await expect(buttons.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`[data-${parameter}-panel="${thirdId}"]`)).toBeVisible();
    await page.reload();
    await expect(buttons.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.nth(2)).toHaveAttribute('tabindex', '0');
    await page.goBack();
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  });
}
