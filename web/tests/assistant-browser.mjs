// Run against a local Vite server. Every API call is intercepted; no account,
// generation or billing operation is sent to production.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const user = { id: 'assistant-qa', email: 'qa@example.test', nickname: '助手测试', credits: 100 };
const model = {
  ID: 'qa-model', ModelID: 'qa-model', Name: '测试模型', Provider: 'wasu',
  Usage: ['text', 'script', 'image', 'video', 'audio'], Default: true,
};
let canvas = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
let executeCalls = 0;
let chatCalls = 0;
let savedCalls = 0;
let delayed = false;
let generationNodeId = '';
let replannedIds = [];
await page.addInitScript(auth => {
  localStorage.setItem('libtv_auth', JSON.stringify(auth));
}, { token: 'qa-token', user });
await page.route('**/api/**', async route => {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname.replace(/^\/api/, '');
  let data = {};
  if (path === '/auth/me') data = user;
  else if (path === '/models') data = { llm: [model], image: [model], video: [model], audio: [model] };
  else if (path === '/channel/my') data = { channel: 'wasu' };
  else if (path === '/projects') data = { items: [], total: 0, page: 1, page_size: 20 };
  else if (path === '/shows/categories' || path === '/banners') data = [];
  else if (path === '/shows') data = { items: [], total: 0, page: 1, page_size: 20 };
  else if (path === '/assistant/chat') data = {
    reply: '可以先说说你的创作想法，我来帮你梳理。', commands: null, needConfirm: false, logId: 0, rejected: 0,
  };
  else if (path === '/pricing') data = { nodes: [
    { node_type: 'text', node_name: '文本', billing_type: 'per_call', models: [{ model_id: 'qa-model', price: 1 }] },
    { node_type: 'image', node_name: '图片', billing_type: 'per_call', models: [{ model_id: 'qa-model', price: 2 }] },
  ] };
  else if (path === '/projects/qa-project') data = { id: 'qa-project', name: '狐狸短片' };
  else if (path === '/projects/qa-project/active-executions') data = { executions: [] };
  else if (path === '/projects/qa-project/canvas') {
    if (req.method() === 'PUT') { canvas = req.postDataJSON(); savedCalls++; }
    data = canvas;
  } else if (path === '/projects/qa-project/assistant/chat') {
    chatCalls++;
    const { message, snapshot } = req.postDataJSON();
    const plan = {
      message: '建议先确定故事和角色，再准备镜头画面。', nextSteps: ['帮我创建故事和首帧图'],
      createNodes: [], updateNodes: [], connections: [], generateNodeIds: [],
    };
    if (!message.includes('下一步')) {
      plan.message = '准备建立 new:story 和 new:image，引用故事内容生成画面。';
      plan.createNodes = [
        { id: 'new:story', type: 'text', label: '小狐狸的故事', prompt: '', content: '小狐狸沿着山间小路下山。' },
        { id: 'new:image', type: 'image', label: '山间首帧', prompt: '国风水墨，小狐狸走在山间小路上，清晨柔和光线' },
      ];
      plan.connections = [{ source: 'new:story', target: 'new:image' }];
      plan.generateNodeIds = ['new:image'];
    }
    if (message === '检查这个节点') {
      const id = snapshot.nodes.find(n => n.type === 'image').id;
      plan.message = `看看 ${id} 和 \`${id}\`，也可以点击[这张画面](#canvas-node=${id})。`;
      plan.createNodes = []; plan.connections = []; plan.generateNodeIds = [];
      plan.nextSteps = [`继续完善 ${id}`];
    }
    if (message.startsWith('请根据当前画布重新规划')) {
      const id = snapshot.nodes.find(n => n.type === 'image').id;
      replannedIds = snapshot.selectedNodeIds;
      plan.message = '已按当前提示词和参考素材准备新的生成任务。';
      plan.createNodes = []; plan.updateNodes = []; plan.connections = []; plan.nextSteps = [];
      plan.generateNodeIds = [id];
    }
    assert.ok(Array.isArray(snapshot.nodes));
    if (delayed) await new Promise(resolve => setTimeout(resolve, 1000));
    data = { plan, charged: 0, model: 'qa-model' };
  } else if (path === '/projects/qa-project/workflows/execute') {
    executeCalls++;
    generationNodeId = req.postDataJSON().startNodeId;
    data = { executionId: 77 };
  } else if (path.endsWith('/77/stream')) {
    const imageData = { imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="180"%3E%3Crect width="320" height="180" fill="%23324630"/%3E%3C/svg%3E', width: 320, height: 180 };
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `event: node_completed\ndata: ${JSON.stringify({ type: 'node_completed', nodeId: generationNodeId, data: imageData })}\n\n` +
      `event: execution_completed\ndata: ${JSON.stringify({ type: 'execution_completed', data: {} })}\n\n`,
    });
    return;
  } else if (path.endsWith('/workflows/77')) data = { status: 'done' };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, msg: 'ok', data }) });
});

