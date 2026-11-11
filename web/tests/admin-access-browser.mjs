import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const errors = [];
try {
  for (const [mode, role] of [['login', 'user'], ['register', 'user'], ['login', 'admin']]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let active = false;
    const adminRequests = [];
    const user = { id: 'access-qa', email: 'qa@example.test', nickname: '测试用户', role, credits: 0 };
    const auth = () => ({ user, token: `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+900 })).toString('base64url')}.sig` });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let status = 200;
      let data = [];
      if (path === '/api/auth/refresh') { if (active) data = auth(); else status = 401; }
      else if (path === '/api/auth/login' || path === '/api/auth/register') { active = true; data = auth(); }
      else if (path === '/api/auth/me') data = user;
      else if (path === '/api/users') { adminRequests.push(path); data = { items: [], total: 0 }; }
      else if (path.startsWith('/api/admin/')) { adminRequests.push(path); data = []; }
      else if (path === '/api/shows' || path === '/api/projects') data = { items: [], total: 0 };
      else if (path === '/api/styles') data = { items: [], total: 0 };
      await route.fulfill({ status, contentType: 'application/json',
        body: JSON.stringify({ code: status === 200 ? 0 : status, msg: 'ok', data }) });
    });
    await page.goto(`${base}/${mode}?redirect=%2Fadmin%2Fusers`);
    await page.evaluate(() => sessionStorage.setItem('auth_redirect', '/admin/banners'));
    await page.getByPlaceholder('name@example.com').fill(user.email);
    if (mode === 'register') {
      await page.getByRole('textbox', { name: '邮箱验证码', exact: true }).fill('123456');
      await page.getByPlaceholder('你希望被怎样称呼').fill(user.nickname);
      await page.getByPlaceholder('至少 8 个字符', { exact: true }).fill('valid-password');
      await page.getByPlaceholder('再次输入密码').fill('valid-password');
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
    } else {
      await page.getByPlaceholder('输入密码', { exact: true }).fill('valid-password');
      await page.getByRole('button', { name: '进入创作空间' }).click();
    }
    await page.getByRole('heading', { name: '作品广场', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const projects = page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的项目', exact: true });
      if (width < 768) {
        await projects.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.home-recent-projects').isVisible(), false);
      } else {
        await projects.waitFor({ state: 'visible' });
      }
    }
    if (role === 'user') {
      for (const tab of ['banners','users','shows','styles','referrals','reconcile','channels','packages']) {
        await page.goto(`${base}/admin/${tab}`);
        await page.getByRole('heading', { name: '作品广场', exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, '/');
        assert.equal(await page.getByText('运营管理中心', { exact: true }).count(), 0);
      }
      assert.deepEqual(adminRequests, [], 'ordinary users must not mount management pages or fetch their data');
    } else {
      await page.goto(`${base}/admin/users`);
      await page.getByText('运营管理中心', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/admin/users');
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, loginHome: true, registrationHome: true,
    staleRedirectIgnored: true, allAdminTabsBlockedForUser: true, adminStillAllowed: true }));
} finally { await browser.close(); }
