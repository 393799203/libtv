import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const errors = [];

async function caretAfter(editor, phrase) {
  await editor.evaluate((el, text) => {
    el.focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('.libtv-audio-tag')) continue;
      const index = node.textContent.indexOf(text);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index + text.length); range.collapse(true);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return;
    }
    throw new Error('caret text not found');
  }, phrase);
}

try {
  for (const [channel, storedModel] of [
    ['dianxin', 'minimax-speech-2.8-turbo'], ['dianxin', 'minimax-speech-2.8-hd'], ['wasu', 'qwen3-tts-instruct-flash'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const user = { id: 'speech-qa', email: 'qa@example.invalid', role: 'user', credits: 100, channel };
    const models = (channel === 'dianxin'
      ? [['minimax-speech-2.8-turbo', 'MiniMax Speech 2.8 Turbo'], ['minimax-speech-2.8-hd', 'MiniMax Speech 2.8 HD']]
      : [['qwen3-tts-instruct-flash', 'Qwen3 TTS Flash']])
      .map(([ID, Name], i) => ({ ID, Name, ModelID: ID, Provider: channel, Default: i === 0, Usage: ['audio'] }));
    let canvas = { nodes: [{ id: 'audio-qa', type: 'audio', position: { x: 150, y: 100 },
      data: { type: 'audio', label: '配音检查', model: storedModel, voice: 'default', modelProvider: channel,
        prompt: '第一句话。第二句话。\n第三句话。', status: 'idle', speed: 1 } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    let generated = 0;
    let submitted;
    await context.route('**/api/**', async route => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace(/^\/api/, '');
      let data = {};
      if (path === '/auth/refresh') data = { user,
        token: `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+900 })).toString('base64url')}.s` };
      else if (path === '/auth/me') data = user;
      else if (path === '/models') data = { audio: models, image: [], llm: [], video: [] };
      else if (path === '/channel/my') data = { channel };
      else if (path === '/pricing') data = { nodes: [{ node_type: 'audio', billing_type: 'per_char',
        models: models.map(model => ({ model_id: model.ID, price: 26 })) }] };
      else if (path === '/projects/speech-qa') data = { id: 'speech-qa', name: '配音检查' };
      else if (path.endsWith('/active-executions')) data = { executions: [] };
      else if (path.endsWith('/canvas')) {
        if (req.method() === 'PUT') canvas = req.postDataJSON();
        data = canvas;
      } else if (path.endsWith('/workflows/execute')) {
        generated++;
        submitted = structuredClone(canvas.nodes.find(node => node.id === 'audio-qa').data);
        data = { executionId: 77 };
      } else if (path.endsWith('/77/stream')) {
        await route.fulfill({ contentType: 'text/event-stream', body:
          `event: execution_completed\ndata: ${JSON.stringify({ type: 'execution_completed', data: {} })}\n\n` });
        return;
      } else if (path.endsWith('/workflows/77')) data = { status: 'done' };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, msg: 'ok', data }) });
    });
    await page.goto(`${base}/project/speech-qa`, { waitUntil: 'domcontentloaded' });
    await page.locator('.react-flow__node[data-id="audio-qa"]').click();
    const editor = page.getByRole('textbox', { name: '配音文本', exact: true });
    await editor.waitFor();
    if (channel === 'wasu') {
      assert.equal(await page.getByRole('toolbar', { name: '配音文本工具' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '情绪：自动', exact: true }).count(), 0);
      await page.getByRole('button', { name: /（）.*默认/ }).waitFor();
      await context.close();
      console.log(JSON.stringify({ channel, qwenUnchanged: true }));
      continue;
    }
    const tools = page.getByRole('toolbar', { name: '配音文本工具' });
    await tools.waitFor();
    await editor.fill('<#0.5#>开头');
    await page.getByRole('alert').filter({ hasText: '停顿需放在两段文本之间' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '生成', exact: true }).isDisabled(), true);
    assert.equal(generated, 0);
    await editor.fill('第一句话。第二句话。\n第三句话。');
    await caretAfter(editor, '第一句话。');
    await tools.getByRole('button', { name: '停顿', exact: true }).click();
    await page.getByRole('button', { name: '0.5 秒', exact: true }).click();
    await editor.getByText('停顿 0.5 秒', { exact: true }).waitFor();
    await caretAfter(editor, '第二句话。');
    await tools.getByRole('button', { name: '语气动作', exact: true }).click();
    await page.getByRole('group', { name: '语气动作' }).getByRole('button', { name: '轻笑', exact: true }).click();
    await editor.getByText('轻笑', { exact: true }).waitFor();
    const toolsBox = await tools.boundingBox();
    assert.ok(toolsBox.x >= 0 && toolsBox.x + toolsBox.width <= 1440, 'speech controls must fit the viewport');
    await tools.getByRole('button', { name: '分段', exact: true }).click();
    await page.getByRole('button', { name: '情绪：自动', exact: true }).click();
    await page.getByRole('button', { name: '喜悦', exact: true }).click();
    await page.getByRole('button', { name: '情绪：喜悦', exact: true }).waitFor();
    await page.getByRole('button', { name: /沉稳高管/ }).click();
    await page.getByRole('button', { name: '甜美女声', exact: true }).click();
    await page.getByRole('button', { name: '1x', exact: true }).click();
    await page.getByRole('button', { name: '1.25x', exact: true }).click();
    await page.getByRole('button', { name: '放大查看提示词', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '提示词框（放大查看）', exact: true });
    await dialog.getByRole('toolbar', { name: '配音文本工具' }).waitFor();
    await dialog.getByRole('textbox', { name: '配音文本' }).getByText('轻笑', { exact: true }).waitFor();
    await dialog.locator('.ant-modal-close').click();
    await dialog.waitFor({ state: 'hidden' });
    await editor.getByText('轻笑', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/libtv-${storedModel}.png`, fullPage: true });
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/workflows/execute')),
      page.getByRole('button', { name: '生成', exact: true }).click(),
    ]);
    assert.equal(generated, 1);
    assert.equal(submitted.model, storedModel);
    assert.equal(submitted.tone, 'happy');
    assert.equal(submitted.voice, 'Chinese (Mandarin)_Sweet_Lady');
    assert.equal(submitted.speed, 1.25);
    assert.ok(submitted.prompt.includes('第一句话。<#0.5#>第二句话。'), submitted.prompt);
    assert.ok(submitted.prompt.includes('(chuckle)'), submitted.prompt);
    assert.ok(submitted.prompt.includes('\n\n'), submitted.prompt);
    assert.equal(submitted.prompt.includes('停顿'), false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.react-flow__node[data-id="audio-qa"]').click();
    await page.getByRole('textbox', { name: '配音文本' }).getByText('轻笑', { exact: true }).waitFor();
    assert.equal(generated, 1, 'reloading must never generate speech');
    await context.close();
    console.log(JSON.stringify({ channel, model: storedModel, nativeTags: true, paragraphs: true,
      emotion: true, voice: true, speed: true, reload: true, mockGenerations: generated }));
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify({ errors, pages: await Promise.all(browser.contexts().flatMap(context => context.pages()).map(async page => ({
    url: page.url(), text: (await page.locator('body').innerText()).slice(-1800),
  }))) }));
  throw error;
} finally { await browser.close(); }
