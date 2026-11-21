import assert from 'node:assert/strict';
import test from 'node:test';
import { createTeacherAuth, LOGIN_WINDOW_MS, MAX_FAILED_LOGINS } from './teacher-auth.js';

const PASSWORD = 'test-password';

function codeOf(action) {
  try {
    action();
  } catch (error) {
    return { code: error.code, status: error.status };
  }
  return null;
}

test('correct password returns a token that is valid until logout', () => {
  const auth = createTeacherAuth({ password: PASSWORD });
  assert.equal(auth.isConfigured(), true);
  const { token } = auth.login(PASSWORD, '127.0.0.1');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(auth.isValid(token), true);
  auth.logout(token);
  assert.equal(auth.isValid(token), false);
});

test('each login creates a different token', () => {
  const auth = createTeacherAuth({ password: PASSWORD });
  const first = auth.login(PASSWORD, 'a').token;
  const second = auth.login(PASSWORD, 'a').token;
  assert.notEqual(first, second);
  auth.logout(first);
  assert.equal(auth.isValid(second), true);
});

test('wrong password is rejected and creates no login', () => {
  const auth = createTeacherAuth({ password: PASSWORD });
  assert.deepEqual(codeOf(() => auth.login('test-passwor', 'a')), { code: 'WRONG_PASSWORD', status: 401 });
  assert.deepEqual(codeOf(() => auth.login(`${PASSWORD}x`, 'a')), { code: 'WRONG_PASSWORD', status: 401 });
  assert.deepEqual(codeOf(() => auth.login('', 'a')), { code: 'WRONG_PASSWORD', status: 401 });
});

test('missing or empty password configuration refuses every login', () => {
  for (const password of [undefined, '']) {
    const auth = createTeacherAuth({ password });
    assert.equal(auth.isConfigured(), false);
    assert.deepEqual(codeOf(() => auth.login('anything', 'a')), { code: 'TEACHER_PASSWORD_NOT_SET', status: 503 });
    assert.deepEqual(codeOf(() => auth.login('', 'a')), { code: 'TEACHER_PASSWORD_NOT_SET', status: 503 });
  }
});

test('non-string password input is an invalid request', () => {
  const auth = createTeacherAuth({ password: PASSWORD });
  for (const input of [undefined, null, 123, ['test-password'], { password: PASSWORD }]) {
    assert.deepEqual(codeOf(() => auth.login(input, 'a')), { code: 'INVALID_LOGIN_REQUEST', status: 400 });
  }
});

test('ten failures within a minute block the source, even with the correct password', () => {
  let time = 1_000_000;
  const auth = createTeacherAuth({ password: PASSWORD, now: () => time });
  for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt += 1) {
    assert.equal(codeOf(() => auth.login('wrong', 'blocked')).code, 'WRONG_PASSWORD');
    time += 1_000;
  }
  assert.deepEqual(codeOf(() => auth.login(PASSWORD, 'blocked')), { code: 'TOO_MANY_ATTEMPTS', status: 429 });
  assert.equal(codeOf(() => auth.login(PASSWORD, 'other')), null);
});

test('the block lifts once the oldest failure leaves the window', () => {
  let time = 0;
  const auth = createTeacherAuth({ password: PASSWORD, now: () => time });
  for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt += 1) {
    codeOf(() => auth.login('wrong', 'source'));
    time += 1_000;
  }
  time = LOGIN_WINDOW_MS - 1;
  assert.equal(codeOf(() => auth.login(PASSWORD, 'source')).code, 'TOO_MANY_ATTEMPTS');
  time = LOGIN_WINDOW_MS + 1;
  assert.equal(codeOf(() => auth.login(PASSWORD, 'source')), null);
});

test('nine failures still allow a correct login', () => {
  const auth = createTeacherAuth({ password: PASSWORD, now: () => 0 });
  for (let attempt = 0; attempt < MAX_FAILED_LOGINS - 1; attempt += 1) codeOf(() => auth.login('wrong', 's'));
  assert.equal(codeOf(() => auth.login(PASSWORD, 's')), null);
});

test('tokens are not shared between auth instances', () => {
  const first = createTeacherAuth({ password: PASSWORD });
  const second = createTeacherAuth({ password: PASSWORD });
  const { token } = first.login(PASSWORD, 'a');
  assert.equal(second.isValid(token), false);
  assert.equal(first.isValid(undefined), false);
  assert.equal(first.isValid(''), false);
});
