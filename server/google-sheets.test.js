import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { classifySheetsError, createSheetsClient, loadServiceAccount } from './google-sheets.js';
import { GuidedNotesExportError } from './guided-notes-export.js';

// 測試用金鑰即時產生，不使用任何真實金鑰
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = {
  clientEmail: 'writer@test-project.iam.gserviceaccount.com',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const silent = { error() {} };

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeGoogle({ tokenStatus = 200, sheetsStatus = 200, sheetsBody = { totalUpdatedCells: 2 } } = {}) {
  const calls = { token: [], sheets: [] };
  const fetchImpl = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      calls.token.push(options);
      return tokenStatus === 200
        ? jsonResponse(200, { access_token: `token-${calls.token.length}`, expires_in: 3600 })
        : jsonResponse(tokenStatus, { error: 'invalid_grant', error_description: 'google-secret-detail' });
    }
    calls.sheets.push({ url, options });
    return jsonResponse(sheetsStatus, sheetsBody);
  };
  return { fetchImpl, calls };
}

test('the JWT is RS256-signed with the expected claims', async () => {
  const { fetchImpl, calls } = fakeGoogle();
  const client = createSheetsClient({ credentials, fetchImpl, now: () => 1_800_000_000_000 });
  await client.batchUpdateValues('sheet-id', '學習單', [{ cell: 'H5', value: '甲' }]);
  const form = new URLSearchParams(calls.token[0].body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, claims, signature] = form.get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), {
    iss: credentials.clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  });
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url')));
});

test('the access token is cached and refreshed within 60 seconds of expiry', async () => {
  let clock = 1_800_000_000_000;
  const { fetchImpl, calls } = fakeGoogle();
  const client = createSheetsClient({ credentials, fetchImpl, now: () => clock });
  await client.batchUpdateValues('sheet-id', '學習單', [{ cell: 'H5', value: '甲' }]);
  await client.batchUpdateValues('sheet-id', '學習單', [{ cell: 'H5', value: '甲' }]);
  assert.equal(calls.token.length, 1);
  clock += 3600_000 - 59_000;
  await client.batchUpdateValues('sheet-id', '學習單', [{ cell: 'H5', value: '甲' }]);
  assert.equal(calls.token.length, 2);
  assert.equal(calls.sheets[2].options.headers.Authorization, 'Bearer token-2');
});

test('values are written RAW with a quoted and escaped sheet name', async () => {
  const { fetchImpl, calls } = fakeGoogle({ sheetsBody: { totalUpdatedCells: 2 } });
  const client = createSheetsClient({ credentials, fetchImpl });
  const result = await client.batchUpdateValues('abc_123-XYZ', '學習單', [{ cell: 'H5', value: '甲' }, { cell: 'H6', value: '=1+1' }]);
  assert.deepEqual(result, { writtenCells: 2 });
  assert.equal(calls.sheets[0].url, 'https://sheets.googleapis.com/v4/spreadsheets/abc_123-XYZ/values:batchUpdate');
  assert.deepEqual(JSON.parse(calls.sheets[0].options.body), {
    valueInputOption: 'RAW',
    data: [
      { range: "'學習單'!H5", values: [['甲']] },
      { range: "'學習單'!H6", values: [['=1+1']] },
    ],
  });
  await client.batchUpdateValues('id', "老師's 表", [{ cell: 'G5', value: 'x' }]);
  assert.equal(JSON.parse(calls.sheets[1].options.body).data[0].range, "'老師''s 表'!G5");
});

