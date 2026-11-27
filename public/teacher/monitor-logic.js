const PREPARING = '準備中';
const BUZZING = '搶答中';
const ENDED = '已結束';

export function createMonitorState() {
  return { data: null, requestSeq: 0, loading: false, dirty: false, wantsRequest: false };
}

// 同時只有一個查詢；查詢中收到的變動只累積成一次後續查詢（design 第 3、4 節）
export function reduceMonitor(state, event) {
  switch (event.type) {
    case 'changed':
      return state.loading ? { ...state, dirty: true } : { ...state, wantsRequest: true };
    case 'requestMonitor':
      return { ...state, requestSeq: state.requestSeq + 1, loading: true, dirty: false, wantsRequest: false };
    case 'monitorLoaded':
      if (event.seq !== state.requestSeq) return state;
      return { ...state, data: event.data, loading: false, wantsRequest: state.dirty, dirty: false };
    case 'monitorFailed':
      if (event.seq !== state.requestSeq) return state;
      return { ...state, loading: false, wantsRequest: state.dirty, dirty: false };
    case 'reset':
      return createMonitorState();
    default:
      return state;
  }
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatLocalTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function answerText(answers) {
  return `「${answers.join('／')}」`;
}

function summaryOf(question, phase, groupCount) {
  if (phase === ENDED) {
    if (!question.settled) return '判定中';
    if (!question.winner) return '無人作答';
    const fair = question.winnerSource === 'fair' ? '（公平順位改判）' : '';
    return `${question.winner.groupName} ${answerText(question.winner.answers)}${fair}`;
  }
  const count = `已送出 ${question.submittedCount}／${groupCount} 組`;
  if (!question.settled) return `${count}，判定中`;
  if (!question.winner) return count;
  return `${count}，第 1 名：${question.winner.groupName} ${answerText(question.winner.answers)}`;
}

// 明細順序：有效作答依名次（公平順位改判後名次可能與送達順序不同），已作廢的依送達順序排在最後；
// 沒有名次的有效作答依送達順序排在有名次者之後（add-fair-ranking design 第 5 節）
function orderedEntries(entries) {
  const valid = entries.filter(({ status }) => status === 'valid');
  const voided = entries.filter(({ status }) => status !== 'valid');
  const byRank = (left, right) => left.rank - right.rank;
  const placed = valid.filter(({ place }) => place).sort((left, right) => left.place - right.place || byRank(left, right));
  const unplaced = valid.filter(({ place }) => !place).sort(byRank);
  return [...placed, ...unplaced, ...voided.sort(byRank)];
}

// 只有搶答中的有效作答可以作廢（add-submission-void design 第 6 節）
function detailsOf(question, phase) {
  const lines = orderedEntries(question.entries).map((entry) => ({
    text: [
      entry.status === 'valid' ? (entry.place ? `第 ${entry.place} 名` : '判定中') : '已作廢',
      entry.groupName,
      answerText(entry.answers),
      formatLocalTime(entry.submittedAt),
    ].join('　'),
    voided: entry.status !== 'valid',
    ...(phase === BUZZING && entry.status === 'valid'
      ? { voidAction: { questionId: question.id, rank: entry.rank, groupName: entry.groupName } }
      : {}),
  }));
  if (question.notSubmitted.length > 0) {
    lines.push({ text: `未送出：${question.notSubmitted.map(({ groupName }) => groupName).join('、')}`, voided: false });
  }
  return lines;
}

export function getMonitorView(state) {
  const data = state.data;
  if (!data) return { title: '作答監看', hint: '讀取中…', rows: [] };
  const title = data.phase === ENDED ? '搶答結果' : '作答監看';
  if (data.phase === PREPARING) return { title, hint: '開始搶答後會顯示各組作答。', rows: [] };
  if (data.questions.length === 0) return { title, hint: '尚未匯入題目。', rows: [] };
  return {
    title,
    hint: '',
    rows: data.questions.map((question) => ({
      id: question.id,
      label: `第 ${question.id} 題`,
      prompt: question.prompt,
      summary: summaryOf(question, data.phase, data.groupCount),
      details: detailsOf(question, data.phase),
    })),
  };
}
