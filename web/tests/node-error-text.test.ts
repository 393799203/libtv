import test from 'node:test';
import assert from 'node:assert/strict';
import { customerErrorText, describeNodeError, extractUpstreamDetail } from '../src/utils/nodeErrorText.ts';

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

test('historical provider codes take priority over their generic HTTP status', () => {
  const samples = [
    ['LLM API error (status=403): {"error":{"message":"模型未开通，请联系管理员","code":"model_not_activated"}}', 'model-not-activated', '当前模型未开通'],
    ['LLM API error (status=429): {"error":{"message":"Request rate increased too quickly.","code":"limit_burst_rate"}}', 'burst-rate-limit', '请求增长过快，触发上游限流'],
    ['Image API error (status=401): {"error":{"message":"该令牌额度已用尽 TokenStatusExhausted (request id: history-request)","code":""}}', 'upstream-quota-exhausted', '上游渠道额度已用尽'],
  ];
  for (const [raw, kind, title] of samples) {
    const result = describeNodeError(raw, { audience: 'admin' });
    assert.equal(result.kind, kind);
    assert.equal(result.title, title);
    assert.equal(result.hint, undefined);
    assert.equal(result.raw, raw);
    assert.equal(result.detail, raw);
    assert.equal(result.refund, null);
  }
  assert.equal(describeNodeError('积分不足，请先充值').kind, 'insufficient-credits');
});

test('customers never see the three internal channel failures, including tooltip details and toast text', () => {
  for (const code of ['model_not_activated', 'limit_burst_rate', 'TokenStatusExhausted']) {
    const raw = `上游明确拒绝本次任务: ${code}: private upstream detail Request id: internal-request（本次扣费已退还，可直接重新生成）`;
    const result = describeNodeError(raw);
    assert.equal(result.title, '服务暂不可用');
    assert.equal(result.hint, undefined);
    assert.equal(result.detail, '');
    assert.equal(result.hideDetails, true);
    assert.equal(result.refund, 'refunded');
    assert.equal(customerErrorText(raw), '服务暂不可用');
    const admin = describeNodeError(raw, { audience: 'admin' });
    assert.equal(admin.raw, raw);
    assert.match(admin.detail, /private upstream detail Request id: internal-request/);
    assert.notEqual(admin.hideDetails, true);
    assert.notEqual(admin.title, '服务暂不可用');
  }
  assert.equal(customerErrorText('该令牌额度已用尽'), '服务暂不可用');
  assert.equal(customerErrorText('FutureCode: unknown upstream error'), 'FutureCode: unknown upstream error');
  assert.equal(describeNodeError('Throttling: request limit reached').title, '请求过于频繁');
});

test('historical messages remain recognizable when their code was missing or truncated', () => {
  const truncated = 'Image API error (status=400): {"error":{"message":"The request failed because the output image may contain sensitive information. Request id: historical…';
  assert.equal(describeNodeError(truncated).kind, 'content-review');
  assert.equal(describeNodeError(truncated).detail, truncated);
  const height = 'InvalidParameter.HeightTooSmall: 创建上游素材失败: Height must be between 300px and 6000px., request_id:height-request';
  assert.equal(describeNodeError(height).kind, 'asset-too-small');
  assert.equal(describeNodeError(height).detail, height);
  assert.equal(describeNodeError('请求参数不符合要求，请检查素材、时长和生成参数。 \\').kind, 'invalid-parameter');
});

test('historical duration limits come from the actual error instead of a fixed 15 seconds', () => {
  const raw = '参考视频时长(30.0秒) + 生成时长(5秒) = 35.0秒，超过 wan3.0-video 模型的30秒限制。请缩短参考视频或生成时长后重试';
  assert.equal(describeNodeError(raw).kind, 'duration-over-limit');
  assert.equal(describeNodeError(raw).hint, '模型的总时长上限为 30 秒');
  assert.equal(describeNodeError('video total duration must be less than or equal to 15.2 seconds').hint, '模型的总时长上限为 15.2 秒');
  assert.equal(describeNodeError('video total duration exceeds limit').hint, undefined);
});

test('historical local validation and model output errors retain their specific meaning', () => {
  const samples = [
    ['首尾帧模式需要 1–2 张图片，请明确选择首帧和尾帧后重试', 'frame-input'],
    ['您已连接上游剧本节点，但未在提示词中通过@引用使用剧本内容，请点击上游输入栏插入@引用', 'script-reference-missing'],
    ['请求参数不符合要求。seedance2.5 首帧/首尾帧任务仅支持 ratio=adaptive，当前 \\', 'frame-aspect-ratio'],
    ['The parameter ratio specified in the request is not valid. For first-frame or first-last-frame generation the output ratio follows the first-frame image.', 'frame-aspect-ratio'],
    ['模型输出的 JSON 格式有误（json: cannot unmarshal number 3.5 into Go struct field ScriptShot.shots.duration of type int）', 'invalid-model-output'],
    ['分镜模型已返回 HTTP 200，但输出不是合法 JSON，解析失败', 'invalid-model-output'],
    ['模型未返回分镜镜头，请重试或选择其他文本模型', 'empty-shots'],
    ['元素编辑：这张图的格式无法处理（仅支持 PNG/JPEG）；WebP/HEIC 等格式请先转成 PNG/JPEG 再编辑', 'unsupported-image-format'],
    ['图片读取失败（未调用上游），已退还本次扣费', 'image-read-failed'],
    ['cannot establish verified TLS connection: dial tcp: connect: network is unreachable', 'upstream-network'],
  ];
  for (const [message, kind] of samples) {
    const raw = `不需要重试: level 0 failed: [${message}]`;
    const result = describeNodeError(raw);
    assert.equal(result.kind, kind);
    assert.equal(result.raw, raw);
    assert.equal(result.detail, raw);
    assert.equal(result.hint, undefined);
  }
  const unrelated = 'tls: failed to verify certificate: x509: certificate has expired';
  assert.equal(describeNodeError(unrelated).kind, 'unknown', 'do not mislabel every TLS failure as a network routing error');
  assert.equal(describeNodeError('FutureProviderError: new code').kind, 'unknown');
});
