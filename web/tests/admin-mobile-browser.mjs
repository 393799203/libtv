import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const user = { id: 'admin-qa', email: 'admin@example.invalid', nickname: '运营管理员', role: 'admin', credits: 100 };
const member = { id: 'member-qa', email: 'averylongaddress-for-mobile-layout@example.invalid', nickname: '测试长昵称的创作者',
  role: 'user', channel: 'dianxin', credits: 8888, created_at: '2026-11-01T10:00:00Z',
  last_active_at: '2026-11-11T16:00:00Z', project_count: 12, asset_image_count: 30, asset_video_count: 5 };
const category = { id: 'category-qa', name: '创作分类', show_count: 1, style_count: 1 };
const show = { id: 'show-qa', title: '用于移动端检查的作品标题', category_id: category.id, category,
  description: '测试描述', video_url: '', thumbnail_url: '', duration: 30, status: 'published', tags: [], author: member.nickname, author_id: member.id };
const banner = { id: 'banner-qa', title: '创作活动推荐版图', description: '活动描述', image_url: '', is_active: true, sort_order: 0 };
const style = { id: 'style-qa', name: '水彩风格', category_id: category.id, image_url: '', tags: ['水彩'], author: '创作者' };
const metric = { invited_users: 3, paying_users: 2, paid_orders: 4, amount_fen: 123456,
  paid_points: 10000, bonus_points: 500, consumed_points: 8000, refunded_points: 100, net_consumed_points: 7900 };
const referrer = { ...member, ...metric, referral_code: 'ABCDEF0123456789' };
const pkg = { id: 1, name: '创作者套餐', price: 99, points: 10000, badge: '推荐', recommended: true, features: '积分永久有效',
  sort_order: 1, enabled: true };
const task = { id: 1, task_id: 'upstream-very-long-task-123456789012345678901234567890',
  provider: 'dianxin', model: 'test-video-model', task_kind: 'ai.video', exec_id: 1234,
  project_id: 'project-qa', project_name: '用于检查的创作项目', user_id: member.id, user_name: member.nickname,
  user_email: member.email, node_id: 'node-qa', status: 'submitted', charged_amount: 100, refunded_amount: 0,
  note: '任务进行中，等待上游返回', created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z' };
const errors = [];
const mutations = [];
let emptyUsers = false;

async function fixture(context) {
  await context.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    let data = [];
    if (req.method() !== 'GET' && path !== '/api/auth/refresh') mutations.push({ path, method: req.method() });
    if (path === '/api/auth/refresh') data = { token: `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+900 })).toString('base64url')}.sig`, user };
    else if (path === '/api/auth/me') data = user;
    else if (path === '/api/users') data = { items: emptyUsers ? [] : [member], total: emptyUsers ? 0 : 21, page: 1 };
    else if (path === '/api/admin/banners') data = [banner];
    else if (path === '/api/shows/categories' || path === '/api/styles/categories') data = [category];
    else if (path === '/api/shows/pending') data = { items: [{ ...show, id: 'pending-qa', status: 'pending' }], total: 1 };
    else if (path === '/api/shows') data = { items: [show], total: 1 };
    else if (path === '/api/styles') data = { items: [style], total: 1 };
    else if (path === '/api/admin/referrals' || path.endsWith('/users') && path.includes('/referrals/')) data = {
      items: [referrer], total: 21, page: 1, summary: { ...metric, platform_users: 100, inviters: 10 } };
    else if (path === '/api/admin/points-packages') data = { items: [pkg] };
    else if (path === '/api/channel/policy') data = { policy: 'per_user' };
    else if (path === '/api/pricing') data = { nodes: [{ node_type: 'video', node_name: '视频生成', billing_type: 'per_second',
      ref_video_discount: 0.6, models: [{ model_id: 'test-video', model_name: '测试视频生成模型长名称', description: '视频生成定价描述',
        price: 10, ref_video_billing: true, ref_video_price: 6, ref_video_price_configured: true }] }] };
    else if (path === '/api/admin/provider-tasks') data = { items: [task], total: 21, stats: {
      total: 21, submitted: 1, delivered: 20, pending_review: 0, charged_credits: 2100, refunded: 0, refunded_credits: 0 } };
    else if (path === '/api/billing/records') data = { items: [{ id: 1, type: 'deduct', amount: 100, balance_after: 8888,
      scene: '视频生成', model: 'test-video-model', action: 'ai.video', created_at: '2026-11-11T10:00:00Z', channel: 'dianxin' }], total: 1 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, msg: 'ok', data }) });
  });
}

