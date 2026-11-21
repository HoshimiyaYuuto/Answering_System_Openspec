import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const LOGIN_WINDOW_MS = 60_000;
export const MAX_FAILED_LOGINS = 10;

export class TeacherAuthError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest();
}

export function createTeacherAuth({ password, now = () => Date.now() } = {}) {
  const configured = typeof password === 'string' && password.length > 0;
  const expected = configured ? digest(password) : null;
  const tokens = new Set();
  const failures = new Map();

  function recentFailures(source) {
    const cutoff = now() - LOGIN_WINDOW_MS;
    const kept = (failures.get(source) ?? []).filter((time) => time > cutoff);
    if (kept.length) failures.set(source, kept);
    else failures.delete(source);
    return kept;
  }

  function login(input, source = '') {
    if (!configured) {
      throw new TeacherAuthError('TEACHER_PASSWORD_NOT_SET', '尚未設定老師密碼，請先設定 TEACHER_PASSWORD 並重新啟動 server。', 503);
    }
    if (typeof input !== 'string') {
      throw new TeacherAuthError('INVALID_LOGIN_REQUEST', '請輸入密碼。', 400);
    }
    if (recentFailures(source).length >= MAX_FAILED_LOGINS) {
      throw new TeacherAuthError('TOO_MANY_ATTEMPTS', '嘗試次數過多，請稍後再試。', 429);
    }
    if (!timingSafeEqual(digest(input), expected)) {
      failures.set(source, [...recentFailures(source), now()]);
      throw new TeacherAuthError('WRONG_PASSWORD', '密碼錯誤。', 401);
    }
    const token = randomBytes(32).toString('base64url');
    tokens.add(token);
    return { token };
  }

  return {
    isConfigured: () => configured,
    login,
    isValid: (token) => typeof token === 'string' && tokens.has(token),
    logout: (token) => {
      tokens.delete(token);
    },
  };
}
