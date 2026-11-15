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
