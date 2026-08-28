import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWorkspaceFocus,
  getSidebarMainItems,
  isWorkspaceFamilyView,
} from '../src/lib/workspace-nav';

test('getSidebarMainItems keeps a single workspace entry in sidebar', () => {
  const items = getSidebarMainItems();
  const workspaceItems = items.filter((item) => item.id === 'workspace');

  assert.equal(workspaceItems.length, 1);
  assert.equal(workspaceItems[0]?.label, '创作工作台');
});

test('deriveWorkspaceFocus respects workspace nav keys and standalone pages', () => {
  assert.equal(deriveWorkspaceFocus('workspace', 'workspace-editor', 'world'), 'editor');
  assert.equal(deriveWorkspaceFocus('workspace', 'workspace-world', 'editor'), 'world');
  assert.equal(deriveWorkspaceFocus('editor', undefined, 'world'), 'editor');
  assert.equal(deriveWorkspaceFocus('world', undefined, 'editor'), 'world');
  assert.equal(deriveWorkspaceFocus('workspace', undefined, 'world'), 'world');
});

test('isWorkspaceFamilyView groups workspace, editor, and world', () => {
  assert.equal(isWorkspaceFamilyView('workspace'), true);
  assert.equal(isWorkspaceFamilyView('editor'), true);
  assert.equal(isWorkspaceFamilyView('world'), true);
  assert.equal(isWorkspaceFamilyView('library'), false);
});
