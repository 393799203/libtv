import test from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError } from 'axios';

// The HTTP client imports the browser auth store; no browser or network is needed here.
globalThis.window = { addEventListener() {} } as unknown as Window & typeof globalThis;
const { default: api } = await import('../src/services/api.ts');
const { bindAntdApp } = await import('../src/utils/antdApp.ts');
const notices: string[] = [];
bindAntdApp({
  message: { error: (text: string) => notices.push(text) } as never,
  modal: {} as never,
});

test('synchronous generation errors hide internal causes in toasts and rejected errors', async () => {
  const original = api.defaults.adapter;
  try {
    for (const code of ['model_not_activated', 'limit_burst_rate', 'TokenStatusExhausted']) {
      const raw = `${code}: private channel detail Request id: internal-request`;
      api.defaults.adapter = async config => ({
        config, headers: {}, status: 200, statusText: 'OK',
        data: { code: 500, msg: raw },
      });
      await assert.rejects(api.post('/images/generate'), { message: '服务暂不可用' });
      assert.equal(notices.pop(), '服务暂不可用');

      for (const status of [401, 500]) {
        let calls = 0;
        api.defaults.adapter = async config => {
          calls++;
          throw new AxiosError(raw, 'ERR_BAD_RESPONSE', config, undefined, {
            config, headers: {}, status, statusText: 'Error',
            data: { msg: raw, message: raw },
          });
        };
        await assert.rejects(api.post('/images/generate'), (error: unknown) => {
          assert.ok(error instanceof AxiosError);
          assert.equal(error.message, '服务暂不可用');
          assert.equal(error.response?.data.msg, '服务暂不可用');
          assert.equal(error.response?.data.message, '服务暂不可用');
          return true;
        });
        assert.equal(notices.pop(), '服务暂不可用');
        assert.equal(calls, 1, 'upstream token failure must not be treated as an expired customer login');
      }
    }
  } finally {
    api.defaults.adapter = original;
  }
});

test('admin diagnostics and unrelated client errors retain their original message', async () => {
  const original = api.defaults.adapter;
  try {
    for (const [url, raw] of [
      ['/admin/provider-tasks', 'TokenStatusExhausted: administrator detail'],
      ['/images/generate', 'FutureCode: original detail'],
    ]) {
      api.defaults.adapter = async config => ({
        config, headers: {}, status: 200, statusText: 'OK',
        data: { code: 500, msg: raw },
      });
      await assert.rejects(api.post(url), { message: raw });
      assert.equal(notices.pop(), raw);
    }
  } finally {
    api.defaults.adapter = original;
  }
});
