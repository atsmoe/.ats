const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.loli.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  page.on('pageerror', error => console.log('NAV_PAGE_ERROR', error.message));
  await page.addInitScript(() => {
    window.__navFocus = [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      const before = document.activeElement?.outerHTML?.slice(0, 160);
      const result = original.apply(this, args);
      if (this.closest('#nav, #nav-mobile-menu')) {
        window.__navFocus.push({ target: this.outerHTML.slice(0, 180), before,
          after: document.activeElement?.outerHTML?.slice(0, 160),
          inert: this.closest('[inert]')?.outerHTML.slice(0, 180),
          visibility: getComputedStyle(this).visibility, display: getComputedStyle(this).display });
      }
      return result;
    };
  });
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    console.log('NAV_FOCUS', JSON.stringify(await page.evaluate(() => ({
      attempts: window.__navFocus, url: location.href,
      active: document.activeElement?.outerHTML.slice(0, 180),
      inert: [...document.querySelectorAll('[inert]')].map(node => node.id || node.tagName),
    }))));
  }
});

test('desktop world disclosure synchronizes keyboard, focus and visibility', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop disclosure');
  await page.goto('/about.html');
  const trigger = page.locator('.nav-worlds-trigger');
  const menu = page.locator('#nav-worlds-menu');
  await expect(page.locator('#nav')).toHaveClass(/nav-enhanced/);
  await trigger.focus();
  await expect(menu).toBeHidden();
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  await trigger.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press('ArrowDown');
  await expect(menu.getByRole('link', { name: '明日方舟', exact: true })).toBeFocused();
  await menu.getByRole('link', { name: '最终幻想XIV', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.nav-links').getByRole('link', { name: '档案检索' })).toBeFocused();
  await expect(menu).toBeHidden();
  await trigger.press('ArrowUp');
  await expect(menu.getByRole('link', { name: '最终幻想XIV', exact: true })).toBeFocused();
  // Handler boundary only; this does not claim an operating-system IME test.
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', isComposing: true, bubbles: true, cancelable: true,
  })));
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('mobile drawer keeps focus in visible navigation and restores existing page state', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile drawer');
  await page.goto('/.ats/about.html');
  await page.evaluate(() => { document.body.style.overflow = 'clip'; });
  const toggle = page.getByRole('button', { name: '菜单', exact: true });
  const menu = page.locator('#nav-mobile-menu');
  await toggle.click();
  await expect(menu.getByRole('link', { name: '明日方舟', exact: true })).toBeFocused();
  await expect(page.locator('#main-content')).toHaveAttribute('inert', '');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const last = menu.getByRole('link', { name: '关于', exact: true });
  await last.focus();
  await last.press('Tab');
  await expect(page.locator('.nav-brand')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(menu).toHaveAttribute('inert', '');
  await expect(page.locator('#main-content')).not.toHaveAttribute('inert');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('clip');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('touch viewport changes release the drawer and leave both navigation modes usable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch viewport changes');
  await page.goto('/.ats/about.html');
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  const trigger = page.locator('.nav-worlds-trigger');
  await expect(trigger).toBeFocused();
  await expect(page.locator('#main-content')).not.toHaveAttribute('inert');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await trigger.press('ArrowDown');
  await expect(page.locator('#nav-worlds-menu')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused();
  await expect(page.locator('#nav-worlds-menu')).toBeHidden();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await expect(page.locator('#nav-mobile-menu')).toBeVisible();
  await page.locator('#nav-mobile-backdrop').click({ position: { x: 5, y: 100 } });
  await expect(page.locator('#nav-mobile-menu')).toBeHidden();
  await expect(page.locator('#main-content')).not.toHaveAttribute('inert');
});

for (const pageName of ['index', 'arknights', 'wh40k', 'ff14', 'search']) {
  test(`${pageName} navigation survives an actual page round trip`, async ({ page, isMobile }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/.ats/${pageName}.html`);
    const trigger = isMobile ? page.locator('#nav-toggle') : page.locator('.nav-worlds-trigger');
    const menu = page.locator(isMobile ? '#nav-mobile-menu' : '#nav-worlds-menu');
    await expect(page.locator('#nav')).toHaveClass(/nav-enhanced/);
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const destination = isMobile
      ? menu.getByRole('link', { name: '关于', exact: true })
      : menu.getByRole('link', { name: '明日方舟', exact: true });
    if (!isMobile && pageName === 'arknights') {
      await menu.getByRole('link', { name: '战锤40K', exact: true }).click();
      await expect(page).toHaveURL(/wh40k\.html$/);
    } else {
      await destination.click();
      await expect(page).toHaveURL(isMobile ? /about\.html$/ : /arknights\.html$/);
    }
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${pageName}\\.html$`));
    await expect(page.locator('#nav')).toHaveClass(/nav-enhanced/);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.locator('#main-content')).not.toHaveAttribute('inert');
    expect(errors).toEqual([]);
  });
}
