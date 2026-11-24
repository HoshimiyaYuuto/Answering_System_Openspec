export function createDraftStore(storage) {
  const memory = new Map();
  let activeStorage = storage;
  let activityId = null;
  let activityScopeInitialized = false;

  function keyFor(studentId, questionId) {
    if (activityScopeInitialized && (typeof activityId !== 'string' || activityId.length === 0)) return null;
    return activityScopeInitialized
      ? `draft:${activityId}:${studentId}:${questionId}`
      : `draft:${studentId}:${questionId}`;
  }

  function setActivityId(value) {
    activityScopeInitialized = true;
    activityId = typeof value === 'string' && value.length > 0 ? value : null;
  }

  function disableStorage() {
    activeStorage = null;
  }

  function hasNonBlankValue(values) {
    return Array.isArray(values) && values.some((value) => typeof value === 'string' && value.trim().length > 0);
  }

  function get(studentId, questionId, blanksCount) {
    const key = keyFor(studentId, questionId);
    if (!key) return null;
    let value = memory.get(key) ?? null;
    if (activeStorage) {
      try {
        const stored = activeStorage.getItem(key);
        if (stored !== null) value = JSON.parse(stored);
      } catch {
        disableStorage();
      }
    }
    if (!Array.isArray(value) || value.length !== blanksCount) {
      if (value !== null) remove(studentId, questionId);
      return null;
    }
    if (!hasNonBlankValue(value)) {
      remove(studentId, questionId);
      return null;
    }
    memory.set(key, value.slice());
    return value.slice();
  }

  function set(studentId, questionId, values) {
    const key = keyFor(studentId, questionId);
    if (!key) return;
    const draft = Array.isArray(values) ? values.slice() : [];
    if (!hasNonBlankValue(draft)) {
      remove(studentId, questionId);
      return;
    }
    memory.set(key, draft);
    if (activeStorage) {
      try {
        activeStorage.setItem(key, JSON.stringify(draft));
      } catch {
        disableStorage();
      }
    }
  }

  function remove(studentId, questionId) {
    const key = keyFor(studentId, questionId);
    if (!key) return;
    memory.delete(key);
    if (activeStorage) {
      try {
        activeStorage.removeItem(key);
      } catch {
        disableStorage();
      }
    }
  }

  function has(studentId, questionId, blanksCount) {
    return get(studentId, questionId, blanksCount) !== null;
  }

  return { get, set, remove, has, setActivityId };
}
