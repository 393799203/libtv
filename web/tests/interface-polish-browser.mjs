import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, timeout: 45000,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const user = { id: 'interface-qa', email: 'qa@example.invalid', nickname: '界面测试',
  credits: 200, role: 'user' };
const projects = Array.from({ length: 6 }, (_, i) => ({
  id: `qa-project-${i}`, name: i === 0 ? '很长的项目名称：小狐狸的江南旅行与森林奇遇记' : `创作项目 ${i + 1}`,
  cover_url: i === 1 ? '/qa/broken-cover.png' : '', updated_at: '2026-11-01T10:00:00+08:00',
  created_at: '2026-11-01T10:00:00+08:00', show_status: i === 2 ? 'published' : '',
}));
const shows = Array.from({ length: 6 }, (_, i) => ({
  id: `qa-video-${i}`, title: i === 0 ? '山间的清晨，和狐狸一起寻找从未见过的江南风景' : `山间创作记录 ${i + 1}`,
  author: '创作者', author_id: 'qa-author', thumbnail_url: '',
  duration: 65, category: { id: 'short', name: '短剧漫剧' }, likes: 12, tags: ['国风', '旅程'],
}));
const errors = [];
let failShows = false;
let failProjects = false;
let emptyProjects = false;
let deleted = 0;
let created = 0;
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const checkSingleLineCaption = async locator => {
  const layout = await locator.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return {
      height: bounds.height,
      overflow: el.scrollWidth > el.clientWidth,
      children: [...el.children].map(child => {
        const rect = child.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          height: rect.height };
      }),
    };
  });
  assert.ok(layout.height <= 40 && !layout.overflow, JSON.stringify(layout));
  assert.ok(layout.children[0].height <= 21, 'a long title must stay on one line');
  assert.ok(layout.children[1].left >= layout.children[0].right,
    'secondary information must sit beside the name');
  assert.ok(layout.children[1].top < layout.children[0].bottom &&
    layout.children[1].bottom > layout.children[0].top, 'caption content must share a row');
};
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(auth => localStorage.setItem('libtv_auth', JSON.stringify(auth)), { token: 'qa-token', user });
await page.route('**/qa/broken-cover.png', route => route.fulfill({ status: 404, body: '' }));
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api/, '');
  let data = {};
  let status = 200;
  if (path === '/auth/me') data = user;
  else if (path === '/projects') {
    if (request.method() === 'POST') { created++; data = { id: 'qa-new-project', name: '未命名' }; }
    else if (failProjects) status = 503;
    else data = { items: emptyProjects ? [] : projects, total: emptyProjects ? 0 : 6, page: 1, page_size: 20 };
  } else if (path.startsWith('/projects/') && request.method() === 'DELETE') { deleted++; data = null; }
  else if (path === '/shows/categories') data = [{ id: 'short', name: '短剧漫剧' }, { id: 'film', name: '专业电影' }];
  else if (path === '/shows') {
    if (failShows) status = 503;
    else data = { items: url.searchParams.get('keyword') ? [] : shows, total: 6, page: 1, page_size: 20 };
  } else if (path === '/banners') data = [{ id: 'recommendation', title: '创作体验与建议反馈', description: '和我们分享你的创作体验。', image_url: '', link_url: '/forum' }];
  else if (path.endsWith('/active-executions')) data = { executions: [] };
  else if (path.endsWith('/canvas')) data = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  else if (path === '/channel/my') data = { channel: 'wasu' };
  else if (path === '/models') data = { image: [], video: [], audio: [], llm: [] };
  else if (path === '/pricing') data = { nodes: [] };
  else if (path.startsWith('/projects/')) data = { id: path.split('/')[2], name: '新项目' };
  await route.fulfill({ status, contentType: 'application/json',
    body: JSON.stringify({ code: status === 200 ? 0 : status, msg: status === 200 ? 'ok' : '暂不可用', data }) });
});

