export function createDraftStore(storage) {
  const memory = new Map();
  let activeStorage = storage;

  function keyFor(studentId, questionId) {
    return `draft:${studentId}:${questionId}`;
  }

  function disableStorage() {
    activeStorage = null;
  }

  function get(studentId, questionId, blanksCount) {
    const key = keyFor(studentId, questionId);
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
    memory.set(key, value.slice());
    return value.slice();
  }

  function set(studentId, questionId, values) {
    const key = keyFor(studentId, questionId);
    const draft = Array.isArray(values) ? values.slice() : [];
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

  return { get, set, remove, has };
}
