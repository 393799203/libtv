import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const original = 'https://manwa.huadong-1.ctyunzos.cn/users/avatar-qa/avatar/original.png';
const replacement = '/media/users/avatar-qa/avatar/replacement.png';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#008080"/></svg>';
const errors = [];
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let originalHits = 0;
    let proxyHits = 0;
    let replacementHits = 0;
    let replacementAvailable = false;
    let currentAvatar = original;
    const user = () => ({ id: 'avatar-qa', email: 'avatar@example.invalid', nickname: '头像测试',
      role: 'user', credits: 0, avatar_url: currentAvatar });
    const auth = () => ({ token: `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+900 })).toString('base64url')}.signature`, user: user() });
    await page.route('**/users/avatar-qa/avatar/**', async route => {
      const url = new URL(route.request().url());
      let ok = false;
      if (url.pathname.endsWith('/replacement.png')) {
        replacementHits++;
        ok = replacementAvailable;
      } else if (url.pathname.startsWith('/media/')) {
        proxyHits++;
        ok = proxyHits > 1;
      } else originalHits++;
      await route.fulfill({ status: ok ? 200 : 503,
        contentType: ok ? 'image/svg+xml' : 'text/plain', headers: { 'Cache-Control': 'no-store' },
        body: ok ? svg : 'temporary failure' });
    });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let data = [];
      if (path === '/api/auth/refresh') data = auth();
      else if (path === '/api/auth/me') data = user();
      else if (path === '/api/shows' || path === '/api/projects') data = { items: [], total: 0 };
      else if (path === '/api/auth/referral') data = { code: '0123456789ABCDEF', invited_users: 0 };
      else if (path === '/api/upload/avatar') data = { url: replacement };
      else if (path === '/api/auth/profile') { currentAvatar = replacement; data = user(); }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
    });
    await page.goto(base);
    const header = page.getByRole('button', { name: '打开个人菜单' });
    const avatar = header.locator('.user-avatar');
    await avatar.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="打开个人菜单"] .user-avatar')?.dataset.avatarState === 'failed');
    assert.equal(await avatar.locator('img').evaluate(el => getComputedStyle(el).opacity), '0');
    assert.match(await avatar.evaluate(el => getComputedStyle(el).backgroundImage), /data:image\/svg/);
    await page.waitForFunction(() => document.querySelector('[aria-label="打开个人菜单"] .user-avatar')?.dataset.avatarState === 'loaded', { timeout: 10000 });
    assert.equal(originalHits, 1);
    assert.equal(proxyHits, 2);
    assert.ok(await avatar.locator('img').evaluate(el => el.naturalWidth > 0));
    await header.click();
    await page.getByRole('menuitem', { name: '个人中心' }).click();
    const profile = page.locator('.profile-avatar');
    await profile.waitFor();
    await page.locator('input[type=file][accept="image/*"]').setInputFiles({
      name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(svg),
    });
    await page.waitForFunction(() => document.querySelector('.profile-avatar .user-avatar img')?.getAttribute('src')?.includes('replacement.png'));
    await page.waitForTimeout(5000);
    assert.equal(replacementHits, 3, 'missing avatar must stop after two automatic retries');
    assert.equal(await profile.locator('.user-avatar').getAttribute('data-avatar-state'), 'failed');
    assert.equal(await profile.locator('img').evaluate(el => getComputedStyle(el).opacity), '0');
    const bounds = await profile.locator('.user-avatar').boundingBox();
    assert.ok(bounds.width >= 68 && bounds.height >= 68, 'profile avatar must retain its size');
    replacementAvailable = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.querySelector('.profile-avatar .user-avatar')?.dataset.avatarState === 'loaded');
    assert.equal(replacementHits, 4);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="打开个人菜单"] .user-avatar img')?.getAttribute('src')?.includes('replacement.png'));
    await page.waitForFunction(() => document.querySelector('[aria-label="打开个人菜单"] .user-avatar')?.dataset.avatarState === 'loaded');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, ok: true, failedImageHidden: true, automaticRecovery: true,
      retryLimit: true, onlineRecovery: true, replacementResetsState: true }));
    await context.close();
  }
} finally { await browser.close(); }
