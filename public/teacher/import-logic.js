const PREPARING = '準備中';

export function createImportState({ current = null, phase = PREPARING } = {}) {
  return { view: 'idle', current, preview: null, error: '', phase };
}

export function reduceImport(state, event) {
  switch (event.type) {
    case 'loaded':
      return { ...state, current: event.current ?? null, phase: event.phase ?? state.phase };
    case 'phaseChanged':
      return { ...state, phase: event.phase };
    case 'requestPreview':
      return { ...state, view: 'loading', error: '', previousView: state.view };
    case 'previewLoaded':
      return { ...state, view: 'reviewing', preview: event.preview, error: '' };
    case 'previewFailed':
      return {
        ...state,
        view: state.previousView === 'reviewing' && state.preview ? 'reviewing' : 'idle',
        error: event.message,
      };
    case 'cancel':
      return { ...state, view: 'idle', preview: null, error: '' };
    case 'requestConfirm':
      return { ...state, view: 'confirming', error: '' };
    case 'confirmed':
      return { ...state, view: 'idle', preview: null, current: event.current, error: '' };
    case 'confirmFailed':
      return { ...state, view: 'reviewing', error: event.message };
    default:
      return state;
  }
}

export function getBlockedReason(state) {
  if (state.phase !== PREPARING) return `目前階段為「${state.phase}」，只能在準備中匯入學習單。`;
  return '';
}

export function getImportControls(state) {
  const blocked = getBlockedReason(state) !== '';
  const busy = state.view === 'loading' || state.view === 'confirming';
  return {
    canSubmit: !blocked && !busy,
    canConfirm: !blocked && state.view === 'reviewing',
    canCancel: state.view === 'reviewing',
    showSummary: state.view === 'reviewing' || state.view === 'confirming',
  };
}

export function describeCurrent(current) {
  if (!current) return '尚未匯入學習單。';
  return `已匯入「${current.source.name}」：工作表「${current.sheetName}」，共 ${current.questionCount} 題、${current.blankCount} 個空格。`;
}

export function describePreview(preview) {
  const lines = [
    `來源：${preview.source.name}`,
    `工作表：${preview.sheetName}（表頭在第 ${preview.headerRow} 列）`,
    `共 ${preview.questionCount} 題、${preview.blankCount} 個空格`,
  ];
  if (preview.replacesExisting) lines.push('確認後會取代目前的題目。');
  return lines;
}

export function getSummaryRows(preview) {
  return preview.questions.map((question) => ({
    number: `第 ${question.id} 題`,
    type: question.type === 'group' ? '題組' : '單題',
    blanks: `${question.blankCount} 格`,
    prefixes: question.prefixes.filter(Boolean).join(' ') || '—',
  }));
}

export function createRequestSequence() {
  let latest = 0;
  return {
    next() {
      latest += 1;
      return latest;
    },
    isLatest(id) {
      return id === latest;
    },
  };
}
