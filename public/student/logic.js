const ENTRY_REASON_MESSAGES = {
  group_removed: '原組別已移除，請重新選擇組別。',
  entry_reset: '進場狀態已失效，請重新選擇組別。',
};

export function isReconnecting(lastEventAt, now = Date.now()) {
  return !Number.isFinite(lastEventAt) || now - lastEventAt > 40_000;
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
