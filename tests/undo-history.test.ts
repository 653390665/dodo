import test from 'node:test';
import assert from 'node:assert/strict';
import { createUndoState, pushToHistory, undo, redo } from '../src/lib/undo-history';

test('undo history - basic flow', () => {
  let state = createUndoState('v1');
  assert.strictEqual(state.present, 'v1');
  assert.strictEqual(state.past.length, 0);

  state = pushToHistory(state, 'v2');
  assert.strictEqual(state.present, 'v2');
  assert.strictEqual(state.past[0], 'v1');

  state = undo(state);
  assert.strictEqual(state.present, 'v1');
  assert.strictEqual(state.future[0], 'v2');

  state = redo(state);
  assert.strictEqual(state.present, 'v2');
  assert.strictEqual(state.past[0], 'v1');
  assert.strictEqual(state.future.length, 0);
});

test('undo history - ignore identical push', () => {
  const state = createUndoState('v1');
  const newState = pushToHistory(state, 'v1');
  assert.strictEqual(state, newState);
});

test('undo history - future is cleared on new push', () => {
  let state = createUndoState('v1');
  state = pushToHistory(state, 'v2');
  state = undo(state);
  assert.strictEqual(state.future.length, 1);

  state = pushToHistory(state, 'v3');
  assert.strictEqual(state.present, 'v3');
  assert.strictEqual(state.future.length, 0);
  assert.strictEqual(state.past.length, 1);
  assert.strictEqual(state.past[0], 'v1');
});

test('undo history - limit past size', () => {
  let state = createUndoState('v0');
  for (let i = 1; i <= 60; i++) {
    state = pushToHistory(state, `v${i}`);
  }
  // Limit is 50 in current implementation
  assert.strictEqual(state.past.length, 50);
  assert.strictEqual(state.past[0], 'v10'); // 60 - 50 = 10
});
