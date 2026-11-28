// add-student-language-switch task 1.1：/shared 提供三個畫面共用的語言核心
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from './index.js';

test('the shared language module is served as JavaScript', async () => {
  const server = createApplication({ environment: 'test', teacherPassword: 'test-password' }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${url}/shared/i18n.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), /export function detectLanguage/);
    assert.equal((await fetch(`${url}/shared/missing.js`)).status, 404);
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
});
