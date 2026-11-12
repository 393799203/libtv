import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const tabs = ['users', 'banners', 'shows', 'styles', 'referrals', 'reconcile', 'channels', 'packages'];
const user = { id: 'admin-qa', email: 'admin@example.invalid', nickname: '运营管理员', role: 'admin', credits: 100 };
const member = { id: 'member-qa', email: 'creator@example.invalid', nickname: '测试创作者', role: 'user',
  channel: 'dianxin', credits: 8888, created_at: '2026-11-01T10:00:00Z', last_active_at: '2026-11-11T16:00:00Z',
  project_count: 12, asset_image_count: 30, asset_video_count: 5 };
const category = { id: 'category-qa', name: '创作分类', show_count: 1, style_count: 1 };
const show = { id: 'show-qa', title: '创作作品', category_id: category.id, category, description: '测试描述',
  video_url: '', thumbnail_url: '', duration: 30, status: 'published', tags: [], author: member.nickname, author_id: member.id };
const metric = { invited_users: 3, paying_users: 2, paid_orders: 4, amount_fen: 123456,
  paid_points: 10000, bonus_points: 500, consumed_points: 8000, refunded_points: 100, net_consumed_points: 7900 };
const referrer = { ...member, ...metric, referral_code: 'ABCDEF0123456789' };
const task = { id: 1, task_id: 'upstream-task-1234567890', provider: 'dianxin', model: 'test-video-model',
  task_kind: 'ai.video', exec_id: 1234, project_id: 'project-qa', project_name: '创作项目', user_id: member.id,
  user_name: member.nickname, user_email: member.email, node_id: 'node-qa', status: 'pending_review',
  charged_amount: 100, refunded_amount: 0, note: '等待人工核对', created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z' };
const errors = [];
const mutations = [];
const failedRequests = [];

async function fixture(context) {
  const adminRequests = [];
  let emptyUsers = false;
  await context.route('**/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'GET' && path !== '/api/auth/refresh') mutations.push({ path, method: req.method() });
    if (path.startsWith('/api/admin/') || path === '/api/users' || path === '/api/shows/pending') adminRequests.push(path);
    let data = [];
    if (path === '/api/auth/refresh') data = { user,
      token: `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+900 })).toString('base64url')}.sig` };
    else if (path === '/api/auth/me') data = user;
    else if (path === '/api/users') data = { items: emptyUsers ? [] : [member], total: emptyUsers ? 0 : 21, page: 1 };
    else if (path === '/api/admin/banners') data = [{ id: 'banner-qa', title: '创作活动', image_url: '', is_active: true, sort_order: 0 }];
    else if (path === '/api/shows/categories' || path === '/api/styles/categories') data = [category];
    else if (path === '/api/shows/pending') data = { items: [{ ...show, id: 'pending-qa', status: 'pending' }], total: 1 };
    else if (path === '/api/shows') data = { items: [show], total: 1 };
    else if (path === '/api/styles') data = { items: [{ id: 'style-qa', name: '水彩风格', category_id: category.id,
      image_url: '', tags: ['水彩'], author: '创作者' }], total: 1 };
    else if (path === '/api/admin/referrals' || path.endsWith('/users') && path.includes('/referrals/')) data = {
      items: [referrer], total: 21, page: 1, summary: { ...metric, platform_users: 100, inviters: 10 } };
    else if (path === '/api/admin/points-packages') data = { items: [{ id: 1, name: '创作者套餐', price: 99,
      points: 10000, badge: '推荐', recommended: true, features: '积分永久有效', sort_order: 1, enabled: true }] };
    else if (path === '/api/channel/policy') data = { policy: 'per_user' };
    else if (path === '/api/pricing') data = { nodes: [{ node_type: 'video', node_name: '视频生成', billing_type: 'per_second',
      ref_video_discount: 0.6, models: [{ model_id: 'test-video', model_name: '测试视频生成模型', description: '视频生成定价描述',
        price: 10, ref_video_billing: true, ref_video_price: 6, ref_video_price_configured: true }] }] };
    else if (path === '/api/admin/provider-tasks') data = { items: [task], total: 21, stats: {
      total: 21, submitted: 0, delivered: 20, pending_review: 1, charged_credits: 2100, refunded: 0, refunded_credits: 0 } };
    else if (path === '/api/billing/records') data = { items: [{ id: 1, type: 'deduct', amount: 100, balance_after: 8888,
      scene: '视频生成', model: 'test-video-model', action: 'ai.video', created_at: '2026-11-11T10:00:00Z', channel: 'dianxin' }], total: 1 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, msg: 'ok', data }) });
  });
  return { adminRequests, setEmptyUsers: value => { emptyUsers = value; } };
}

async function homeOnly(page) {
  await page.getByRole('heading', { name: '作品广场', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(await page.getByText('运营管理中心', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /运营管理/ }).count(), 0);
  const profileMenu = page.getByRole('button', { name: '打开个人菜单' });
  if (page.viewportSize().width < 768) {
    await profileMenu.focus();
    await profileMenu.press('Enter');
  }
  else await profileMenu.hover();
  await page.getByRole('menuitem', { name: /个人中心/ }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: /运营管理/ }).count(), 0);
  await page.mouse.click(10, 200);
}

async function cancelDialog(page, name) {
  const dialog = page.getByRole('dialog', { name, exact: true });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: /取\s*消/, exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}

