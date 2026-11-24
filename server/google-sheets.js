// Google 試算表寫回：以服務帳號自行簽 JWT 換取存取權杖，再呼叫 values.batchUpdate。design 第 6 節。
// 金鑰、權杖與 Google 的原始錯誤內容都不會出現在回傳的錯誤訊息或 log。
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GuidedNotesExportError } from './guided-notes-export.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TIMEOUT_MS = 10_000;
const TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_MARGIN_MS = 60_000;
const FALLBACK = '也可以改用「下載 xlsx」。';

export function loadServiceAccount(path, { readFile = readFileSync, logger = console } = {}) {
  if (!path) return null;
  try {
    const key = JSON.parse(readFile(path, 'utf8'));
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string' || !key.client_email || !key.private_key) {
      throw new Error('missing fields');
    }
    return { clientEmail: key.client_email, privateKey: key.private_key };
  } catch {
    logger.error('Google 服務帳號金鑰檔無法讀取，寫回功能停用。');
    return null;
  }
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function createSignedJwt({ clientEmail, privateKey }, nowSeconds) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
  }));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

function quoteSheetName(sheetName) {
  return `'${sheetName.replaceAll("'", "''")}'`;
}

function errorFor(code, serviceAccountEmail) {
  const messages = {
    SHEET_AUTH_FAILED: ['Google 服務帳號認證失敗，請確認金鑰檔是否正確或已被停用。', 503],
    SHEET_API_DISABLED: ['服務帳號所屬的 Google Cloud 專案尚未啟用 Google Sheets API，請先啟用後再試。', 503],
    SHEET_NOT_EDITABLE: [`服務帳號沒有這份試算表的編輯權限，請把試算表共用給 ${serviceAccountEmail} 並設為「編輯者」。`, 422],
    SHEET_NOT_FOUND: ['找不到這份試算表，可能已被刪除或移動。', 422],
    SHEET_NOT_NATIVE: ['這份檔案在雲端上仍是 xlsx，無法直接寫回。請在 Google 雲端硬碟中「儲存為 Google 試算表」後重新匯入。', 422],
    SHEET_TAB_NOT_FOUND: ['線上試算表中找不到要寫入的工作表，可能已被改名或刪除。', 422],
    SHEET_UNAVAILABLE: ['暫時無法連線到 Google 試算表，請稍後再試。', 502],
  };
  const [message, status] = messages[code];
  return new GuidedNotesExportError(code, `${message}${FALLBACK}`, status);
}

async function readGoogleError(response) {
  try {
    const body = await response.json();
    const error = body?.error ?? {};
    const reasons = [
      ...(error.details ?? []).map((detail) => detail?.reason),
      ...(error.errors ?? []).map((item) => item?.reason),
    ].filter(Boolean);
    return { message: typeof error.message === 'string' ? error.message : '', reasons };
  } catch {
    return { message: '', reasons: [] };
  }
}

export function classifySheetsError(status, { message = '', reasons = [] } = {}) {
  if (status === 401) return 'SHEET_AUTH_FAILED';
  if (status === 403) {
    return reasons.some((reason) => reason === 'SERVICE_DISABLED' || reason === 'accessNotConfigured')
      ? 'SHEET_API_DISABLED'
      : 'SHEET_NOT_EDITABLE';
  }
  if (status === 404) return 'SHEET_NOT_FOUND';
  if (status === 400 && /not supported for this document/i.test(message)) return 'SHEET_NOT_NATIVE';
  if (status === 400 && /Unable to parse range/i.test(message)) return 'SHEET_TAB_NOT_FOUND';
  return 'SHEET_UNAVAILABLE';
}

export function createSheetsClient({ credentials, fetchImpl = fetch, now = () => Date.now(), timeoutMs = TIMEOUT_MS }) {
  const serviceAccountEmail = credentials.clientEmail;
  let cached = null;

  async function accessToken() {
    if (cached && now() < cached.expiresAt - REFRESH_MARGIN_MS) return cached.token;
    const nowMs = now();
    const assertion = createSignedJwt(credentials, Math.floor(nowMs / 1000));
    let response;
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw errorFor('SHEET_UNAVAILABLE', serviceAccountEmail);
    }
    if (response.status === 400 || response.status === 401) throw errorFor('SHEET_AUTH_FAILED', serviceAccountEmail);
    if (!response.ok) throw errorFor('SHEET_UNAVAILABLE', serviceAccountEmail);
    let body;
    try {
      body = await response.json();
    } catch {
      throw errorFor('SHEET_UNAVAILABLE', serviceAccountEmail);
    }
    if (typeof body?.access_token !== 'string') throw errorFor('SHEET_AUTH_FAILED', serviceAccountEmail);
    const lifetimeMs = (Number(body.expires_in) || TOKEN_LIFETIME_SECONDS) * 1000;
    cached = { token: body.access_token, expiresAt: nowMs + lifetimeMs };
    return cached.token;
  }

  async function batchUpdateValues(spreadsheetId, sheetName, writes) {
    const token = await accessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
    const body = {
      valueInputOption: 'RAW',
      data: writes.map(({ cell, value }) => ({ range: `${quoteSheetName(sheetName)}!${cell}`, values: [[value]] })),
    };
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw errorFor('SHEET_UNAVAILABLE', serviceAccountEmail);
    }
    if (!response.ok) {
      const code = classifySheetsError(response.status, await readGoogleError(response));
      if (code === 'SHEET_AUTH_FAILED') cached = null;
      throw errorFor(code, serviceAccountEmail);
    }
    const result = await response.json().catch(() => ({}));
    return { writtenCells: Number(result.totalUpdatedCells ?? 0) };
  }

  return { serviceAccountEmail, batchUpdateValues };
}
