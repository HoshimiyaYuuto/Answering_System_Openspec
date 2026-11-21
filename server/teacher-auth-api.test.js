import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from './index.js';

const TEST_PASSWORD = 'test-password';

async function startApp(options = {}, host = '127.0.0.1') {
  const server = createApplication({ environment: 'test', teacherPassword: TEST_PASSWORD, ...options }).listen(0, host);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

const close = (server) => new Promise((resolve) => server.close(resolve));

function login(url, password = TEST_PASSWORD) {
  return fetch(`${url}/api/teacher/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

function cookieFrom(response) {
  return response.headers.get('set-cookie').split(';')[0];
}

async function authStatus(url, cookie) {
  const response = await fetch(`${url}/api/teacher/auth`, { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

test('successful login sets an HttpOnly SameSite=Strict cookie and never echoes secrets', async () => {
  const { server, url } = await startApp();
  try {
    assert.deepEqual(await authStatus(url), { authenticated: false, passwordConfigured: true });
    const response = await login(url);
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /^teacher_session=[A-Za-z0-9_-]{43}; /);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; SameSite=Strict/);
    assert.match(setCookie, /; Path=\//);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { data: { authenticated: true } });
    const token = cookieFrom(response).split('=')[1];
    assert.doesNotMatch(text, new RegExp(`${TEST_PASSWORD}|${token}`));
    const status = await fetch(`${url}/api/teacher/auth`, { headers: { Cookie: cookieFrom(response) } }).then((r) => r.text());
    assert.doesNotMatch(status, new RegExp(`${TEST_PASSWORD}|${token}`));
    assert.deepEqual(JSON.parse(status).data, { authenticated: true, passwordConfigured: true });
  } finally {
    await close(server);
  }
});

test('wrong password, malformed request and missing configuration use the documented errors', async () => {
  const { server, url } = await startApp();
  try {
    const wrong = await login(url, 'wrong-password');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);
    const wrongText = await wrong.text();
    assert.deepEqual(JSON.parse(wrongText), { error: { code: 'WRONG_PASSWORD', message: '密碼錯誤。' } });
    assert.doesNotMatch(wrongText, new RegExp(TEST_PASSWORD));

    const malformed = await fetch(`${url}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 123 }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_LOGIN_REQUEST');

    const empty = await fetch(`${url}/api/teacher/login`, { method: 'POST' });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'INVALID_LOGIN_REQUEST');
  } finally {
    await close(server);
  }

  for (const teacherPassword of [undefined, '']) {
    const unset = await startApp({ teacherPassword });
    try {
      assert.deepEqual(await authStatus(unset.url), { authenticated: false, passwordConfigured: false });
      const response = await login(unset.url, '');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'TEACHER_PASSWORD_NOT_SET');
    } finally {
      await close(unset.server);
    }
  }
});

test('logout invalidates the cookie and a new app does not accept old cookies', async () => {
  const first = await startApp();
  let cookie;
  try {
    cookie = cookieFrom(await login(first.url));
    const logout = await fetch(`${first.url}/api/teacher/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /^teacher_session=; .*Max-Age=0/);
    assert.equal((await authStatus(first.url, cookie)).authenticated, false);
    cookie = cookieFrom(await login(first.url));
    assert.equal((await authStatus(first.url, cookie)).authenticated, true);
  } finally {
    await close(first.server);
  }
  const restarted = await startApp();
  try {
    assert.equal((await authStatus(restarted.url, cookie)).authenticated, false);
  } finally {
    await close(restarted.server);
  }
});

test('too many failures return 429 for that source', async () => {
  let time = 0;
  const { server, url } = await startApp({ now: () => time });
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await login(url, 'wrong')).status, 401);
    }
    const blocked = await login(url);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: { code: 'TOO_MANY_ATTEMPTS', message: '嘗試次數過多，請稍後再試。' } });
    time = 61_000;
    assert.equal((await login(url)).status, 200);
  } finally {
    await close(server);
  }
});

test('a blocked source does not block another source', async (t) => {
  let app;
  try {
    app = await startApp({ now: () => 0 }, '::');
  } catch {
    t.skip('無法以 IPv6 雙堆疊監聽，略過此測試');
    return;
  }
  const port = app.server.address().port;
  const ipv4 = `http://127.0.0.1:${port}`;
  const ipv6 = `http://[::1]:${port}`;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) await login(ipv4, 'wrong');
    assert.equal((await login(ipv4)).status, 429);
    let ipv6Response;
    try {
      ipv6Response = await login(ipv6);
    } catch {
      t.skip('無法連到 ::1，略過此測試');
      return;
    }
    assert.equal(ipv6Response.status, 200);
  } finally {
    await close(app.server);
  }
});
