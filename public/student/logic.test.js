import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEntryNextStep, getPhaseDisplay, getStoredEntryNextStep, isReconnecting, isStaleRequest } from './logic.js';

test('connection is considered stale only after forty seconds without an event', () => {
  assert.equal(isReconnecting(10_000, 50_000), false);
  assert.equal(isReconnecting(10_000, 50_001), true);
  assert.equal(isReconnecting(null, 50_001), true);
});

test('request sequence identifies responses that have become stale', () => {
  assert.equal(isStaleRequest(4, 5), true);
  assert.equal(isStaleRequest(5, 5), false);
});

test('valid entry proceeds to waiting screen', () => {
  const entry = { valid: true, phase: '準備中', group: { id: 1, name: '第 1 組' } };
  assert.deepEqual(getEntryNextStep({ data: entry }), { screen: 'waiting', entry });
});

test('stored student id determines whether entry response should be restored or explained', () => {
  assert.deepEqual(getStoredEntryNextStep(false, null), {
    screen: 'select-group', message: '', shouldExplain: false,
  });
  const valid = { valid: true, phase: '準備中', group: { id: 1, name: '第一組' } };
  assert.deepEqual(getStoredEntryNextStep(true, { data: valid }), {
    screen: 'waiting', entry: valid, shouldExplain: false,
  });
  assert.equal(getStoredEntryNextStep(true, { data: { valid: false, reason: 'entry_reset' } }).message,
    '進場狀態已失效（例如伺服器重新啟動），請重新選擇組別');
  assert.equal(getStoredEntryNextStep(true, { data: { valid: false, reason: 'group_removed' } }).message,
    '你原本的組別已被老師移除，請重新選擇組別');
});

test('invalidated entry returns to group selection with reason-specific guidance', () => {
  assert.deepEqual(getEntryNextStep({ data: { valid: false, reason: 'group_removed' } }), {
    screen: 'select-group', reason: 'group_removed', message: '你原本的組別已被老師移除，請重新選擇組別',
  });
  assert.deepEqual(getEntryNextStep({ data: { valid: false, reason: 'entry_reset' } }), {
    screen: 'select-group', reason: 'entry_reset', message: '進場狀態已失效（例如伺服器重新啟動），請重新選擇組別',
  });
  assert.notEqual(
    getEntryNextStep({ data: { valid: false, reason: 'group_removed' } }).message,
    getEntryNextStep({ data: { valid: false, reason: 'entry_reset' } }).message,
  );
});

test('phase display exposes preparation, active, and ended messages with switching only in preparation', () => {
  assert.deepEqual(getPhaseDisplay('準備中'), { message: '請稍候，老師開始活動後再繼續。', canChangeGroup: true });
  assert.deepEqual(getPhaseDisplay('搶答中'), { message: '搶答已開始，作答功能即將開放', canChangeGroup: false });
  assert.deepEqual(getPhaseDisplay('已結束'), { message: '活動已結束', canChangeGroup: false });
});
