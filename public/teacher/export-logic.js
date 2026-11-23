// 老師控制台「匯出結果」區塊的狀態與畫面判斷。純函式，design 第 8 節。
const ENDED = '已結束';
const FALLBACK = '也可以改用「下載 xlsx」。';

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
    case 'writebackDone': {
      const text = event.writtenCells > 0
        ? `已寫回 ${event.writtenCells} 格到線上試算表。${event.remapped ? '線上試算表的版面在匯入後有變動，已依題號重新對位。' : ''}`
        : '沒有任何成功答案，線上試算表沒有變動。';
      return { ...state, action: 'idle', result: { tone: 'ok', text } };
    }
    case 'writebackFailed': {
      const message = event.message || '寫回失敗。';
      return { ...state, action: 'idle', result: { tone: 'error', text: message.includes('下載 xlsx') ? message : `${message}${FALLBACK}` } };
    }
    case 'requestDownload':
      return { ...state, action: 'downloading', result: null };
    case 'downloadDone':
      return { ...state, action: 'idle', result: { tone: 'ok', text: '已下載含答案的 xlsx。' } };
    case 'downloadFailed':
      return { ...state, action: 'idle', result: { tone: 'error', text: event.message || '下載失敗。' } };
    case 'requestCsv':
      return { ...state, action: 'downloadingCsv', result: null };
    case 'csvDone':
      return { ...state, action: 'idle', result: { tone: 'ok', text: '已下載 CSV。' } };
    case 'csvFailed':
      return { ...state, action: 'idle', result: { tone: 'error', text: event.message || '下載失敗。' } };
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

export function getExportView(state) {
  const view = viewOf(state);
  const idle = state.action === 'idle';
  const descriptions = {
    notEnded: '活動結束後才能匯出。',
    noImport: '尚未匯入學習單，無法匯出。',
    fileOnly: '這份學習單是上傳的 xlsx，沒有線上試算表可寫回，只能下載 xlsx。',
    notConfigured: state.config === null ? '讀取寫回設定中…' : 'server 尚未設定 Google 服務帳號，目前只能下載 xlsx。',
    ready: `寫回前請把線上試算表共用給 ${state.config?.serviceAccountEmail} 並設為「編輯者」。`,
  };
  return {
    view,
    description: descriptions[view],
    canWriteback: idle && view === 'ready',
    canDownload: idle && view !== 'notEnded' && view !== 'noImport',
    // csv 是整場作答紀錄，與學習單來源與服務帳號無關，只看是否已結束
    canDownloadCsv: idle && state.phase === ENDED,
    writebackLabel: state.action === 'writing' ? '寫回中…' : '寫回 Google 試算表',
    downloadLabel: state.action === 'downloading' ? '下載中…' : '下載 xlsx',
    csvLabel: state.action === 'downloadingCsv' ? '下載中…' : '下載 CSV',
    resultText: state.result?.text ?? '',
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
