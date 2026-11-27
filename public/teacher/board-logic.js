// 投影看板的純邏輯（add-projector-board design 第 3 節）：不碰 DOM 與網路，可用 node --test 驗證。
import { formatRemaining } from './console-logic.js';

const PREPARING = '準備中';
const BUZZING = '搶答中';
const ENDED = '已結束';

export const LOGIN_REQUIRED_MESSAGE = '請先在教師控制台登入';
export const NOT_REVEALED_TEXT = '尚未揭曉';

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

function resultText(question) {
  if (question.winner) {
    const answers = Array.isArray(question.winner.answers) ? question.winner.answers : [];
    const fair = question.winnerSource === 'fair' ? '（公平順位改判）' : '';
    return `${question.winner.groupName}「${answers.join('／')}」${fair}`;
  }
  return question.settled === false ? '判定中' : '無人作答';
}

function groupsView(presence) {
  return (presence ?? []).map(({ name, online }) => ({ name, online: online === true, statusText: online === true ? '在線' : '離線' }));
}

// 搶答中的檢視只含階段、倒數與在線，沒有任何作答相關欄位（D16）
export function getBoardView(state, serverNowMs) {
  if (state.auth === 'checking') return { view: 'checking', message: '讀取中…' };
  if (state.auth === 'out') return { view: 'login', message: LOGIN_REQUIRED_MESSAGE };
  const phase = state.summary?.phase;
  if (!phase) return { view: 'board', phaseText: '讀取中…', countdownText: '', groups: [], onlineText: '', results: null };

  if (phase === ENDED) {
    const questions = [...(state.results.data ?? [])].sort((left, right) => left.id - right.id);
    const total = questions.length;
    const loadedResults = state.results.data !== null;
    return {
      view: 'board',
      phaseText: phase,
      countdownText: '',
      groups: [],
      onlineText: '',
      results: {
        loading: !loadedResults,
        rows: questions.map((question, index) => ({
          label: `第 ${question.id} 題`,
          revealed: index < state.revealed,
          text: index < state.revealed ? resultText(question) : NOT_REVEALED_TEXT,
        })),
        revealedText: loadedResults ? `已揭曉 ${state.revealed}／${total} 題` : '',
        canRevealNext: loadedResults && state.revealed < total,
        canRevealAll: loadedResults && state.revealed < total,
      },
    };
  }

  const groups = groupsView(state.presence.data);
  const countdownText = phase === BUZZING && state.summary.countdownEndsAt
    ? formatRemaining(state.summary.countdownEndsAt, serverNowMs)
    : '';
  return {
    view: 'board',
    phaseText: phase,
    countdownText,
    groups,
    onlineText: state.presence.data ? `在線 ${groups.filter(({ online }) => online).length}／${groups.length} 組` : '',
    results: null,
  };
}
