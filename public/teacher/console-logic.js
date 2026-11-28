const PREPARING = '準備中';
const RUNNING = '搶答中';
const ENDED = '已結束';

export const AUTH_EXPIRED_MESSAGE = '登入已失效，請重新登入。';
const LOGIN_MESSAGES = {
  WRONG_PASSWORD: '密碼錯誤，請再試一次。',
  TOO_MANY_ATTEMPTS: '嘗試次數過多，請稍後再試。',
  INVALID_LOGIN_REQUEST: '請輸入密碼。',
};
const NO_RESPONSE_MESSAGE = '伺服器沒有回應，請稍後再試。';

export function createConsoleState() {
  return {
    view: 'checking',
    loginError: '',
    loggingIn: false,
    summary: null,
    action: null,
    confirmingEnd: false,
    confirmingReset: false,
    message: '',
  };
}

function toLogin(state, loginError) {
  return { ...createConsoleState(), view: 'login', loginError };
}

function withPhase(state, phase) {
  if (!state.summary || !phase) return state;
  return {
    ...state,
    summary: { ...state.summary, phase },
    confirmingEnd: phase === RUNNING ? state.confirmingEnd : false,
    confirmingReset: phase === ENDED ? state.confirmingReset : false,
  };
}

export function reduceConsole(state, event) {
  switch (event.type) {
    case 'authLoaded':
      if (!event.passwordConfigured) return { ...createConsoleState(), view: 'notConfigured' };
      if (event.authenticated) return { ...state, view: 'console', loginError: '' };
      return toLogin(state, '');
    case 'requestLogin':
      return { ...state, loggingIn: true, loginError: '' };
    case 'loginFailed':
      if (event.code === 'TEACHER_PASSWORD_NOT_SET') return { ...createConsoleState(), view: 'notConfigured' };
      return { ...state, loggingIn: false, loginError: LOGIN_MESSAGES[event.code] ?? event.message ?? NO_RESPONSE_MESSAGE };
    case 'loggedIn':
      return { ...state, view: 'console', loggingIn: false, loginError: '', message: '' };
    case 'summaryLoaded':
      return withPhase({ ...state, summary: event.summary }, event.summary?.phase);
    case 'phaseChanged':
      return withPhase(state, event.phase);
    case 'requestStart':
      return { ...state, action: 'starting', message: '' };
    case 'startDone':
      return withPhase({ ...state, action: null, message: '' }, event.phase);
    case 'startFailed':
      return { ...state, action: null, message: event.message };
    case 'requestEnd':
      return { ...state, confirmingEnd: true, message: '' };
    case 'cancelEnd':
      return { ...state, confirmingEnd: false };
    case 'confirmEnd':
      return { ...state, action: 'ending', confirmingEnd: false, message: '' };
    case 'endDone':
      return withPhase({ ...state, action: null, message: '' }, event.phase);
    case 'endFailed':
      if (event.code === 'INVALID_PHASE_TRANSITION' && event.phase === ENDED) {
        return withPhase({ ...state, action: null, message: '' }, ENDED);
      }
      return withPhase({ ...state, action: null, message: event.message }, event.phase);
    case 'requestReset':
      return { ...state, confirmingReset: true, message: '' };
    case 'cancelReset':
      return { ...state, confirmingReset: false };
    case 'confirmReset':
      return { ...state, action: 'resetting', confirmingReset: false, message: '' };
    case 'resetDone':
      return withPhase({ ...state, action: null, message: '' }, event.phase);
    case 'resetFailed':
      // 另一個分頁已經重設：視為成功，不顯示錯誤（design 第 6 節）
      if (event.code === 'INVALID_PHASE_TRANSITION' && event.phase === PREPARING) {
        return withPhase({ ...state, action: null, message: '' }, PREPARING);
      }
      return withPhase({ ...state, action: null, message: event.message }, event.phase);
    case 'authExpired':
      return toLogin(state, AUTH_EXPIRED_MESSAGE);
    case 'loggedOut':
      return toLogin(state, '');
    default:
      return state;
  }
}

export function isAuthExpired(code) {
  return code === 'TEACHER_AUTH_REQUIRED';
}

export function getConsoleControls(state) {
  const phase = state.summary?.phase;
  const idle = state.view === 'console' && state.action === null;
  return {
    canLogin: state.view === 'login' && !state.loggingIn,
    canStart: idle && phase === PREPARING,
    canEnd: idle && phase === RUNNING && !state.confirmingEnd,
    showEndConfirm: state.view === 'console' && state.confirmingEnd,
    canConfirmEnd: idle && phase === RUNNING && state.confirmingEnd,
    canReset: idle && phase === ENDED && !state.confirmingReset,
    showResetConfirm: state.view === 'console' && state.confirmingReset,
    canConfirmReset: idle && phase === ENDED && state.confirmingReset,
    canEditCountdown: idle && phase === PREPARING,
    canEditFairRanking: idle && phase === PREPARING,
    canLogout: state.view === 'console',
    canSetup: state.view === 'console' && phase === PREPARING,
  };
}

export function getSetupBlockedReason(phase) {
  if (!phase || phase === PREPARING) return '';
  return `目前階段為「${phase}」，只能在準備中設定組別與匯入學習單。`;
}

export function describeSummary(summary) {
  if (!summary) return { phase: '讀取中…', counts: '' };
  return { phase: summary.phase, counts: `${summary.groupCount} 組、${summary.questionCount} 題` };
}

// 活動狀態的「公平順位」列：準備中與尚未載入時隱藏（空字串），開始後顯示本場設定
export function describeFairRanking(summary) {
  if (!summary || summary.phase === PREPARING) return '';
  return summary.fairRankingEnabled === true ? '啟用' : '不啟用';
}

export function describeAction(state) {
  if (state.action === 'starting') return '開始搶答中…';
  if (state.action === 'ending') return '結束搶答中…';
  if (state.action === 'resetting') return '重設活動中…';
  return state.message;
}

export const COUNTDOWN_RANGE_MESSAGE = '倒數時間需介於 10 秒到 60 分鐘。';
const MIN_COUNTDOWN_SECONDS = 10;
const MAX_COUNTDOWN_SECONDS = 3600;

function toWholeNumber(value) {
  const text = String(value ?? '').trim();
  if (text === '') return 0;
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

// 倒數輸入換算成秒數；未勾選時不倒數（design 第 6 節）
export function parseCountdown({ enabled, minutes, seconds }) {
  if (!enabled) return { ok: true, countdownSeconds: null };
  const wholeMinutes = toWholeNumber(minutes);
  const wholeSeconds = toWholeNumber(seconds);
  if (wholeMinutes === null || wholeSeconds === null) return { ok: false, message: COUNTDOWN_RANGE_MESSAGE };
  const total = wholeMinutes * 60 + wholeSeconds;
  if (total < MIN_COUNTDOWN_SECONDS || total > MAX_COUNTDOWN_SECONDS) return { ok: false, message: COUNTDOWN_RANGE_MESSAGE };
  return { ok: true, countdownSeconds: total };
}

// 依 server 時間計算剩餘時間，無條件進位到秒、不小於 0，格式為 m:ss（design 第 2 節）
export function formatRemaining(countdownEndsAt, serverNowMs) {
  const endsAt = Date.parse(countdownEndsAt);
  if (!Number.isFinite(endsAt) || !Number.isFinite(serverNowMs)) return '';
  const remaining = Math.max(0, Math.ceil((endsAt - serverNowMs) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
