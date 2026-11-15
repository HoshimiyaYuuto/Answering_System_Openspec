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

  return {
    list() {
      return groups.map(({ id, name }) => ({ id, name }));
    },
    replace(nextGroups) {
      groups = validateGroups(nextGroups);
      return this.list();
    },
    generate(count) {
      if (!Number.isInteger(count) || count < MIN_GROUPS || count > MAX_GROUPS) {
        throw new InvalidGroupsError('組數必須為 1 至 100 的整數。');
      }
      groups = Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `第 ${index + 1} 組` }));
      return this.list();
    },
    count() {
      return groups.length;
    },
  };
}

export function createDevelopmentGroupSeed() {
  return Array.from({ length: MAX_GROUPS }, (_, index) => ({ id: index + 1, name: `第 ${index + 1} 組` }));
}
