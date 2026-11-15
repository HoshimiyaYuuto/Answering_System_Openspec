import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
import { createGroupsEntry, InvalidGroupsError } from './groups-entry.js';
import { createApplication } from './index.js';

function expectInvalidGroups(callback) {
  assert.throws(callback, (error) => error instanceof InvalidGroupsError && error.code === 'INVALID_GROUPS');
}

test('production application starts with no groups and reports groupCount zero', async () => {
  const app = createApplication({ environment: 'production' });
  const { server, url } = await startAppFromApplication(app);
  try {
    const response = await fetch(`${url}/api/session`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.groupCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function startAppFromApplication(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('group storage validates count limits, unique ids, and trimmed unique names', () => {
  const store = createGroupsEntry();
  expectInvalidGroups(() => store.replace([]));
  expectInvalidGroups(() => store.generate(0));
  expectInvalidGroups(() => store.generate(101));
  assert.equal(store.generate(1).length, 1);
  assert.equal(store.generate(100).length, 100);
  expectInvalidGroups(() => store.replace([{ id: 1, name: 'A' }, { id: 1, name: 'B' }]));
  expectInvalidGroups(() => store.replace([{ id: 101, name: 'A' }]));
  expectInvalidGroups(() => store.replace([{ id: 1, name: '   ' }]));
  expectInvalidGroups(() => store.replace([{ id: 1, name: 'x'.repeat(31) }]));
  expectInvalidGroups(() => store.replace([{ id: 1, name: ' A ' }, { id: 2, name: 'A' }]));
  assert.deepEqual(store.replace([{ id: 2, name: ' B ' }, { id: 1, name: 'A' }]), [
    { id: 1, name: 'A' }, { id: 2, name: 'B' },
  ]);
});

async function startApp(environment = 'test', host = '127.0.0.1') {
  const server = createApplication({ environment }).listen(0, host);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, url: `http://${host}:${server.address().port}` };
}

test('group API honors socket loopback, phase-before-content validation, and forwarded header spoofing', async () => {
  const { server, url } = await startApp('development');
  try {
    const seeded = await fetch(`${url}/api/groups`).then((response) => response.json());
    assert.equal(seeded.data.groups.length, 100);

    const replaced = await fetch(`${url}/api/groups`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups: [{ id: 9, name: '新組' }] }),
    });
    assert.equal(replaced.status, 200);
    assert.deepEqual((await replaced.json()).data.groups, [{ id: 9, name: '新組' }]);
    const summary = await fetch(`${url}/api/session`).then((response) => response.json());
    assert.equal(summary.data.groupCount, 1);

    const malformed = await fetch(`${url}/api/groups`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: [] }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_GROUPS');

    const phase = await fetch(`${url}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
    assert.equal(phase.status, 200);
    const rejected = await fetch(`${url}/api/groups`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: [] }),
    });
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).error.code, 'GROUP_CONFIG_NOT_ALLOWED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('production group storage starts empty; generated groups are returned through the API', async () => {
  const { server, url } = await startApp('production');
  try {
    assert.deepEqual((await fetch(`${url}/api/groups`).then((response) => response.json())).data.groups, []);
    const response = await fetch(`${url}/api/groups/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: 2 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.groups, [
      { id: 1, name: '第 1 組' }, { id: 2, name: '第 2 組' },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function findExternalIPv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

test('non-loopback socket is rejected even with a forged forwarded header', async (t) => {
  const externalAddress = findExternalIPv4();
  if (!externalAddress) {
    t.skip('沒有可用的非 loopback IPv4 網卡，略過此測試');
    return;
  }
  const { server } = await startApp('production', '0.0.0.0');
  try {
    const { port } = server.address();
    const request = (host, headers = {}) => fetch(`http://${host}:${port}/api/groups/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ count: 3 }),
    });

    const forged = await request(externalAddress, { 'x-forwarded-for': '127.0.0.1' });
    assert.equal(forged.status, 403);
    assert.equal((await forged.json()).error.code, 'LOOPBACK_ONLY');

    const local = await request('127.0.0.1');
    assert.equal(local.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('student entry supports anonymous first entry, shared groups, and restoration', async () => {
  const { server, url } = await startApp('production');
  try {
    await fetch(`${url}/api/groups/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: 2 }),
    });
    const enter = (studentId, groupId) => fetch(`${url}/api/student/entry`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId, groupId }),
    });
    const first = await enter('student-01', 1);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).data.group.id, 1);
    assert.equal((await enter('student-02', 1)).status, 200);
    const restored = await fetch(`${url}/api/student/entry?studentId=student-01`).then((response) => response.json());
    assert.deepEqual(restored.data, {
      valid: true, studentId: 'student-01', group: { id: 1, name: '第 1 組' }, phase: '準備中',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('student entry validates ids and group existence, and allows first entry during buzzer phase', async () => {
  const { server, url } = await startApp('development');
  try {
    const put = (studentId, groupId) => fetch(`${url}/api/student/entry`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId, groupId }),
    });
    assert.equal((await put('bad!', 1)).status, 400);
    const badGroup = await put('student-01', 999);
    assert.equal(badGroup.status, 404);
    assert.equal((await badGroup.json()).error.code, 'GROUP_NOT_FOUND');
    await fetch(`${url}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
    assert.equal((await put('student-01', 1)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('during buzzer phase changing groups is rejected but repeating the same group succeeds', async () => {
  const { server, url } = await startApp('development');
  try {
    const put = (groupId) => fetch(`${url}/api/student/entry`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: 'student-01', groupId }),
    });
    await put(1);
    await fetch(`${url}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
    const change = await put(2);
    assert.equal(change.status, 409);
    assert.equal((await change.json()).error.code, 'GROUP_CHANGE_NOT_ALLOWED');
    assert.equal((await put(1)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('removed group invalidates entries permanently until the student enters again', async () => {
  const { server, url } = await startApp('production');
  try {
    const putGroups = (groups) => fetch(`${url}/api/groups`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups }),
    });
    const enter = () => fetch(`${url}/api/student/entry`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: 'student-01', groupId: 1 }),
    });
    await putGroups([{ id: 1, name: '舊組名' }]);
    await enter();
    await putGroups([{ id: 2, name: '另一組' }]);
    await putGroups([{ id: 1, name: '新組名' }]);
    const removed = await fetch(`${url}/api/student/entry?studentId=student-01`).then((response) => response.json());
    assert.equal(removed.data.valid, false);
    assert.equal(removed.data.reason, 'group_removed');
    await enter();
    const restored = await fetch(`${url}/api/student/entry?studentId=student-01`).then((response) => response.json());
    assert.equal(restored.data.group.name, '新組名');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('unknown student entry lookup returns entry_reset', async () => {
  const { server, url } = await startApp('production');
  try {
    const response = await fetch(`${url}/api/student/entry?studentId=student-unknown`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
      valid: false, studentId: 'student-unknown', reason: 'entry_reset',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('student and teacher static entry points serve HTML and root redirects to student', async () => {
  const { server, url } = await startApp('production');
  try {
    const student = await fetch(`${url}/student/`);
    assert.equal(student.status, 200);
    assert.match(student.headers.get('content-type'), /text\/html/);
    assert.match(await student.text(), /<h1>學生端<\/h1>/);

    const teacher = await fetch(`${url}/teacher/`);
    assert.equal(teacher.status, 200);
    assert.match(teacher.headers.get('content-type'), /text\/html/);
    assert.match(await teacher.text(), /<h1>教師端<\/h1>/);

    const root = await fetch(url, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/student/');

    const unknownApi = await fetch(`${url}/api/not-a-route`);
    assert.equal(unknownApi.status, 404);
    assert.equal((await unknownApi.json()).error.code, 'NOT_FOUND');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