async function noOverflow(page, label) {
  const bad = await page.locator('.admin-main').evaluate(el => {
    const candidates = [el, ...el.querySelectorAll('*')];
    return candidates.filter(node => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || !node.getClientRects().length || node.clientWidth === 0 || style.textOverflow === 'ellipsis') return false;
      if (innerWidth >= 768 && (node.matches('.ant-table-content,.admin-user-records'))) return false;
      return node.scrollWidth > node.clientWidth + 3 && ['auto','scroll','hidden'].includes(style.overflowX) &&
        !node.closest('table') && !node.classList.contains('ant-select-selection-overflow');
    }).map(node => ({ tag: node.tagName, cls: node.className, width: node.clientWidth, content: node.scrollWidth })).slice(0, 8);
  });
  assert.deepEqual(bad, [], `${label}: clipped or horizontal content ${JSON.stringify(bad)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label);
}

async function dialogFits(page, dialog, label) {
  await dialog.waitFor();
  await page.waitForTimeout(350); // Wait for the modal/drawer entrance transform.
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, `${label} width ${JSON.stringify(box)}`);
  assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, `${label} height ${JSON.stringify(box)}`);
}

try {
  for (const [width, height] of [[320,850], [390,850], [844,390], [768,850], [1440,850]]) {
    const mobile = width < 768;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile || height < 600 });
    await fixture(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/admin/users`);
    console.log(`checking ${width}: users`);
    await page.locator('.admin-record-table tbody tr').first().waitFor();
    const nav = page.getByRole('combobox', { name: '运营模块', exact: true });
    if (mobile) {
      await nav.waitFor();
      assert.equal(await page.locator('.admin-shell > aside').isVisible(), false);
      const record = page.locator('.admin-record-table tbody tr').first();
      assert.equal(await record.evaluate(el => getComputedStyle(el).display), 'block');
      assert.equal(await record.locator('td[data-label="渠道商"]').isVisible(), true);
      await page.getByRole('button', { name: '打开个人菜单' }).click();
      await page.getByRole('menuitem', { name: '运营管理' }).waitFor();
      await page.getByRole('menuitem', { name: '运营管理' }).click();
      await nav.selectOption('users');
      await page.locator('.admin-record-table tbody tr').first().waitFor();
    } else {
      assert.equal(await nav.isVisible(), false);
      assert.equal(await page.locator('.admin-shell > aside').isVisible(), true);
    }
    await noOverflow(page, `${width}:users`);
    await page.getByRole('button', { name: /充值$/ }).click();
    const recharge = page.getByRole('dialog', { name: '积分充值', exact: true });
    await dialogFits(page, recharge, `${width}:recharge`);
    await recharge.getByRole('button', { name: '取消', exact: true }).click();
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: /积分明细$/ }).click();
    const billing = page.getByRole('dialog', { name: '费用明细', exact: true });
    await dialogFits(page, billing, `${width}:billing`);
    await billing.locator('tbody tr').first().waitFor();
    await billing.locator('.ant-modal-close').click();
    await page.mouse.move(0, 0);
    if (mobile) {
      emptyUsers = true;
      await page.getByRole('textbox', { name: '搜索用户', exact: true }).fill('missing');
      await page.getByRole('textbox', { name: '搜索用户', exact: true }).press('Enter');
      await page.getByText('暂无匹配用户，请调整筛选条件').waitFor();
      await page.getByRole('textbox', { name: '搜索用户', exact: true }).waitFor();
      emptyUsers = false;
    }

    for (const tab of ['banners','shows','styles','referrals','reconcile','channels','packages']) {
      console.log(`checking ${width}: ${tab}`);
      if (mobile) await nav.selectOption(tab);
      else await page.goto(`${base}/admin/${tab}`);
      const marker = {
        banners: '.admin-banner-grid', shows: '.admin-video-grid', styles: '.grid-cols-8',
        referrals: '.admin-responsive-table', reconcile: '.admin-responsive-table',
        channels: '.admin-price-row', packages: '.admin-record-table',
      }[tab];
      await page.locator(marker).first().waitFor();
      await page.waitForTimeout(150);
      await noOverflow(page, `${width}:${tab}`);
      if (mobile && ['referrals','reconcile'].includes(tab)) {
        const first = page.locator('.admin-responsive-table .ant-table-tbody > tr').first();
        assert.equal(await first.evaluate(el => getComputedStyle(el).display), 'block');
      }
      if (tab === 'banners') {
        await page.getByRole('button', { name: /添加版图$/ }).click();
        const dialog = page.getByRole('dialog', { name: '添加版图', exact: true });
        await dialogFits(page, dialog, `${width}:banner-dialog`);
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
      }
      if (tab === 'shows') {
        await page.getByRole('button', { name: /添加视频$/ }).click();
        const dialog = page.getByRole('dialog', { name: '添加视频', exact: true });
        await dialogFits(page, dialog, `${width}:video-dialog`);
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
      }
      if (tab === 'styles') {
        await page.getByRole('button', { name: /添加图片$/ }).click();
        const dialog = page.getByRole('dialog', { name: '添加风格图片', exact: true });
        await dialogFits(page, dialog, `${width}:style-dialog`);
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
      }
      if (tab === 'referrals') {
        await page.getByRole('button', { name: '邀请用户', exact: true }).click();
        await page.locator('.admin-referral-drawer .ant-drawer-content-wrapper').waitFor();
        if (mobile) await dialogFits(page, page.locator('.admin-referral-drawer .ant-drawer-content-wrapper'), `${width}:referral-drawer`);
        await page.locator('.admin-referral-drawer .ant-drawer-close').click();
      }
      if (tab === 'channels') {
        const prices = page.locator('.admin-price-row');
        await prices.scrollIntoViewIfNeeded();
        assert.ok(await prices.boundingBox(), 'pricing must be reachable below channel overview');
      }
      if (tab === 'packages') {
        await page.getByRole('button', { name: /新建套餐$/ }).click();
        const dialog = page.getByRole('dialog', { name: '新建套餐', exact: true });
        await dialogFits(page, dialog, `${width}:package-dialog`);
        await dialog.getByRole('button', { name: /取\s*消/ }).click();
      }
      if (width === 390) await page.screenshot({ path: `/tmp/libtv-admin-mobile-${tab}.png`, fullPage: true });
      await page.mouse.move(0, 0);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, width, height, mobile, tabs: 8, dialogs: 7 }));
    await context.close();
  }
  assert.deepEqual(mutations, [], 'read-only layout checks must not mutate data');
} catch (error) {
  console.error(error.stack);
  console.error(JSON.stringify({ errors, pages: browser.contexts().flatMap(context => context.pages().map(page => page.url())) }));
  throw error;
} finally { await browser.close(); }
