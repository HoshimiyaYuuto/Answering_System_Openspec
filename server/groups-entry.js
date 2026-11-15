const MIN_GROUPS = 1;
const MAX_GROUPS = 100;
const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 30;

export class InvalidGroupsError extends Error {
  constructor(message = '組別設定無效。') {
    super(message);
    this.name = 'InvalidGroupsError';
    this.code = 'INVALID_GROUPS';
  }
}

function validateGroups(groups) {
  if (!Array.isArray(groups) || groups.length < MIN_GROUPS || groups.length > MAX_GROUPS) {
    throw new InvalidGroupsError('組別數量必須為 1 至 100。');
  }

  const ids = new Set();
  const names = new Set();
  const normalized = groups.map((group) => {
    if (!group || !Number.isInteger(group.id) || group.id < 1 || group.id > MAX_GROUPS || ids.has(group.id)) {
      throw new InvalidGroupsError('組別 id 必須是 1 至 100 的不重複正整數。');
    }
    if (typeof group.name !== 'string') throw new InvalidGroupsError('組名格式無效。');

    const name = group.name.trim();
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH || names.has(name)) {
      throw new InvalidGroupsError('組名須為 1 至 30 字元且不得重複。');
    }
    ids.add(group.id);
    names.add(name);
    return { id: group.id, name };
  });

  return normalized.sort((left, right) => left.id - right.id);
}

export function createGroupsEntry({ seed = [] } = {}) {
  let groups = Array.isArray(seed) && seed.length === 0 ? [] : validateGroups(seed);
  const entries = new Map();

  function replaceGroups(nextGroups) {
    const validated = validateGroups(nextGroups);
    const remainingIds = new Set(validated.map(({ id }) => id));
    for (const entry of entries.values()) {
      if (!remainingIds.has(entry.groupId)) entry.removed = true;
    }
    groups = validated;
    return groups.map(({ id, name }) => ({ id, name }));
  }

  return {
    list() {
      return groups.map(({ id, name }) => ({ id, name }));
    },
    replace(nextGroups) {
      return replaceGroups(nextGroups);
    },
    generate(count) {
      if (!Number.isInteger(count) || count < MIN_GROUPS || count > MAX_GROUPS) {
        throw new InvalidGroupsError('組數必須為 1 至 100 的整數。');
      }
      groups = Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `第 ${index + 1} 組` }));
      const remainingIds = new Set(groups.map(({ id }) => id));
      for (const entry of entries.values()) {
        if (!remainingIds.has(entry.groupId)) entry.removed = true;
      }
      return this.list();
    },
    count() {
      return groups.length;
    },
    enter(studentId, groupId, phase) {
      if (typeof studentId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(studentId)) {
        return { error: { status: 400, code: 'INVALID_STUDENT_ID', message: 'studentId 格式無效。' } };
      }
      if (!Number.isInteger(groupId)) {
        return { error: { status: 400, code: 'INVALID_GROUPS', message: 'groupId 必須是整數。' } };
      }
      const group = groups.find((candidate) => candidate.id === groupId);
      if (!group) return { error: { status: 404, code: 'GROUP_NOT_FOUND', message: '找不到指定組別。' } };

      const current = entries.get(studentId);
      if (current && !current.removed && current.groupId !== groupId && phase !== '準備中') {
        return { error: { status: 409, code: 'GROUP_CHANGE_NOT_ALLOWED', message: '僅能在準備中更換組別。' } };
      }
      entries.set(studentId, { groupId, removed: false });
      return { data: { valid: true, studentId, group: { ...group }, phase } };
    },
    lookup(studentId, phase) {
      if (typeof studentId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(studentId)) {
        return { error: { status: 400, code: 'INVALID_STUDENT_ID', message: 'studentId 格式無效。' } };
      }
      const entry = entries.get(studentId);
      if (!entry) return { data: { valid: false, studentId, reason: 'entry_reset' } };
      if (entry.removed) return { data: { valid: false, studentId, reason: 'group_removed' } };
      const group = groups.find((candidate) => candidate.id === entry.groupId);
      if (!group) return { data: { valid: false, studentId, reason: 'group_removed' } };
      return { data: { valid: true, studentId, group: { ...group }, phase } };
    },
  };
}

export function createDevelopmentGroupSeed() {
  return Array.from({ length: MAX_GROUPS }, (_, index) => ({ id: index + 1, name: `第 ${index + 1} 組` }));
}
