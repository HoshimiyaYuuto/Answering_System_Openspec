import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDraftStore } from './drafts.js';

function fakeStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test('draft store persists, reads, detects, and removes drafts', () => {
  const storage = fakeStorage();
  const drafts = createDraftStore(storage);
  drafts.set('student-01', 10, ['one', 'two']);
  assert.deepEqual(drafts.get('student-01', 10, 2), ['one', 'two']);
  assert.equal(drafts.has('student-01', 10, 2), true);
  assert.equal(storage.values.has('draft:student-01:10'), true);
  drafts.remove('student-01', 10);
  assert.equal(drafts.get('student-01', 10, 2), null);
  assert.equal(drafts.has('student-01', 10, 2), false);
});

test('draft with a different blank count is discarded', () => {
  const storage = fakeStorage();
  const drafts = createDraftStore(storage);
  drafts.set('student-01', 10, ['one', 'two']);
  assert.equal(drafts.get('student-01', 10, 1), null);
  assert.equal(storage.values.has('draft:student-01:10'), false);
});

test('undefined or failing storage degrades to memory without throwing', () => {
  const memoryOnly = createDraftStore();
  memoryOnly.set('student-01', 1, ['saved']);
  assert.deepEqual(memoryOnly.get('student-01', 1, 1), ['saved']);

  for (const failingMethod of ['getItem', 'setItem', 'removeItem']) {
    const storage = fakeStorage();
    storage[failingMethod] = () => { throw new Error(`${failingMethod} unavailable`); };
    const drafts = createDraftStore(storage);
    assert.doesNotThrow(() => drafts.set('student-02', 2, ['memory']));
    if (failingMethod === 'getItem') drafts.set('student-02', 2, ['memory']);
    assert.doesNotThrow(() => drafts.get('student-02', 2, 1));
    assert.doesNotThrow(() => drafts.remove('student-02', 2));
    assert.doesNotThrow(() => drafts.set('student-02', 2, ['still-memory']));
    assert.deepEqual(drafts.get('student-02', 2, 1), ['still-memory']);
  }
});
