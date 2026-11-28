// 老師控制台「匯出結果」區塊的狀態與畫面判斷。純函式，design 第 8 節。
import { ZH, renderMessage } from './messages.js';

const ENDED = '已結束';

export function createExportState() {
  return { phase: null, importSource: null, config: null, action: 'idle', result: null };
}

export function reduceExport(state, event) {
  switch (event.type) {
    case 'configLoaded':
      return {
        ...state,
        config: { configured: Boolean(event.configured), serviceAccountEmail: event.serviceAccountEmail ?? null },
        importSource: event.target ?? null,
      };
    case 'importLoaded':
      return { ...state, importSource: event.source ?? null, result: null };
    case 'phaseChanged':
      // 只有階段真的改變才清除結果，避免同一階段的摘要重新讀取把剛寫回的結果洗掉
      if (event.phase === state.phase) return state;
      return { ...state, phase: event.phase, result: null };
    case 'requestWriteback':
      return { ...state, action: 'writing', result: null };
    // 結果以訊息描述保存，畫面時才依語言組字（add-teacher-language-switch design 第 2 節）
    case 'writebackDone': {
      const message = event.writtenCells > 0
        ? { parts: [{ key: 'export.written', params: { count: event.writtenCells } }, event.remapped ? { key: 'export.remapped' } : ''] }
        : { key: 'export.nothing' };
      return { ...state, action: 'idle', result: { tone: 'ok', message } };
    }
    case 'writebackFailed':
      return { ...state, action: 'idle', result: { tone: 'error', message: event.message || { key: 'export.writebackFailed' }, suggestDownload: true } };
    case 'requestDownload':
      return { ...state, action: 'downloading', result: null };
    case 'downloadDone':
      return { ...state, action: 'idle', result: { tone: 'ok', message: { key: 'export.downloaded' } } };
    case 'downloadFailed':
      return { ...state, action: 'idle', result: { tone: 'error', message: event.message || { key: 'export.downloadFailed' } } };
    case 'requestCsv':
      return { ...state, action: 'downloadingCsv', result: null };
    case 'csvDone':
      return { ...state, action: 'idle', result: { tone: 'ok', message: { key: 'export.csvDone' } } };
    case 'csvFailed':
      return { ...state, action: 'idle', result: { tone: 'error', message: event.message || { key: 'export.downloadFailed' } } };
    case 'reset':
      return createExportState();
    default:
      return state;
  }
}

function viewOf(state) {
  if (state.phase !== ENDED) return 'notEnded';
  if (state.importSource === null) return 'noImport';
  if (state.importSource === 'file') return 'fileOnly';
  if (!state.config?.configured) return 'notConfigured';
  return 'ready';
}

// 寫回失敗時，訊息本身沒提到「下載 xlsx」才補上建議
function resultTextOf(result, t) {
  if (!result) return '';
  const text = renderMessage(t, result.message);
  if (!result.suggestDownload || text.includes(t('export.fallbackMarker'))) return text;
  return `${text}${t('export.fallback')}`;
}

export function getExportView(state, t = ZH) {
  const view = viewOf(state);
  const idle = state.action === 'idle';
  const descriptions = {
    notEnded: t('export.notEnded'),
    noImport: t('export.noImport'),
    fileOnly: t('export.fileOnly'),
    notConfigured: state.config === null ? t('export.loadingConfig') : t('export.notConfigured'),
    ready: t('export.ready', { email: state.config?.serviceAccountEmail }),
  };
  return {
    view,
    description: descriptions[view],
    canWriteback: idle && view === 'ready',
    canDownload: idle && view !== 'notEnded' && view !== 'noImport',
    // csv 是整場作答紀錄，與學習單來源與服務帳號無關，只看是否已結束
    canDownloadCsv: idle && state.phase === ENDED,
    writebackLabel: state.action === 'writing' ? t('export.writing') : t('export.writeback'),
    downloadLabel: state.action === 'downloading' ? t('export.downloading') : t('export.download'),
    csvLabel: state.action === 'downloadingCsv' ? t('export.downloading') : t('export.csv'),
    resultText: resultTextOf(state.result, t),
    resultTone: state.result?.tone ?? null,
  };
}

// 從 Content-Disposition 取出下載檔名，優先使用 filename*
export function fileNameFromDisposition(header, fallback = 'guided-notes-answers.xlsx') {
  if (!header) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return fallback;
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}