try {
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:3000/project/qa-project');
  // Desktop creation shows the assistant without searching for an entry.
  await page.getByRole('heading', { name: '从这一步，继续创作' }).waitFor();
  const topbar = page.locator('.workspace-topbar');
  const assistantToggle = topbar.locator('.workspace-assistant-toggle');
  assert.equal(await page.locator('button[aria-controls="canvas-creation-assistant"]').count(), 1);
  assert.equal(await assistantToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await assistantToggle.innerText().then(text => text.includes('蛙导')), true);
  await page.getByRole('complementary', { name: '画布创作助手' })
    .getByRole('button', { name: '收起创作助手', exact: true }).click();
  assert.equal(await assistantToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByRole('button', { name: '打开画布创作助手', exact: true }).count(), 0);
  assert.equal(await page.locator('.canvas-assistant-entry').count(), 0);
  await page.screenshot({ path: '/tmp/libtv-assistant-topbar-collapsed.png', fullPage: true });
  await assistantToggle.click();
  assert.equal(await assistantToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.getByText('最近对话保存在本机，节点和产物保存在项目中。', { exact: true }).count(), 0);
  await page.getByRole('region', { name: '当前创作建议' }).getByText('从一个想法开始', { exact: true }).waitFor();
  const desktopPanel = await page.getByRole('complementary', { name: '画布创作助手' }).boundingBox();
  assert.ok(desktopPanel.width >= 370 && desktopPanel.x + desktopPanel.width <= 1441);
  await page.screenshot({ path: '/tmp/libtv-assistant-welcome.png', fullPage: true });
  await page.getByRole('button', { name: '我下一步该做什么？' }).click();
  await page.getByText('建议先确定故事和角色，再准备镜头画面。', { exact: true }).waitFor();
  assert.equal(canvas.nodes.length, 0, 'advice must not create nodes');
  await page.getByRole('button', { name: '帮我创建故事和首帧图' }).click();
  await page.getByText(/已创建 2 个节点/).waitFor();
  assert.equal(canvas.nodes.length, 2);
  assert.equal(canvas.edges.length, 1);
  const image = canvas.nodes.find(n => n.type === 'image');
  assert.equal(image.data.mentions[0].nodeId, canvas.nodes.find(n => n.type === 'text').id);
  assert.equal(await page.locator('.assistant-content').getByRole('button', { name: '定位节点：山间首帧', exact: true }).count(), 1);
  assert.ok(!(await page.locator('.assistant-content').allTextContents()).join('').includes('new:image'));
  // Reproduce an old unsubmitted card: localStorage preserves the original
  // data order while JSONB returns object keys in a different order.
  await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('libtv:assistant:v1:')
    && JSON.parse(localStorage.getItem(key)).some(m => m.task)));
  const legacyBasis = JSON.stringify({
    nodes: canvas.nodes.map(n => ({ id: n.id, type: n.type, data: n.data })),
    edges: canvas.edges.map(e => ({ source: e.source, target: e.target })),
  });
  await page.evaluate(basis => {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith('libtv:assistant:v1:'))) {
      const messages = JSON.parse(localStorage.getItem(key));
      for (const entry of messages) if (entry.task && !entry.task.submitted) entry.task.basis = basis;
      localStorage.setItem(key, JSON.stringify(messages));
    }
  }, legacyBasis);
  const reorder = value => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().reverse().map(key => [key, reorder(value[key])])) : value;
  canvas = reorder(canvas);
  canvas.nodes = canvas.nodes.reverse().map(n => ({
    ...n, data: { ...n.data, stale: false, width: 1920, height: 1080, isEditing: false },
  }));
  const workspaceURL = process.env.QA_URL || 'http://127.0.0.1:3000/project/qa-project';
  await page.goto(new URL('/projects', workspaceURL).href);
  await page.getByRole('heading', { name: '我的项目' }).waitFor();
  await page.goto(workspaceURL);
  const restoredGenerate = page.getByRole('button', { name: '开始生成', exact: true });
  await restoredGenerate.waitFor();
  assert.ok(await restoredGenerate.isEnabled(), 'reopening an unsubmitted legacy card must remain executable');
  assert.equal(await page.getByRole('button', { name: '重新规划', exact: true }).count(), 0);
  assert.equal(executeCalls, 0, 'restoring a card must not auto-submit it');
  // A genuine prompt edit still invalidates the task, but now provides an
  // enabled replan action instead of an unreadable disabled generation button.
  await page.goto(new URL('/projects', workspaceURL).href);
  canvas.nodes = canvas.nodes.map(n => n.id === image.id
    ? { ...n, data: { ...n.data, prompt: '修改后的提示词：狐狸沿着山路向前走' } } : n);
  await page.goto(workspaceURL);
  const replanButton = page.getByRole('button', { name: '重新规划', exact: true });
  await replanButton.waitFor();
  assert.ok(await replanButton.isEnabled());
  assert.equal(await page.getByRole('button', { name: '开始生成', exact: true }).count(), 0);
  await replanButton.click();
  await page.getByText('已按当前提示词和参考素材准备新的生成任务。', { exact: true }).waitFor();
  assert.deepEqual(replannedIds, [image.id], 'replan must use the original task target, not unrelated selection');
  assert.equal(canvas.nodes.length, 2, 'replanning must reuse the existing nodes');
  assert.equal(executeCalls, 0, 'replanning does not start or charge generation');
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await page.getByText('已完成 1/1 个节点', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '给创作助手的指令' }).fill('检查这个节点');
  await page.getByRole('button', { name: '发送给创作助手' }).click();
  const inlineRefs = page.locator('.assistant-content').getByRole('button', { name: '定位节点：山间首帧', exact: true });
  await inlineRefs.nth(3).waitFor();
  await inlineRefs.last().click();
  await page.locator(`.react-flow__node[data-id="${image.id}"].selected`).waitFor();
  assert.ok(!(await page.locator('.assistant-content').allTextContents()).join('').includes(image.id));
  await page.getByRole('button', { name: /继续完善 山间首帧/ }).waitFor();
  assert.equal(executeCalls, 1);
  assert.ok(savedCalls >= 2);
  await page.screenshot({ path: '/tmp/libtv-assistant-generated.png', fullPage: true });
  await assistantToggle.click();
  assert.equal(await assistantToggle.getAttribute('aria-expanded'), 'false');
  await topbar.getByRole('button', { name: '打开创作助手', exact: true }).click();
  await page.getByText('已完成 1/1 个节点', { exact: true }).waitFor();
  // An edit while planning invalidates the response rather than applying a
  // second set of nodes to a changed canvas.
  delayed = true;
  await page.getByRole('textbox', { name: '给创作助手的指令' }).fill('再创建一组节点');
  await page.getByRole('button', { name: '发送给创作助手' }).click();
  await page.locator('button').filter({ has: page.locator('[aria-label="undo"]') }).click();
  await page.getByText('画布内容在等待期间发生了变化，本次操作未执行。请重新发送指令。', { exact: true }).waitFor();
  await page.setViewportSize({ width: 600, height: 850 });
  const mobilePanel = await page.getByRole('complementary', { name: '画布创作助手' }).boundingBox();
  assert.ok(mobilePanel.width <= 600 && mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 601);
  await page.screenshot({ path: '/tmp/libtv-assistant-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(workspaceURL);
  // Mobile starts collapsed. The only entry remains visible in the topbar
  // rather than being clipped offscreen by the canvas tools.
  assert.equal(await assistantToggle.getAttribute('aria-expanded'), 'false');
  const toggleBox = await assistantToggle.boundingBox();
  const topbarBox = await topbar.boundingBox();
  assert.ok(toggleBox.x >= 0 && toggleBox.x + toggleBox.width <= 390);
  assert.ok(toggleBox.y >= topbarBox.y && toggleBox.y + toggleBox.height <= topbarBox.y + topbarBox.height);
  assert.equal(await page.locator('button[aria-controls="canvas-creation-assistant"]').count(), 1);
  assert.ok(await topbar.getByRole('button', { name: '保存画布', exact: true }).isVisible());
  await assistantToggle.click();
  await page.getByRole('textbox', { name: '给创作助手的指令' }).waitFor();
  await page.screenshot({ path: '/tmp/libtv-assistant-topbar-mobile.png', fullPage: true });
  await assistantToggle.click();
  assert.equal(await assistantToggle.getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(new URL('/projects', process.env.QA_URL || 'http://127.0.0.1:3000').href);
  await page.getByRole('heading', { name: '我的项目' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '打开 AI 助手' }).count(), 0);
  assert.equal(await page.getByRole('complementary', { name: '画布创作助手' }).count(), 0);
  await page.goto(new URL('/', process.env.QA_URL || 'http://127.0.0.1:3000').href);
  await page.getByRole('button', { name: '返回首页' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '打开 AI 助手' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '打开画布创作助手' }).count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ ok: true, chatCalls, executeCalls, savedCalls, errors }));
} finally {
  await browser.close();
}
