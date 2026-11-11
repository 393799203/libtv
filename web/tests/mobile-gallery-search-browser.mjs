import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const errors = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const mobile = width < 768;
    const context = await browser.newContext({
      viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile,
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const keywords = [];
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let status = 200;
      let data = [];
      if (url.pathname === '/api/auth/refresh') status = 401;
      else if (url.pathname === '/api/shows/categories') data = [{ id: 'short', name: '短片' }];
      else if (url.pathname === '/api/shows') {
        keywords.push(url.searchParams.get('keyword') || '');
        data = { items: [], total: 0 };
      }
      await route.fulfill({
        status, contentType: 'application/json',
        body: JSON.stringify({ code: status === 200 ? 0 : status, msg: 'ok', data }),
      });
    });
    await page.goto(base);
    const search = page.getByRole('searchbox', { name: '搜索视频', exact: true });
    await search.scrollIntoViewIfNeeded();
    const initial = await search.evaluate(el => {
      const styles = getComputedStyle(el);
      const bounds = el.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width, font: parseFloat(styles.fontSize),
        border: styles.borderTopWidth, radius: styles.borderRadius,
        keyboard: el.enterKeyHint };
    });
    assert.equal(initial.keyboard, 'search');
    if (mobile) {
      assert.equal(initial.height, 48);
      assert.equal(initial.font, 16);
      assert.equal(initial.border, '0px');
      assert.equal(initial.radius, '24px');
      await search.tap();
    } else if (width >= 1024) {
      assert.equal(initial.width, 320);
      assert.equal(initial.font, 14);
    }
    // Clearing before the debounce fires must never reapply the cleared term.
    await search.fill('soon-cleared');
    const clear = page.locator('.home-search-clear');
    if (mobile) {
      const box = await clear.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
      await clear.tap();
    } else await clear.click();
    await page.waitForTimeout(400);
    assert.equal(await search.inputValue(), '');
    assert.equal(keywords.includes('soon-cleared'), false);
    assert.equal(keywords.at(-1), '');

    // Submitting from the keyboard flushes the pending search exactly once.
    const marker = keywords.length;
    await search.fill('creator');
    await search.press('Enter');
    await page.waitForTimeout(400);
    assert.deepEqual(keywords.slice(marker), ['creator']);
    assert.equal(await search.evaluate(el => el === document.activeElement), false);

    // Chinese composition stays local until the candidate is committed.
    const composingMarker = keywords.length;
    await search.focus();
    await search.dispatchEvent('compositionstart');
    await search.fill('故事');
    await page.waitForTimeout(400);
    assert.equal(keywords.length, composingMarker);
    await search.dispatchEvent('compositionend', { data: '故事' });
    await page.waitForTimeout(400);
    assert.equal(keywords.at(-1), '故事');
    await search.fill('after-composition');
    await page.locator('.home-search-clear').click();
    await page.waitForTimeout(400);
    assert.equal(keywords.at(-1), '');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `/tmp/libtv-mobile-search-${width}.png`, fullPage: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    ok: true, widths: [320,390,768,1440], chromiumTouch: true,
    clearDebounce: true, keyboardSubmit: true, composition: true, desktopPreserved: true,
  }));
} finally {
  await browser.close();
}
