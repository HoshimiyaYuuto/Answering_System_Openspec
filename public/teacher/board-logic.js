// 投影看板的純邏輯（add-projector-board design 第 3 節）：不碰 DOM 與網路，可用 node --test 驗證。
import { formatRemaining } from './console-logic.js';
import { ZH } from './messages.js';

const PREPARING = '準備中';
const BUZZING = '搶答中';
const ENDED = '已結束';

export const LOGIN_REQUIRED_MESSAGE = ZH('board.loginRequired');
export const NOT_REVEALED_TEXT = ZH('board.notRevealed');

// 每個資源同時只有一個請求；請求中收到的變動只累積成一次後續請求，舊序號的回應直接丟棄
function createResource(seq = 0) {
  return { data: null, seq, loading: false, dirty: false, wantsRequest: false };
}

function markChanged(resource) {
  return resource.loading ? { ...resource, dirty: true } : { ...resource, wantsRequest: true };
}

function requested(resource) {
  return { ...resource, seq: resource.seq + 1, loading: true, dirty: false, wantsRequest: false };
}

function loaded(resource, event, data) {
  if (event.seq !== resource.seq) return resource;
  return { ...resource, data, loading: false, wantsRequest: resource.dirty, dirty: false };
}

function failed(resource, event) {
  if (event.seq !== resource.seq) return resource;
  return { ...resource, loading: false, wantsRequest: resource.dirty, dirty: false };
}

export function createBoardState() {
  return { auth: 'checking', summary: null, presence: createResource(), results: createResource(), revealed: 0 };
}

function applySummary(state, summary) {
  const previous = state.summary?.phase;
  const phase = summary?.phase;
  let next = { ...state, summary };
  if (previous === ENDED && phase !== ENDED) {
    // 重設：丟掉結果與揭曉進度，序號往前推讓進行中的舊請求失效
    next = { ...next, results: createResource(state.results.seq + 1), revealed: 0 };
  }
  if (phase === ENDED && previous !== ENDED) {
    next = { ...next, results: markChanged(createResource(next.results.seq + 1)), revealed: 0 };
  }
  if ((phase === PREPARING || phase === BUZZING) && (previous !== phase || next.presence.data === null)) {
    next = { ...next, presence: markChanged(next.presence) };
  }
  return next;
}

export function reduceBoard(state, event) {
  switch (event.type) {
    case 'authChecked':
      return event.authenticated ? { ...state, auth: 'in' } : { ...createBoardState(), auth: 'out' };
    case 'authExpired':
      return { ...createBoardState(), auth: 'out' };
    case 'summaryLoaded':
      return applySummary(state, event.summary);
    case 'presenceChanged': {
      const phase = state.summary?.phase;
      if (phase !== PREPARING && phase !== BUZZING) return state;
      return { ...state, presence: markChanged(state.presence) };
    }
    case 'requestPresence':
      return { ...state, presence: requested(state.presence) };
    case 'presenceLoaded':
      return { ...state, presence: loaded(state.presence, event, event.groups) };
    case 'presenceFailed':
      return { ...state, presence: failed(state.presence, event) };
    case 'requestResults':
      return { ...state, results: requested(state.results) };
    case 'resultsLoaded':
      return { ...state, results: loaded(state.results, event, event.questions) };
    case 'resultsFailed':
      return { ...state, results: failed(state.results, event) };
    case 'revealNext': {
      const total = state.results.data?.length ?? 0;
      return { ...state, revealed: Math.min(state.revealed + 1, total) };
    }
    case 'revealAll':
      return { ...state, revealed: state.results.data?.length ?? 0 };
    default:
      return state;
  }
}

function resultText(question, t) {
  if (question.winner) {
    const answers = Array.isArray(question.winner.answers) ? question.winner.answers : [];
    const fair = question.winnerSource === 'fair' ? t('board.fair') : '';
    return t('board.winner', { group: question.winner.groupName, answers: answers.join(t('board.answerSeparator')), fair });
  }
  return question.settled === false ? t('board.judging') : t('board.noAnswer');
}

function groupsView(presence, t) {
  return (presence ?? []).map(({ name, online }) => ({
    name,
    online: online === true,
    statusText: online === true ? t('board.online') : t('board.offline'),
  }));
}

// 搶答中的檢視只含階段、倒數與在線，沒有任何作答相關欄位（D16）
export function getBoardView(state, serverNowMs, t = ZH) {
  if (state.auth === 'checking') return { view: 'checking', message: t('common.loading') };
  if (state.auth === 'out') return { view: 'login', message: t('board.loginRequired') };
  const phase = state.summary?.phase;
  if (!phase) return { view: 'board', phaseText: t('common.loading'), countdownText: '', groups: [], onlineText: '', results: null };

  if (phase === ENDED) {
    const questions = [...(state.results.data ?? [])].sort((left, right) => left.id - right.id);
    const total = questions.length;
    const loadedResults = state.results.data !== null;
    return {
      view: 'board',
      phaseText: t(`phase.${phase}`),
      countdownText: '',
      groups: [],
      onlineText: '',
      results: {
        loading: !loadedResults,
        rows: questions.map((question, index) => ({
          label: t('board.questionLabel', { id: question.id }),
          revealed: index < state.revealed,
          text: index < state.revealed ? resultText(question, t) : t('board.notRevealed'),
        })),
        revealedText: loadedResults ? t('board.revealed', { revealed: state.revealed, total }) : '',
        canRevealNext: loadedResults && state.revealed < total,
        canRevealAll: loadedResults && state.revealed < total,
      },
    };
  }

  const groups = groupsView(state.presence.data, t);
  const countdownText = phase === BUZZING && state.summary.countdownEndsAt
    ? formatRemaining(state.summary.countdownEndsAt, serverNowMs)
    : '';
  return {
    view: 'board',
    phaseText: t(`phase.${phase}`),
    countdownText,
    groups,
    onlineText: state.presence.data ? t('board.onlineCount', { online: groups.filter(({ online }) => online).length, total: groups.length }) : '',
    results: null,
  };
}
