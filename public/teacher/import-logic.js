import { ZH } from './messages.js';

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

export function getBlockedReason(state, t = ZH) {
  if (state.phase !== PREPARING) return t('import.blocked', { phase: t(`phase.${state.phase}`) });
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

export function describeCurrent(current, t = ZH) {
  if (!current) return t('import.none');
  return t('import.current', {
    name: current.source.name,
    sheet: current.sheetName,
    questions: current.questionCount,
    blanks: current.blankCount,
  });
}

export function describePreview(preview, t = ZH) {
  const lines = [
    t('import.source', { name: preview.source.name }),
    t('import.sheet', { sheet: preview.sheetName, row: preview.headerRow }),
    t('import.counts', { questions: preview.questionCount, blanks: preview.blankCount }),
  ];
  if (preview.replacesExisting) lines.push(t('import.replaces'));
  return lines;
}

// 匯入提醒：繁中照舊顯示 server 原文；其他語言依 warningDetails 組句，
// 不認得的代碼或舊回應沒有 details 時退回原文（add-teacher-language-switch design 第 5 節）
export function describeWarnings(summary, t = ZH) {
  const texts = Array.isArray(summary?.warnings) ? summary.warnings : [];
  if (t.language === 'zh-TW') return [...texts];
  const details = Array.isArray(summary?.warningDetails) ? summary.warningDetails : [];
  return texts.map((text, index) => {
    const detail = details[index];
    const key = detail ? `import.warning.${detail.code}` : null;
    return key && t.has(key) ? t(key, detail) : text;
  });
}

export function getSummaryRows(preview, t = ZH) {
  return preview.questions.map((question) => ({
    number: t('import.rowNumber', { id: question.id }),
    type: question.type === 'group' ? t('import.typeGroup') : t('import.typeSingle'),
    blanks: t('import.blankCount', { count: question.blankCount }),
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
