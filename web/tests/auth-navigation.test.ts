import test from 'node:test';
import assert from 'node:assert/strict';
import { authPagePath, isAuthPath, safeAuthReturnPath } from '../src/utils/authNavigation.ts';

test('authentication links never carry a return redirect', () => {
  const original = '/project/example?view=story#shot-3';
  const url = new URL(authPagePath('login', original), 'https://manwa.test');
  assert.equal(url.pathname, '/login');
  assert.equal(url.searchParams.has('redirect'), false);
  assert.equal(new URL(authPagePath('register', '/admin/users'), url.origin).searchParams.has('redirect'), false);
});

test('authentication rejects external redirects, backslashes, control characters and redirect loops', () => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/\n/evil.test',
    '/login', '/register/?redirect=/login', '/reset-password?token=secret']) {
    assert.equal(safeAuthReturnPath(path), '/', path);
  }
  assert.equal(isAuthPath('/register/'), true);
  assert.equal(isAuthPath('/projects'), false);
});

test('switching auth pages retains referral and registration channel without nesting redirects', () => {
  const returnPath = '/?source=wasu&ref=1234567890abcdef';
  const login = new URL(authPagePath('login', returnPath), 'https://manwa.test');
  const register = new URL(authPagePath('register', '/', login.search), login.origin);
  assert.equal(register.pathname, '/register');
  assert.equal(register.searchParams.has('redirect'), false);
  assert.equal(register.searchParams.get('source'), 'wasu');
  assert.equal(register.searchParams.get('ref'), '1234567890ABCDEF');
  assert.equal(new URL(authPagePath('register', '/', '?ref=invalid'), login.origin).searchParams.has('ref'), false);
});
