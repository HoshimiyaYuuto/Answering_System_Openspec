import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEntryNextStep, isReconnecting } from './logic.js';

test('connection is considered stale only after forty seconds without an event', () => {
  assert.equal(isReconnecting(10_000, 50_000), false);
  assert.equal(isReconnecting(10_000, 50_001), true);
  assert.equal(isReconnecting(null, 50_001), true);
});

test('valid entry proceeds to waiting screen', () => {
  const entry = { valid: true, phase: '準備中', group: { id: 1, name: '第 1 組' } };
  assert.deepEqual(getEntryNextStep({ data: entry }), { screen: 'waiting', entry });
});

test('invalidated entry returns to group selection with reason-specific guidance', () => {
  assert.deepEqual(getEntryNextStep({ data: { valid: false, reason: 'group_removed' } }), {
    screen: 'select-group', reason: 'group_removed', message: '原組別已移除，請重新選擇組別。',
  });
  assert.deepEqual(getEntryNextStep({ data: { valid: false, reason: 'entry_reset' } }), {
    screen: 'select-group', reason: 'entry_reset', message: '進場狀態已失效，請重新選擇組別。',
  });
});
