const ENTRY_REASON_MESSAGES = {
  group_removed: '你原本的組別已被老師移除，請重新選擇組別',
  entry_reset: '進場狀態已失效（例如伺服器重新啟動），請重新選擇組別',
};

export function isReconnecting(lastEventAt, now = Date.now()) {
  return !Number.isFinite(lastEventAt) || now - lastEventAt > 40_000;
}

export function isStaleRequest(requestId, latestRequestId) {
  return requestId !== latestRequestId;
}

export function getEntryNextStep(response) {
  const entry = response?.data ?? response;
  if (entry?.valid === true) return { screen: 'waiting', entry };
  if (entry?.valid === false) {
    return {
      screen: 'select-group',
      reason: entry.reason,
      message: ENTRY_REASON_MESSAGES[entry.reason] ?? '進場狀態無效，請重新選擇組別。',
    };
  }
  return { screen: 'select-group', reason: null, message: '' };
}

export function getStoredEntryNextStep(hasStoredStudentId, response) {
  if (!hasStoredStudentId) return { screen: 'select-group', message: '', shouldExplain: false };
  const next = getEntryNextStep(response);
  return { ...next, shouldExplain: next.screen === 'select-group' && Boolean(next.reason) };
}

export function getPhaseDisplay(phase) {
  switch (phase) {
    case '準備中':
      return { message: '請稍候，老師開始活動後再繼續。', canChangeGroup: true };
    case '搶答中':
      return { message: '搶答已開始，作答功能即將開放', canChangeGroup: false };
    case '已結束':
      return { message: '活動已結束', canChangeGroup: false };
    default:
      return { message: '', canChangeGroup: false };
  }
}
