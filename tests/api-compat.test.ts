import test from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../src/lib/api';
import * as dbClient from '../src/lib/db-client';
import * as promptClient from '../src/lib/prompt-client';
import * as productionClient from '../src/lib/production-client';

test('api compatibility layer re-exports db, prompt, and production clients', () => {
  assert.equal(api.listNovels, dbClient.listNovels);
  assert.equal(api.subscribeToChanges, dbClient.subscribeToChanges);
  assert.equal(api.generateStoryCards, promptClient.generateStoryCards);
  assert.equal(api.extractSkill, promptClient.extractSkill);
  assert.equal(api.startChapterProductionRun, productionClient.startChapterProductionRun);
  assert.equal(api.startChapterProductionRunStream, productionClient.startChapterProductionRunStream);
  assert.equal(api.applyChapterProductionRun, productionClient.applyChapterProductionRun);
});
