import test from 'node:test';
import assert from 'node:assert/strict';
import { describeNodeError, extractUpstreamDetail } from '../src/utils/nodeErrorText.ts';

test('the reported copyright error maps to Chinese without losing its original message or request ID', () => {
  const message = 'The request failed because the output video may be related to copyright restrictions. Request id: 021794629477819';
  const legacy = `上游明确拒绝本次任务，自动退还本次扣费: 上游明确拒绝本次任务: 电信视频任务失败: ${message}（本次扣费已退还，可直接重新生成）`;
  const result = describeNodeError(legacy);
  assert.equal(result.title, '生成内容可能涉及版权限制');
  assert.equal(result.detail, message);
  assert.equal(result.raw, legacy);
  assert.equal(result.refund, 'refunded');
  assert.equal(describeNodeError(message).refund, null, 'raw error alone does not claim a refund');
});

test('specific error mappings take priority over generic parameter or content codes', () => {
  assert.equal(describeNodeError('InvalidParameter.WidthTooSmall: Width must be between 300px and 6000px.').kind, 'asset-too-small');
  assert.equal(describeNodeError('InputImageSensitiveContentDetected: image was rejected').kind, 'content-review');
  assert.equal(describeNodeError('InputImageSensitiveContentDetected.PrivacyInformation: may contain real person').kind, 'real-person');
  assert.equal(describeNodeError('InvalidParameter: expected at most 9 reference images but got 13 instead').hint, '模型最多接受 9 张参考图');
  assert.equal(describeNodeError('Throttling: limit reached').title, '请求过于频繁');
});

test('unknown messages and embedded code metadata remain available without invented advice', () => {
  const raw = 'FutureCode: upstream original Request id: future-request';
  const result = describeNodeError(raw);
  assert.equal(result.kind, 'unknown');
  assert.equal(result.title, raw);
  assert.equal(result.hint, undefined);
  const json = '{"error":{"code":"FutureCode","message":"original"},"request_id":"r-1"}';
  assert.equal(extractUpstreamDetail(json), json);
});
