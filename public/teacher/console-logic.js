import { ZH, renderMessage } from './messages.js';

const PREPARING = '準備中';
const RUNNING = '搶答中';
const ENDED = '已結束';

export const AUTH_EXPIRED_MESSAGE = ZH('login.expired');
const LOGIN_CODES = new Set(['WRONG_PASSWORD', 'TOO_MANY_ATTEMPTS', 'INVALID_LOGIN_REQUEST']);

// 登入錯誤以描述保存，畫面時才依語言組字（add-teacher-language-switch design 第 2 節）；
// loginError 仍是繁中文字，供既有測試與舊呼叫使用
function loginErrorMessage(event) {
  if (LOGIN_CODES.has(event.code)) return { key: `login.${event.code}` };
  if (event.message) return event.message;
  return { key: 'login.noResponse' };
}

export function createConsoleState() {
  return {
    view: 'checking',
    loginError: '',
    loginErrorMessage: '',
    loggingIn: false,
    summary: null,
    action: null,
    confirmingEnd: false,
    confirmingReset: false,
    message: '',
  };
}

function toLogin(state, loginErrorMessage) {
  return { ...createConsoleState(), view: 'login', loginError: renderMessage(ZH, loginErrorMessage), loginErrorMessage };
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
      if (event.authenticated) return { ...state, view: 'console', loginError: '', loginErrorMessage: '' };
      return toLogin(state, '');
    case 'requestLogin':
      return { ...state, loggingIn: true, loginError: '', loginErrorMessage: '' };
    case 'loginFailed':
      if (event.code === 'TEACHER_PASSWORD_NOT_SET') return { ...createConsoleState(), view: 'notConfigured' };
    {
      const message = loginErrorMessage(event);
      return { ...state, loggingIn: false, loginError: renderMessage(ZH, message), loginErrorMessage: message };
    }
    case 'loggedIn':
      return { ...state, view: 'console', loggingIn: false, loginError: '', loginErrorMessage: '', message: '' };
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
      return toLogin(state, { key: 'login.expired' });
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

export function describeLoginError(state, t = ZH) {
  return renderMessage(t, state.loginErrorMessage || state.loginError);
}

export function getSetupBlockedReason(phase, t = ZH) {
  if (!phase || phase === PREPARING) return '';
  return t('session.setupBlocked', { phase: t(`phase.${phase}`) });
}

export function describeSummary(summary, t = ZH) {
  if (!summary) return { phase: t('common.loading'), counts: '' };
  return {
    phase: t(`phase.${summary.phase}`),
    counts: t('session.counts', { groups: summary.groupCount, questions: summary.questionCount }),
  };
}

// 活動狀態的「公平順位」列：準備中與尚未載入時隱藏（空字串），開始後顯示本場設定
export function describeFairRanking(summary, t = ZH) {
  if (!summary || summary.phase === PREPARING) return '';
  return summary.fairRankingEnabled === true ? t('session.fairEnabled') : t('session.fairDisabled');
}

// state.message 可以是字串或訊息描述（design 第 2 節）
export function describeAction(state, t = ZH) {
  if (state.action === 'starting') return t('session.starting');
  if (state.action === 'ending') return t('session.ending');
  if (state.action === 'resetting') return t('session.resetting');
  return renderMessage(t, state.message);
}

export const COUNTDOWN_RANGE_MESSAGE = ZH('session.countdownRange');
const MIN_COUNTDOWN_SECONDS = 10;
const MAX_COUNTDOWN_SECONDS = 3600;

function toWholeNumber(value) {
  const text = String(value ?? '').trim();
  if (text === '') return 0;
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

// 倒數輸入換算成秒數；未勾選時不倒數（design 第 6 節）
export function parseCountdown({ enabled, minutes, seconds }, t = ZH) {
  if (!enabled) return { ok: true, countdownSeconds: null };
  const wholeMinutes = toWholeNumber(minutes);
  const wholeSeconds = toWholeNumber(seconds);
  if (wholeMinutes === null || wholeSeconds === null) return { ok: false, message: t('session.countdownRange') };
  const total = wholeMinutes * 60 + wholeSeconds;
  if (total < MIN_COUNTDOWN_SECONDS || total > MAX_COUNTDOWN_SECONDS) return { ok: false, message: t('session.countdownRange') };
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
