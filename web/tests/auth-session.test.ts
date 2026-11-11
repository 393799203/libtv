import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenExpiresAt, validNewPassword } from '../src/utils/authSession.ts';

test('access expiry parsing rejects malformed and nonnumeric claims', () => {
  const token = (payload: object) => `header.${btoa(JSON.stringify(payload))}.signature`;
  assert.equal(tokenExpiresAt(token({ exp: 1234 })), 1234000);
  for (const value of ['', 'broken', token({}), token({ exp: '1234' })]) {
    assert.equal(tokenExpiresAt(value), null);
  }
});

test('new passwords match server character and bcrypt byte limits', () => {
  assert.equal(validNewPassword('1234567'), false);
  assert.equal(validNewPassword('12345678'), true);
  assert.equal(validNewPassword('中'.repeat(24)), true);
  assert.equal(validNewPassword('中'.repeat(25)), false);
  assert.equal(validNewPassword('🔐'.repeat(7)), false);
  assert.equal(validNewPassword('🔐'.repeat(8)), true);
});
