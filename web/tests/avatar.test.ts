import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarRequestSrc, getUserAvatarSrc } from '../src/utils/avatar.ts';

test('avatar fallback is local and safely includes the first display character', () => {
  for (const name of ['创作者', '🔐用户', '<script>', '']) {
    const source = getUserAvatarSrc({ nickname: name });
    assert.ok(source.startsWith('data:image/svg+xml,'));
    const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1));
    assert.ok(!svg.includes('<script>'));
  }
});

test('owned avatars can retry through the media proxy without changing external signatures', () => {
  const owned = 'https://manwa.huadong-1.ctyunzos.cn/users/test/avatar/photo.png?signature=original';
  assert.equal(avatarRequestSrc(owned, 0, 'test'), owned);
  assert.equal(avatarRequestSrc(owned, 1, 'test'), '/media/users/test/avatar/photo.png?_avatar_retry=test-1');
  for (const source of ['https://outside.test/photo.png?signature=a%2Bb', '/uploads/photo.png',
    'data:image/svg+xml,test', 'blob:https://example.test/id']) {
    assert.equal(avatarRequestSrc(source, 2, 'test'), source);
  }
  assert.equal(avatarRequestSrc('/media/users/photo.png?v=1', 2, 'test'),
    '/media/users/photo.png?v=1&_avatar_retry=test-2');
});
