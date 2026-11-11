import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const errors = [];
const user = { id: 'auth-qa', email: 'qa@example.test', nickname: '测试创作者', role: 'admin', credits: 100 };
const shows = Array.from({ length: 4 }, (_, i) => ({
  id: `qa-${i}`, title: `测试作品 ${i + 1}`, author: '创作者', author_id: 'author',
  thumbnail_url: '', duration: 65, likes: 12, tags: ['国风'], category: { id: 'short', name: '短片' },
}));
let activeSession = '';
let sequence = 0;
let loginRequest;
let registrationRequest;
let pendingRefresh = null;
const access = (sid, lifetime = 900) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + lifetime, sid })).toString('base64url')}.signature`;
const auth = sid => ({ token: access(sid), user });

async function setup(context) {
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const headers = {};
    let status = 200;
    let msg = 'ok';
    let data = {};
    if (path === '/api/auth/refresh') {
      const sid = /libtv_session=([^;]+)/.exec(request.headers().cookie || '')?.[1];
      const validAtStart = !!sid && sid === activeSession;
      if (pendingRefresh) {
        const release = pendingRefresh;
        pendingRefresh = null;
        await release.promise;
      }
      if (validAtStart) data = auth(sid);
      else { status = 401; msg = sid ? '该账号已在其他地方登录，请重新登录' : '登录已失效，请重新登录'; }
    } else if (path === '/api/auth/login') {
      loginRequest = request.postDataJSON();
      if (loginRequest.password !== 'correct-password') {
        status = 401; msg = '邮箱或密码错误';
      } else {
        activeSession = `session-${++sequence}`;
        data = auth(activeSession);
        headers['set-cookie'] = `libtv_session=${activeSession}; HttpOnly; Path=/api/auth; SameSite=Lax${loginRequest.remember_me ? '; Max-Age=2592000' : ''}`;
      }
    } else if (path === '/api/auth/register-code') {
      data = { retry_after: 60, expires_in: 600 };
    } else if (path === '/api/auth/register') {
      const body = request.postDataJSON();
      registrationRequest = body;
      assert.equal(body.nickname, '测试昵称');
      status = 400; msg = '验证码错误、已过期或尝试次数过多，请重新获取';
    } else if (path === '/api/auth/logout') {
      activeSession = '';
      headers['set-cookie'] = 'libtv_session=; HttpOnly; Path=/api/auth; Max-Age=0';
    } else if (path === '/api/auth/me') {
      const token = request.headers().authorization?.replace('Bearer ', '');
      const sid = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sid : '';
      if (sid !== activeSession || !sid) { status = 401; msg = '登录已失效，请重新登录'; }
      else data = user;
    } else if (path.endsWith('/categories') || path === '/api/banners') data = [];
    else if (path === '/api/shows') data = { items: shows, total: shows.length };
    else if (path === '/api/projects') data = { items: [], total: 0 };
    else if (path === '/api/users') data = url.searchParams.has('page') ? { items: [user], total: 1 } : [user];
    else if (path === '/api/admin/referrals') data = { items: [], total: 0, stats: {} };
    else if (path === '/api/channel/policy') data = { policy: 'auto' };
    await route.fulfill({ status, headers, contentType: 'application/json',
      body: JSON.stringify({ code: status < 400 ? 0 : status, msg, data }) });
  });
}

async function login(page, remember = true) {
  await page.goto(`${base}/login?redirect=%2Fprojects`);
  await page.getByPlaceholder('name@example.com').fill(user.email);
  await page.getByPlaceholder('输入密码', { exact: true }).fill('correct-password');
  if (remember) await page.getByRole('checkbox', { name: '记住我 30 天' }).check();
  await page.getByRole('button', { name: '进入创作空间' }).click();
  await page.getByRole('button', { name: '打开个人菜单' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/', 'authentication must return home despite redirect query');
  await page.goto(`${base}/projects`);
  await page.getByRole('button', { name: '打开个人菜单' }).waitFor();
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(context);
  const page = await context.newPage();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/register`);
    await page.getByRole('heading', { name: '创建你的账号' }).waitFor();
    await page.getByPlaceholder('name@example.com').fill(user.email);
    await page.getByRole('button', { name: '发送验证码' }).click();
    await page.getByRole('button', { name: /秒后重发/ }).waitFor();
    assert.ok(await page.getByRole('button', { name: /秒后重发/ }).isDisabled());
    await page.getByRole('textbox', { name: '邮箱验证码', exact: true }).fill('123456');
    await page.getByPlaceholder('你希望被怎样称呼').fill('测试昵称');
    await page.getByPlaceholder('至少 8 个字符', { exact: true }).fill('1234567');
    await page.getByPlaceholder('再次输入密码').fill('1234567');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    await page.getByText('密码需至少 8 个字符，且不能超过 72 字节', { exact: true }).waitFor();
    await page.getByPlaceholder('至少 8 个字符', { exact: true }).fill('correct-password');
    await page.getByPlaceholder('再次输入密码').fill('correct-password');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    await page.locator('.auth-form-error').filter({ hasText: '验证码错误' }).waitFor();
    assert.equal(await page.getByPlaceholder('你希望被怎样称呼').inputValue(), '测试昵称');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `/tmp/libtv-auth-register-${width}.png`, fullPage: true });
    await page.goto(`${base}/login`);
    await page.getByPlaceholder('name@example.com').fill(user.email);
    await page.getByPlaceholder('输入密码', { exact: true }).fill('incorrect-password');
    await page.getByRole('button', { name: '进入创作空间' }).click();
    await page.locator('.auth-form-error').filter({ hasText: '邮箱或密码错误' }).waitFor();
    await page.screenshot({ path: `/tmp/libtv-auth-login-${width}.png`, fullPage: true });
  }
  for (const referral of ['abcdef0123456789', '']) {
    await page.goto(`${base}/register${referral ? `?ref=${referral}` : ''}`);
    await page.evaluate(() => sessionStorage.setItem('libtv_referral_code', '9999999999999999'));
    assert.equal(await page.getByText('推荐码（选填）', { exact: true }).count(), 0);
    assert.equal(await page.locator('input[name="referralCode"]').count(), 0);
    await page.getByPlaceholder('name@example.com').fill(user.email);
    await page.getByRole('textbox', { name: '邮箱验证码', exact: true }).fill('123456');
    await page.getByPlaceholder('你希望被怎样称呼').fill('测试昵称');
    await page.getByPlaceholder('至少 8 个字符', { exact: true }).fill('correct-password');
    await page.getByPlaceholder('再次输入密码').fill('correct-password');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    await page.locator('.auth-form-error').filter({ hasText: '验证码错误' }).waitFor();
    if (referral) assert.equal(registrationRequest.referralCode, referral.toUpperCase());
    else assert.equal(Object.hasOwn(registrationRequest, 'referralCode'), false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  assert.equal(loginRequest.remember_me, true);
  assert.equal(await page.evaluate(() => localStorage.getItem('libtv_auth')), null);
  assert.ok((await context.cookies()).some(cookie => cookie.name === 'libtv_session' && cookie.httpOnly));
  await page.reload();
  await page.getByRole('button', { name: '打开个人菜单' }).waitFor();
  const tab = await context.newPage();
  await tab.goto(`${base}/projects`);
  await tab.getByRole('button', { name: '打开个人菜单' }).waitFor();
  let releaseRefresh;
  pendingRefresh = { promise: new Promise(resolve => { releaseRefresh = resolve; }) };
  const refreshStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/auth/refresh');
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.ts');
    window.__authRefreshPromise = useAuthStore.getState().refresh().catch(() => {});
  });
  await refreshStarted;
  await page.getByRole('button', { name: '打开个人菜单' }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor();
  await tab.getByRole('heading', { name: '欢迎回来' }).waitFor();
  releaseRefresh();
  await page.evaluate(() => window.__authRefreshPromise);
  assert.equal(await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.ts');
    return useAuthStore.getState().isAuthenticated;
  }), false, 'a late refresh must not restore a logged-out session');
  assert.equal(await context.cookies().then(cookies => cookies.some(cookie => cookie.name === 'libtv_session')), false);
  await login(page, false);
  assert.equal(loginRequest.remember_me, false);
  // A second browser displaces the first browser's session.
  const secondContext = await browser.newContext();
  await setup(secondContext);
  const other = await secondContext.newPage();
  await login(other);
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  // Force a protected request so the old location discovers the replacement.
  await page.evaluate(async () => {
    const { default: api } = await import('/src/services/api.ts');
    await api.get('/auth/me').catch(() => {});
  });
  await page.locator('.ant-message-notice').filter({ hasText: '其他地方登录' }).waitFor();
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor();
  await other.goto(`${base}/admin/users`);
  const users = other.getByTitle('用户管理', { exact: true });
  const referrals = other.getByTitle('邀请统计', { exact: true });
  await users.waitFor();
  assert.equal(await users.locator('[data-icon]').getAttribute('data-icon'), 'user');
  assert.equal(await referrals.locator('[data-icon]').getAttribute('data-icon'), 'team');
  await other.screenshot({ path: '/tmp/libtv-auth-admin-icons.png', fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await page.locator('.home-video-grid .video-card').first().waitFor();
    const columns = await page.locator('.home-video-grid').last().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns, width < 768 ? 1 : width < 900 ? 2 : 4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390) {
      await page.getByRole('heading', { name: '作品广场', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: '/tmp/libtv-gallery-single-column.png', fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, registration: true, loginErrors: true, rememberMe: true,
    reload: true, multiTabLogout: true, singleDevice: true, adminIcons: true, mobileGallery: true,
    urlOnlyReferral: true, referralFieldHidden: true }));
} catch (error) {
  console.error(JSON.stringify({ pageErrors: errors }));
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      console.error(page.url(), (await page.locator('body').innerText()).slice(0, 700));
    }
  }
  throw error;
} finally {
  await browser.close();
}