try {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base);
    await page.getByRole('heading', { level: 1, name: '作品广场' }).waitFor();
    const gallery = page.getByRole('region', { name: '作品广场' });
    await gallery.scrollIntoViewIfNeeded();
    await gallery.getByRole('button', { name: `播放视频：${shows[0].title}`, exact: true }).waitFor();
    assert.equal(await page.getByText('MANWA // ONLINE').count(), 0);
    assert.equal(await page.getByText('Featured signal').count(), 0);
    assert.equal(await page.locator('img[src*="picsum"]').count(), 0);
    assert.equal(await page.locator('button button,button [role="button"]').count(), 0);
    const navigation = page.getByRole('navigation', { name: '主导航' });
    for (const name of ['作品广场', '我的项目', '漫蛙社区']) {
      const box = await navigation.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, `${width}: ${name} must remain visible`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const title = gallery.locator('.video-card-title').first();
    const style = await title.evaluate(el => ({ font: parseFloat(getComputedStyle(el).fontSize),
      inImage: !!el.closest('.video-card-preview'), lineHeight: getComputedStyle(el).lineHeight }));
    assert.ok(style.font >= 13 && !style.inImage);
    assert.equal(await title.getAttribute('title'), shows[0].title);
    await checkSingleLineCaption(gallery.locator('.video-card-caption').first());
    if (width >= 768) await checkSingleLineCaption(page.locator('.project-card-caption').first());
    await page.screenshot({ path: `/tmp/libtv-polish-home-${width}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await page.getByRole('textbox', { name: '搜索视频', exact: true }).fill('没有这个作品');
  await page.getByText('没有找到匹配的作品', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清空搜索', exact: true }).last().click();
  await page.getByRole('button', { name: `播放视频：${shows[0].title}`, exact: true }).waitFor();
  failShows = true;
  await page.getByRole('button', { name: '专业电影', exact: true }).click();
  await page.getByText('作品暂时无法加载', { exact: true }).waitFor();
  failShows = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('button', { name: `播放视频：${shows[0].title}`, exact: true }).waitFor();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的项目' }).click();
  await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor();
  const open = page.getByRole('button', { name: `打开项目：${projects[0].name}`, exact: true });
  const remove = page.getByRole('button', { name: `删除项目：${projects[0].name}`, exact: true });
  await remove.focus();
  await page.waitForFunction(() => getComputedStyle(document.activeElement).opacity === '1');
  assert.ok(await remove.evaluate(el => getComputedStyle(el).opacity === '1'));
  assert.equal(await open.locator('button,[role=button]').count(), 0);
  await remove.press('Enter');
  await page.getByRole('button', { name: /取\s*消/ }).click();
  assert.equal(deleted, 0);
  await open.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.ok(await open.evaluate(el => document.activeElement === el));
  assert.equal(await open.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  assert.ok(await page.locator('.project-card').nth(1).locator('.project-card-fallback').count());
  await checkSingleLineCaption(page.locator('.project-card-caption').first());
  await page.screenshot({ path: '/tmp/libtv-polish-projects-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkSingleLineCaption(page.locator('.project-card-caption').first());
  await page.screenshot({ path: '/tmp/libtv-polish-projects-mobile.png', fullPage: true });

  failProjects = true;
  await page.goto(`${base}/projects`);
  await page.getByRole('alert').filter({ hasText: '项目列表暂时无法加载' }).waitFor();
  assert.equal(await page.getByText('从第一个项目开始', { exact: true }).count(), 0);
  failProjects = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('button', { name: `打开项目：${projects[0].name}`, exact: true }).waitFor();
  emptyProjects = true;
  await page.goto(`${base}/projects`);
  await page.getByText('从第一个项目开始', { exact: true }).waitFor();
  await page.getByRole('button', { name: /新建项目/ }).last().click();
  await page.waitForURL('**/project/qa-new-project');
  assert.equal(created, 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ ok: true, widths: [1440, 768, 390, 320], searchRecovery: true,
    errorRecovery: true, keyboardDelete: true, missingCover: true, projectCreation: true, errors }));
} finally { await browser.close(); }
