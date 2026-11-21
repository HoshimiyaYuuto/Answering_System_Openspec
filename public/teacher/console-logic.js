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

export function describeAction(state) {
  if (state.action === 'starting') return '開始搶答中…';
  if (state.action === 'ending') return '結束搶答中…';
  return state.message;
}
