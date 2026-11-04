// Mock every API call: verifies error visibility without sending real credentials.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage();
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  let status = 200;
  let data = {};
  let msg = 'ok';
  if (path === '/api/auth/login') {
    status = 401;
    msg = 'invalid email or password';
  } else if (path === '/api/auth/forgot-password') {
    status = 503;
    msg = '邮件服务暂不可用，请稍后重试';
  } else if (path === '/api/banners' || path.endsWith('/categories')) {
    data = [];
  } else {
    data = { items: [], total: 0, page: 1, page_size: 20 };
  }
  await route.fulfill({
    status, contentType: 'application/json',
    body: JSON.stringify({ code: status === 200 ? 0 : status, msg, data }),
  });
});

async function checkFeedbackAboveOverlay(text, overlayIndex) {
  const message = page.locator('.ant-message-notice').filter({ hasText: text });
  await message.waitFor({ state: 'visible' });
  // 入场动画期间 notice 临时禁用 pointer-events，等它完成后再检查实际遮挡。
  await page.waitForFunction(content => {
    const notice = [...document.querySelectorAll('.ant-message-notice')]
      .find(el => el.textContent.includes(content));
    if (!notice) return false;
    const bounds = notice.getBoundingClientRect();
    const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return !!top && notice.closest('.ant-message').contains(top);
  }, text, { timeout: 3000 });
  const visible = await message.evaluate((el, requiredLayer) => {
    const bounds = el.getBoundingClientRect();
    const root = el.closest('.ant-message');
    const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return {
      layer: Number(getComputedStyle(root).zIndex),
      inFront: !!top && root.contains(top),
      inViewport: bounds.top >= 0 && bounds.bottom <= innerHeight,
      requiredLayer,
    };
  }, overlayIndex);
  assert.ok(visible.layer > overlayIndex, JSON.stringify(visible));
  assert.ok(visible.inFront && visible.inViewport, JSON.stringify(visible));
  assert.equal(await message.count(), 1, 'one failure should produce one error notice');
}

try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const login = page.getByRole('dialog', { name: '欢迎回来' });
    await login.getByPlaceholder('name@example.com').fill('preview@example.invalid');
    await login.getByPlaceholder('输入密码', { exact: true }).fill('incorrect-password');
    await login.getByRole('button', { name: '进入创作空间' }).click();
    await checkFeedbackAboveOverlay('邮箱或密码错误', 9999);
    assert.equal(await login.getByPlaceholder('name@example.com').inputValue(), 'preview@example.invalid');
    await page.screenshot({ path: `/tmp/libtv-login-error-${width}.png`, fullPage: true });
    await login.getByRole('button', { name: '忘记密码？' }).click();
    const forgot = page.getByRole('dialog', { name: '找回密码' });
    await forgot.getByRole('button', { name: /发送/ }).click();
    await checkFeedbackAboveOverlay('邮件服务暂不可用，请稍后重试', 10000);
    await page.screenshot({ path: `/tmp/libtv-forgot-error-${width}.png`, fullPage: true });
    await forgot.getByRole('button', { name: '关闭找回密码窗口' }).click();
    await login.getByRole('button', { name: '关闭登录窗口' }).click();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, widths: [1440, 390], loginFailure: true, nestedModalFailure: true, errors }));
} finally {
  await browser.close();
}