try {
  // 真实触摸能力用于拦截横屏手机和平板；窄桌面窗口也没有后台入口。
  const blockedDevices = process.env.QA_ADMIN_SCOPE === 'desktop' ? [] :
    [[320,850,true], [390,850,true], [844,390,true], [1024,1366,true], [700,900,false]];
  for (const [width, height, touch] of blockedDevices) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    const { adminRequests } = await fixture(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    const blockedTabs = width === 390 ? ['', ...tabs] : ['users'];
    for (const tab of blockedTabs) {
      await page.goto(`${base}/admin/${tab}`, { waitUntil: 'domcontentloaded' });
      await homeOnly(page);
    }
    assert.deepEqual(adminRequests, [], `${width}x${height}: blocked devices must never fetch management data`);
    if (width === 390) await page.screenshot({ path: '/tmp/libtv-admin-pc-only-mobile.png', fullPage: true });
    await context.close();
    console.log(JSON.stringify({ blocked: true, width, height, touch, routes: blockedTabs.length }));
  }

  const desktopWidths = process.env.QA_ADMIN_WIDTH ? [Number(process.env.QA_ADMIN_WIDTH)] : [1024, 1440];
  for (const width of desktopWidths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const state = await fixture(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const tab of tabs) {
      console.log(`checking PC ${width}: ${tab}`);
      await page.goto(`${base}/admin/${tab}`, { waitUntil: 'domcontentloaded' });
      await page.locator('aside').waitFor();
      await page.locator('aside [aria-current="page"]').waitFor();
      assert.equal(new URL(page.url()).pathname, `/admin/${tab}`);
      await page.getByRole('button', { name: /运营管理/ }).waitFor();
      if (['users', 'referrals', 'reconcile', 'packages'].includes(tab)) {
        await page.locator('table tbody tr:not(.ant-table-measure-row)').first().waitFor();
      }
      if (tab === 'users') {
        await page.getByRole('button', { name: /充\s*值$/ }).first().click();
        await cancelDialog(page, '积分充值');
        await page.mouse.move(0, 0);
        await page.getByRole('button', { name: /积分明细$/ }).first().click();
        const billing = page.getByRole('dialog', { name: '费用明细', exact: true });
        await billing.locator('tbody tr').first().waitFor();
        await billing.locator('.ant-modal-close').click();
        await billing.waitFor({ state: 'hidden' });
        state.setEmptyUsers(true);
        const search = page.getByRole('textbox', { name: '搜索用户', exact: true });
        await search.fill('missing');
        await search.press('Enter');
        await page.getByText('暂无匹配用户，请调整筛选条件').waitFor();
        await search.fill('');
        state.setEmptyUsers(false);
        await search.press('Enter');
        await page.locator('table tbody tr:not(.ant-table-measure-row)').first().waitFor();
      }
      if (tab === 'banners') {
        await page.getByRole('button', { name: /添加版图$/ }).click();
        await cancelDialog(page, '添加版图');
      }
      if (tab === 'shows') {
        await page.getByRole('button', { name: /添加视频$/ }).click();
        await cancelDialog(page, '添加视频');
      }
      if (tab === 'styles') {
        await page.getByRole('button', { name: /添加图片$/ }).click();
        await cancelDialog(page, '添加风格图片');
      }
      if (tab === 'referrals') {
        const invitees = page.getByRole('button', { name: '邀请用户', exact: true }).first();
        await invitees.focus();
        await invitees.press('Enter');
        await page.locator('.ant-drawer table tbody tr:not(.ant-table-measure-row)').first().waitFor();
        await page.locator('.ant-drawer-close').click();
        await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' });
      }
      if (tab === 'reconcile') {
        await page.getByPlaceholder('上游任务号（支持部分匹配）').waitFor();
        await page.getByRole('button', { name: /退\s*费/, exact: true }).first().click();
        await page.locator('.ant-modal-confirm').getByRole('button', { name: /取\s*消/ }).click();
        await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' });
      }
      if (tab === 'channels') await page.getByText('测试视频生成模型', { exact: true }).waitFor();
      if (tab === 'packages') {
        await page.getByRole('button', { name: /新建套餐$/ }).click();
        await cancelDialog(page, '新建套餐');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}:${tab} page overflows`);
      if (width === 1440 && ['users','referrals','reconcile'].includes(tab)) {
        await page.screenshot({ path: `/tmp/libtv-admin-desktop-${tab}.png`, fullPage: true });
      }
    }
    // 打开的 PC 后台变成手机尺寸后立即卸载；浏览器后退不能恢复后台。
    await page.goto(`${base}/admin/users`, { waitUntil: 'domcontentloaded' });
    await page.locator('table tbody tr:not(.ant-table-measure-row)').first().waitFor();
    await page.setViewportSize({ width: 390, height: 850 });
    await homeOnly(page);
    const countAfterExit = state.adminRequests.length;
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await homeOnly(page);
    assert.equal(state.adminRequests.length, countAfterExit);
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: /运营管理/ }).click();
    await page.locator('aside').waitFor();
    await context.close();
    console.log(JSON.stringify({ desktop: true, width, tabs: tabs.length, resizeExit: true, desktopReentry: true }));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, [], 'regression must not submit business changes');
  console.log(JSON.stringify({ ok: true, pageErrors: 0, businessMutations: 0 }));
} catch (error) {
  console.error(JSON.stringify({ errors, failedRequests: failedRequests.slice(-10),
    pages: await Promise.all(browser.contexts().flatMap(context => context.pages()).map(async page => ({
      url: page.url(), text: (await page.locator('body').innerText().catch(() => '')).slice(0, 1200),
      layout: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, elements:
        [...document.querySelectorAll('aside,aside > div')].map(el => ({ cls: el.className,
          rect: el.getBoundingClientRect().toJSON(), display: getComputedStyle(el).display,
          visibility: getComputedStyle(el).visibility })) })).catch(() => null),
    }))) }));
  throw error;
} finally { await browser.close(); }