async function failureOf(options) {
  const { fetchImpl } = fakeGoogle(options);
  const client = createSheetsClient({ credentials, fetchImpl });
  try {
    await client.batchUpdateValues('sheet-id', '學習單', [{ cell: 'H5', value: '甲' }]);
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

const googleError = (status, message, reason) => ({ error: { code: status, message, status: 'X', details: reason ? [{ reason }] : [] } });

for (const [name, options, code, status] of [
  ['token 400', { tokenStatus: 400 }, 'SHEET_AUTH_FAILED', 503],
  ['token 401', { tokenStatus: 401 }, 'SHEET_AUTH_FAILED', 503],
  ['sheets 401', { sheetsStatus: 401, sheetsBody: googleError(401, 'google-secret-detail') }, 'SHEET_AUTH_FAILED', 503],
  ['403 service disabled', { sheetsStatus: 403, sheetsBody: googleError(403, 'google-secret-detail', 'SERVICE_DISABLED') }, 'SHEET_API_DISABLED', 503],
  ['403 access not configured', { sheetsStatus: 403, sheetsBody: { error: { code: 403, message: 'x', errors: [{ reason: 'accessNotConfigured' }] } } }, 'SHEET_API_DISABLED', 503],
  ['other 403', { sheetsStatus: 403, sheetsBody: googleError(403, 'The caller does not have permission') }, 'SHEET_NOT_EDITABLE', 422],
  ['404', { sheetsStatus: 404, sheetsBody: googleError(404, 'Requested entity was not found.') }, 'SHEET_NOT_FOUND', 422],
  ['400 not native', { sheetsStatus: 400, sheetsBody: googleError(400, 'This operation is not supported for this document') }, 'SHEET_NOT_NATIVE', 422],
  ['400 bad range', { sheetsStatus: 400, sheetsBody: googleError(400, "Unable to parse range: '學習單'!H5") }, 'SHEET_TAB_NOT_FOUND', 422],
  ['429', { sheetsStatus: 429, sheetsBody: googleError(429, 'quota') }, 'SHEET_UNAVAILABLE', 502],
  ['500', { sheetsStatus: 500, sheetsBody: googleError(500, 'backend') }, 'SHEET_UNAVAILABLE', 502],
  ['other 400', { sheetsStatus: 400, sheetsBody: googleError(400, 'Invalid value') }, 'SHEET_UNAVAILABLE', 502],
]) {
  test(`Google failure "${name}" maps to ${code}`, async () => {
    const error = await failureOf(options);
    assert.ok(error instanceof GuidedNotesExportError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.match(error.message, /下載 xlsx/);
    assert.doesNotMatch(error.message, /google-secret-detail|token-|PRIVATE KEY|caller does not have|Unable to parse/);
    if (code === 'SHEET_NOT_EDITABLE') assert.match(error.message, /writer@test-project\.iam\.gserviceaccount\.com/);
  });
}

test('network errors and timeouts map to SHEET_UNAVAILABLE', async () => {
  const client = createSheetsClient({ credentials, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(client.batchUpdateValues('id', '學習單', []), (error) => error.code === 'SHEET_UNAVAILABLE' && error.status === 502);
  const slow = createSheetsClient({
    credentials,
    timeoutMs: 20,
    fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  });
  await assert.rejects(slow.batchUpdateValues('id', '學習單', []), (error) => error.code === 'SHEET_UNAVAILABLE');
});

test('classification relies on status and reason, not on the message alone', () => {
  assert.equal(classifySheetsError(403, { message: 'not supported for this document' }), 'SHEET_NOT_EDITABLE');
  assert.equal(classifySheetsError(503), 'SHEET_UNAVAILABLE');
});

test('loadServiceAccount reads a key file and returns null for missing or incomplete files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sheets-key-'));
  try {
    const good = path.join(directory, 'good.json');
    await writeFile(good, JSON.stringify({ client_email: credentials.clientEmail, private_key: credentials.privateKey }));
    assert.deepEqual(loadServiceAccount(good, { logger: silent }), credentials);

    const lines = [];
    const logger = { error: (line) => lines.push(line) };
    const missingField = path.join(directory, 'missing.json');
    await writeFile(missingField, JSON.stringify({ client_email: credentials.clientEmail }));
    assert.equal(loadServiceAccount(missingField, { logger }), null);
    assert.equal(loadServiceAccount(path.join(directory, 'absent.json'), { logger }), null);
    const broken = path.join(directory, 'broken.json');
    await writeFile(broken, '{not json');
    assert.equal(loadServiceAccount(broken, { logger }), null);
    assert.equal(lines.length, 3);
    for (const line of lines) assert.equal(line, 'Google 服務帳號金鑰檔無法讀取，寫回功能停用。');
    assert.equal(loadServiceAccount(undefined, { logger }), null);
    assert.equal(lines.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the client exposes the service account email but not the key', () => {
  const client = createSheetsClient({ credentials, fetchImpl: fakeGoogle().fetchImpl });
  assert.equal(client.serviceAccountEmail, credentials.clientEmail);
  assert.doesNotMatch(JSON.stringify(client), /PRIVATE KEY/);
});
