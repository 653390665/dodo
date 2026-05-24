import test from 'node:test';
import assert from 'node:assert/strict';

import * as dbClient from '../src/lib/db-client';
import * as dbTransport from '../src/lib/db-transport';
import * as novelClient from '../src/lib/novel-client';
import * as chapterClient from '../src/lib/chapter-client';
import * as worldClient from '../src/lib/world-client';
import * as skillClient from '../src/lib/skill-client';
import * as ideaClient from '../src/lib/idea-client';
import * as continuationClient from '../src/lib/continuation-client';
import * as foreshadowingClient from '../src/lib/foreshadowing-client';
import * as chapterProductionDbClient from '../src/lib/chapter-production-db-client';

test('db-client compatibility layer re-exports fine-grained db modules', () => {
  assert.equal(dbClient.subscribeToChanges, dbTransport.subscribeToChanges);

  assert.equal(dbClient.listNovels, novelClient.listNovels);
  assert.equal(dbClient.updateNovel, novelClient.updateNovel);

  assert.equal(dbClient.listChapters, chapterClient.listChapters);
  assert.equal(dbClient.createChapterVersion, chapterClient.createChapterVersion);

  assert.equal(dbClient.listCharacters, worldClient.listCharacters);
  assert.equal(dbClient.updateTimelineEvent, worldClient.updateTimelineEvent);

  assert.equal(dbClient.listSkills, skillClient.listSkills);
  assert.equal(dbClient.syncSkillFeedbackScores, skillClient.syncSkillFeedbackScores);

  assert.equal(dbClient.listIdeaFragments, ideaClient.listIdeaFragments);
  assert.equal(dbClient.createIdeaFragment, ideaClient.createIdeaFragment);

  assert.equal(dbClient.listContinuationPacks, continuationClient.listContinuationPacks);
  assert.equal(dbClient.updateContinuationPack, continuationClient.updateContinuationPack);

  assert.equal(dbClient.listForeshadowings, foreshadowingClient.listForeshadowings);
  assert.equal(dbClient.createForeshadowing, foreshadowingClient.createForeshadowing);

  assert.equal(dbClient.listChapterProductionRuns, chapterProductionDbClient.listChapterProductionRuns);
  assert.equal(dbClient.updateChapterProductionRun, chapterProductionDbClient.updateChapterProductionRun);
});
