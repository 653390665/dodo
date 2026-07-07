import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computeCockpitRecommendations } from '../src/lib/cockpit-recommendations';
import { ProjectPreferenceProfile } from '../shared/types';
import {
  initDb,
  closeDb,
  createNovel,
  getNovel,
  updateNovel
} from '../server/lib/db';

const DB_PATH = path.join(process.cwd(), 'tests', 'temp-deconstruct-integration.db');

test.describe('Book Deconstruction Flow (拆书转化工作流) & BookFactory Integration Tests', () => {

  test.describe('1. Cockpit Recommendations Unit Tests', () => {

    test('Case 1: Standard Recommendations (activeSeriesId is not book-deconstruction-flow)', () => {
      // chaptersCount === 0 -> create_first_chapter, add_world_setting, import_continuation
      const recs1 = computeCockpitRecommendations({
        chaptersCount: 0,
        worldEntitiesCount: 0,
        hasBeats: false,
        hasContent: false,
        hasCritique: false,
        activeSeriesId: 'some-other-flow',
        completedSteps: []
      });
      assert.deepEqual(recs1, ['create_first_chapter', 'add_world_setting', 'import_continuation']);

      // chaptersCount > 0, worldEntitiesCount < 2 -> add_world_setting, resume_editor, mount_skill
      const recs2 = computeCockpitRecommendations({
        chaptersCount: 1,
        worldEntitiesCount: 1,
        hasBeats: false,
        hasContent: false,
        hasCritique: false,
        activeSeriesId: 'some-other-flow',
        completedSteps: []
      });
      assert.deepEqual(recs2, ['add_world_setting', 'resume_editor', 'mount_skill']);
    });

    test('Case 2: Step 1 Deconstruction Flow Recommendation (activeSeriesId is book-deconstruction-flow, empty completedSteps)', () => {
      // chaptersCount === 0 -> FIRST item is deconstruct_flow_step1, other slots default to standard ones
      const recs = computeCockpitRecommendations({
        chaptersCount: 0,
        worldEntitiesCount: 0,
        hasBeats: false,
        hasContent: false,
        hasCritique: false,
        activeSeriesId: 'book-deconstruction-flow',
        completedSteps: []
      });
      
      // Expected result based on computeCockpitRecommendations:
      // ['deconstruct_flow_step1', 'create_first_chapter', 'add_world_setting'].slice(0, 3)
      assert.equal(recs[0], 'deconstruct_flow_step1');
      assert.deepEqual(recs, ['deconstruct_flow_step1', 'create_first_chapter', 'add_world_setting']);
    });

    test('Case 3: Step 2 Deconstruction Flow Recommendation (activeSeriesId is book-deconstruction-flow, step1 completed)', () => {
      const recs = computeCockpitRecommendations({
        chaptersCount: 0,
        worldEntitiesCount: 0,
        hasBeats: false,
        hasContent: false,
        hasCritique: false,
        activeSeriesId: 'book-deconstruction-flow',
        completedSteps: ['completed-step:book-deconstruction-flow:step1']
      });

      // Expected result:
      // ['deconstruct_flow_step2', 'create_first_chapter', 'add_world_setting'].slice(0, 3)
      assert.equal(recs[0], 'deconstruct_flow_step2');
      assert.deepEqual(recs, ['deconstruct_flow_step2', 'create_first_chapter', 'add_world_setting']);
    });

    test('Case 4: Recommendation Flow Penetration/Completion (both step1 and step2 completed)', () => {
      const recs = computeCockpitRecommendations({
        chaptersCount: 1,
        worldEntitiesCount: 2,
        hasBeats: true,
        hasContent: true,
        hasCritique: false,
        activeSeriesId: 'book-deconstruction-flow',
        completedSteps: [
          'completed-step:book-deconstruction-flow:step1',
          'completed-step:book-deconstruction-flow:step2'
        ]
      });

      // Expected to bypass deconstruction-flow recommendations and go straight to standard critique/polish recommendations
      // Standard branch for chaptersCount > 0, worldEntitiesCount >= 2, hasBeats=true, hasContent=true, hasCritique=false is:
      // ['start_audit', 'polish_content', 'resume_editor']
      assert.deepEqual(recs, ['start_audit', 'polish_content', 'resume_editor']);
    });

  });

  test.describe('2. Database Persistence & Profile Integration Tests', () => {

    test.beforeEach(() => {
      try { closeDb(); } catch {}
      try { fs.unlinkSync(DB_PATH); } catch {}
      initDb(DB_PATH);
    });

    test.afterEach(() => {
      try { closeDb(); } catch {}
      try { fs.unlinkSync(DB_PATH); } catch {}
    });

    test('Simulate useBookFactory handleEquipSkill and verify step completion persistence in SQLite', () => {
      const novelId = 'test-novel-deconstruct';

      // 1. Create a test novel
      createNovel({
        id: novelId,
        title: '测试拆书小说',
        authorId: 'auth-user',
        summary: '这是一个用于拆书闭环测试的小说',
        status: 'ongoing',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Fetch back to verify basic creation
      const createdNovel = getNovel(novelId);
      assert.ok(createdNovel);
      assert.equal(createdNovel.title, '测试拆书小说');

      if (!createdNovel) {
        throw new Error('Novel was not created properly in the database');
      }

      // 2. Read its projectPreferenceProfile (or initialize if undefined / empty)
      const existingProfile: ProjectPreferenceProfile = (createdNovel.projectPreferenceProfile && Object.keys(createdNovel.projectPreferenceProfile).length > 0)
        ? createdNovel.projectPreferenceProfile
        : {
            tags: [],
            weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
            acceptedDimensions: [],
            rejectedDimensions: [],
            notes: [],
            evidenceCount: 0
          };

      assert.ok(existingProfile.tags);
      assert.deepEqual(existingProfile.tags, []);

      // 3. Simulate useBookFactory's tag-appending logic
      const stepId = 'step1';
      const completedTag = `completed-step:book-deconstruction-flow:${stepId}`;
      
      const currentTags: string[] = existingProfile.tags as string[];
      const updatedTags = currentTags.includes(completedTag) 
        ? currentTags 
        : [...currentTags, completedTag];

      const updatedProfile: ProjectPreferenceProfile = {
        ...existingProfile,
        tags: updatedTags
      };

      // 4. Update the novel to save the projectPreferenceProfile to SQLite
      updateNovel(novelId, {
        projectPreferenceProfile: updatedProfile,
        updatedAt: Date.now()
      });

      // 5. Fetch the novel back and assert that the tag list contains the expected completed-step tag
      const fetchedNovel = getNovel(novelId);
      assert.ok(fetchedNovel);
      assert.ok(fetchedNovel.projectPreferenceProfile);
      assert.ok(fetchedNovel.projectPreferenceProfile.tags);
      assert.ok(fetchedNovel.projectPreferenceProfile.tags.includes(completedTag));
      assert.deepEqual(fetchedNovel.projectPreferenceProfile.tags, [completedTag]);
    });

  });

});
