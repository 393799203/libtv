import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, timeout: 45000,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const user = { id: 'referral-admin', email: 'admin@example.invalid', nickname: '邀请测试管理员', role: 'admin', credits: 100 };
const metrics = { invited_users: 2, paying_users: 1, paid_orders: 2, amount_fen: 4500,
  paid_points: 500, bonus_points: 40, consumed_points: 170, refunded_points: 20, net_consumed_points: 150 };
const row = { ...metrics, id: 'owner', nickname: '推荐人甲', email: 'owner@example.invalid',
  referral_code: '1234567890ABCDEF', created_at: '2026-11-01T00:00:00+08:00', credits: 30 };
const dashboard = { summary: { ...metrics, platform_users: 4, inviters: 1 }, items: [row], total: 1, page: 1, page_size: 20 };
const errors = [];
let submitted;
const intercept = async route => {
  const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
  let data = {};
  if (path === '/auth/me') data = user;
  else if (path === '/projects') data = { items: [], total: 0, page: 1, page_size: 20 };
  else if (path === '/auth/referral') data = { code: row.referral_code, invited_users: 2 };
  else if (path === '/auth/referral/stats') data = {
    ...metrics, last_7_days: 1, last_30_days: 2,
    days: Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i+1).padStart(2,'0')}`, users: i === 29 ? 1 : 0 })),
  };
  else if (path === '/admin/referrals') data = dashboard;
  else if (path.endsWith('/owner/users')) data = { ...dashboard, items: [{ ...row, id: 'child', nickname: '邀请用户乙' }] };
  else if (path === '/shows/categories' || path === '/banners') data = [];
  else if (path === '/shows') data = { items: [], total: 0 };
  else if (path === '/auth/register') {
    submitted = route.request().postDataJSON();
    data = { token: 'qa-auth-token', user };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(auth => localStorage.setItem('libtv_auth', JSON.stringify(auth)), { token: 'qa-token', user });
  await page.addInitScript(() => {
    window.__referralClipboard = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.__referralClipboard = text; },
    } });
  });
  await page.route('**/api/**', intercept);
  await page.goto(`${base}/admin/referrals`);
  await page.getByRole('heading', { name: '邀请统计' }).waitFor();
  await page.getByText('推荐人甲', { exact: true }).waitFor();
  assert.ok(await page.getByText('¥45.00', { exact: true }).count() >= 1);
  await page.getByRole('button', { name: '邀请用户', exact: true }).click();
  await page.getByText('邀请用户乙', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/libtv-referral-dashboard.png', fullPage: true });
  await page.goto(`${base}/projects`);
  await page.getByRole('button').filter({ hasText: '邀请测试管理员' }).hover();
  await page.getByRole('menuitem', { name: '个人中心' }).click();
  await page.getByRole('heading', { name: '个人中心' }).waitFor();
  await page.getByRole('textbox', { name: '我的推荐码', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '我的推荐码', exact: true }).inputValue(), row.referral_code);
  assert.match(await page.getByRole('textbox', { name: '我的邀请链接' }).inputValue(), /\?ref=1234567890ABCDEF$/);
  const invitationLink = page.getByRole('textbox', { name: '我的邀请链接' });
  const copyInvitation = page.getByRole('button', { name: '复制邀请链接', exact: true });
  const checkLinkCopyPosition = async () => {
    const link = await invitationLink.boundingBox();
    const copy = await copyInvitation.boundingBox();
    assert.ok(copy.x >= link.x + link.width, 'copy belongs to the right of the link');
    assert.ok(copy.y < link.y + link.height && copy.y + copy.height > link.y, 'link and copy must share a row');
    await copyInvitation.click();
    assert.equal(await page.evaluate(() => window.__referralClipboard), await invitationLink.inputValue());
  };
  const checkQRCode = async () => {
    await page.getByRole('button', { name: '二维码邀请链接', exact: true }).click();
    const qr = page.getByRole('img', { name: '邀请二维码', exact: true });
    await qr.waitFor();
    await page.waitForFunction(() => {
      const element = document.querySelector('[aria-label="邀请二维码"]');
      if (!element) return false;
      const box = element.getBoundingClientRect();
      return box.width >= 207 && box.x >= -1 && box.right <= innerWidth + 1;
    });
    assert.equal(await qr.locator('svg').count(), 1);
    const bounds = await qr.boundingBox();
    assert.ok(bounds.width >= 207 && bounds.x >= -1 &&
      bounds.x + bounds.width <= page.viewportSize().width + 1,
      `QR must remain readable and inside the viewport: ${JSON.stringify(bounds)}`);
    await page.screenshot({ path: `/tmp/libtv-referral-qr-${page.viewportSize().width}.png`, fullPage: true });
    // The popover must sit above the profile and remain dismissible without closing it.
    assert.ok(await qr.evaluate(el => Number(getComputedStyle(el.closest('.ant-popover')).zIndex) > 1000));
    await page.getByRole('button', { name: '二维码邀请链接', exact: true }).click();
    await qr.waitFor({ state: 'hidden' });
  };
  await checkLinkCopyPosition();
  await checkQRCode();
  const profile = page.getByRole('dialog', { name: '个人中心', exact: true });
  const profileBox = await profile.boundingBox();
  const detailsBox = await page.getByRole('region', { name: '个人资料' }).boundingBox();
  const invitationBox = await page.getByRole('region', { name: '我的推荐码', exact: true }).boundingBox();
  assert.ok(profileBox.width >= 800 && profileBox.height < 800);
  assert.ok(invitationBox.x > detailsBox.x + detailsBox.width - 1, 'desktop profile must have left/right columns');
  await page.getByRole('button', { name: '我的邀请统计', exact: true }).click();
  await page.getByRole('dialog', { name: '我的邀请统计', exact: true }).waitFor();
  const personalMetrics = page.getByRole('region', { name: '被邀请用户充值与消耗', exact: true });
  await personalMetrics.getByText('¥45.00', { exact: true }).waitFor();
  await personalMetrics.getByText('150', { exact: false }).waitFor();
  assert.equal(await personalMetrics.locator('dd').allTextContents().then(values => values.join('|')),
    '1 人|2 笔|500 积分|40 积分|170 积分|20 积分');
  await page.screenshot({ path: '/tmp/libtv-referral-personal-metrics.png', fullPage: true });
  await page.getByRole('img', { name: '近30天邀请注册2人' }).waitFor();
  await page.locator('.ant-modal-close').last().click();
  await page.screenshot({ path: '/tmp/libtv-referral-profile.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDetails = await page.getByRole('region', { name: '个人资料' }).boundingBox();
  const mobileInvite = await page.getByRole('region', { name: '我的推荐码', exact: true }).boundingBox();
  assert.ok(mobileInvite.y > mobileDetails.y + mobileDetails.height - 1);
  assert.ok(await profile.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await checkLinkCopyPosition();
  await checkQRCode();
  await page.getByRole('button', { name: '我的邀请统计', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '我的邀请统计', exact: true }).click();
  await personalMetrics.getByText('¥45.00', { exact: true }).waitFor();
  const statsModal = page.getByRole('dialog', { name: '我的邀请统计', exact: true });
  assert.ok(await statsModal.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: '/tmp/libtv-referral-personal-metrics-mobile.png', fullPage: true });
  await page.locator('.ant-modal-close').last().click();
  await page.screenshot({ path: '/tmp/libtv-referral-profile-mobile.png', fullPage: true });

  const visitor = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  visitor.on('pageerror', error => errors.push(error.message));
  await visitor.route('**/api/**', intercept);
  await visitor.goto(`${base}/?ref=1234567890abcdef`);
  const code = visitor.getByRole('textbox', { name: '推荐码（选填）' });
  await code.waitFor();
  assert.equal(await code.inputValue(), row.referral_code);
  await visitor.getByRole('textbox', { name: '邮箱地址' }).fill('new@example.invalid');
  await visitor.getByRole('textbox', { name: '昵称', exact: true }).fill('被邀请人');
  await visitor.locator('#password').fill('test-password-123');
  await visitor.locator('#confirmPassword').fill('test-password-123');
  await visitor.locator('form button[type="submit"]').click();
  await visitor.waitForFunction(() => !!localStorage.getItem('libtv_auth'));
  assert.equal(submitted.referralCode, row.referral_code);
  assert.equal(submitted.channel, 'dianxin');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ ok: true, dashboard: true, inviteeDetails: true, profile: true,
    invitationQR: true, linkCopy: true, registrationAttribution: true, errors }));
} finally { await browser.close(); }
