import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
});
const base = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
const errors = [];
try {
  for (const channel of ['wasu', 'dianxin']) {
    for (const storedModel of ['', 'doubao-seedream-5.0-lite']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const user = { id: 'seedream-qa', email: 'qa@example.invalid', role: 'user', credits: 100, channel };
      const choices = channel === 'dianxin' ? [
        ['doubao-seedream-5.0-flash', 'Seedream 5.0 Flash'],
        ['doubao-seedream-5.5', 'Seedream 5.5'],
        ['doubao-seedream-5.0-pro', 'Seedream 5.0 Pro'],
      ] : [['doubao-seedream-5.0-lite', 'Seedream 5.0 Lite'], ['doubao-seedream-5.0-pro', 'Seedream 5.0 Pro']];
      const models = choices.map(([ID, Name], i) => ({ ID, Name, ModelID: ID, Provider: channel,
        Default: i === 0, Usage: ['image', 'character', 'scene', 'prop'],
        Resolutions: channel === 'dianxin' && ID !== 'doubao-seedream-5.0-pro' ? ['2K'] : ['2K', '4K'] }));
      let canvas = { nodes: [{ id: 'image-qa', type: 'image', position: { x: 150, y: 100 }, data: {
        type: 'image', label: '测试图片', prompt: '测试提示词', model: storedModel,
        modelProvider: channel, status: 'idle', resolution: '4K', aspectRatio: '16:9',
      } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const mutations = [];
      await context.route('**/api/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname.replace(/^\/api/, '');
        let data = {};
        if (request.method() !== 'GET' && !['/auth/refresh', '/projects/seedream-qa/canvas'].includes(path)) {
          mutations.push(path);
        }
        if (path === '/auth/refresh') data = { user,
          token: `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+900 })).toString('base64url')}.s` };
        else if (path === '/auth/me') data = user;
        else if (path === '/models') data = { image: models, video: [], llm: [], audio: [] };
        else if (path === '/channel/my') data = { channel };
        else if (path === '/pricing') data = { nodes: [] };
        else if (path === '/projects/seedream-qa') data = { id: 'seedream-qa', name: '模型检查' };
        else if (path.endsWith('/active-executions')) data = { executions: [] };
        else if (path.endsWith('/canvas')) {
          if (request.method() === 'PUT') canvas = request.postDataJSON();
          data = canvas;
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, msg: 'ok', data }) });
      });
      await page.goto(`${base}/project/seedream-qa`, { waitUntil: 'domcontentloaded' });
      await page.locator('.react-flow__node[data-id="image-qa"]').click();
      const flash = page.getByRole('button', { name: channel === 'dianxin' ? /Seedream 5.0 Flash/ : /Seedream 5.0 Lite/ });
      await flash.waitFor();
      assert.equal(await page.getByText('请重选模型', { exact: true }).count(), 0);
      if (channel === 'dianxin') assert.equal(await page.getByText('Seedream 5.0 Lite', { exact: true }).count(), 0);
      await flash.click();
      if (channel === 'wasu') assert.equal(await page.getByText('Seedream 5.5', { exact: true }).count(), 0);
      const next = channel === 'dianxin' ? 'Seedream 5.5' : 'Seedream 5.0 Pro';
      await page.getByText(next, { exact: true }).click();
      await page.getByRole('button', { name: new RegExp(next) }).waitFor();
      assert.equal(await page.getByText('请重选模型', { exact: true }).count(), 0);
      assert.deepEqual(mutations, [], 'model selection must not execute generation');
      await context.close();
      console.log(JSON.stringify({ channel, storedModel, electricModelsOnly: true, choicesWorking: true }));
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
