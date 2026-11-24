// guided-notes-export-api.test.js 與 guided-notes-writeback-api.test.js 共用的測試 app。檔名刻意不含 test，避免被 node --test 當成測試檔。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApplication } from './index.js';

const PASSWORD = 'test-password';
const fixture = (name) => readFile(new URL(`../fixtures/guided-notes/${name}`, import.meta.url));
const sheetLink = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit';

export async function startApp(options = {}) {
  const server = createApplication({
    environment: 'production',
    teacherPassword: PASSWORD,
    sheetsClient: null,
    logger: { log() {}, error() {} },
    ...options,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${url}/api/teacher/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const teacher = (path, init = {}) => fetch(`${url}${path}`, { ...init, headers: { ...init.headers, cookie } });
  const json = (path, body, method = 'POST') => teacher(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    server,
    url,
    teacher,
    async importFile(name) {
      const preview = await teacher('/api/teacher/guided-notes/preview/file', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) },
        body: await fixture(name),
      });
      const { data } = await preview.json();
      assert.equal((await json('/api/teacher/guided-notes/confirm', { previewId: data.previewId })).status, 200);
    },
    async importLink() {
      const preview = await json('/api/teacher/guided-notes/preview/link', { url: sheetLink });
      const { data } = await preview.json();
      assert.equal((await json('/api/teacher/guided-notes/confirm', { previewId: data.previewId })).status, 200);
    },
    async runSession(submissions = []) {
      await json('/api/groups/generate', { count: 2 });
      for (const [studentId, groupId] of [['stu-aaaa1111', 1], ['stu-bbbb2222', 2]]) {
        await fetch(`${url}/api/student/entry`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId, groupId }) });
      }
      assert.equal((await teacher('/api/session/start', { method: 'POST' })).status, 200);
      for (const [studentId, questionId, answers] of submissions) {
        const response = await fetch(`${url}/api/student/submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId, questionId, answers }) });
        assert.equal(response.status, 200, JSON.stringify(await response.json()));
      }
      assert.equal((await teacher('/api/session/end', { method: 'POST' })).status, 200);
    },
    summary: async () => (await (await fetch(`${url}/api/session`)).json()).data,
  };
}

export const close = (server) => new Promise((resolve) => server.close(resolve));

