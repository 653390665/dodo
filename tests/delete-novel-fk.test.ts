import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initDb,
  closeDb,
  getDb,
  createNovel,
  getNovel,
  deleteNovel,
} from '../server/lib/db';
import type { Novel } from '../shared/types';

describe('deleteNovel cascades and integrity tests', () => {
  const dbPath = path.join(os.tmpdir(), `test-delete-novel-${Date.now()}.db`);

  test('should delete novel and cascade delete all related child table entries', async () => {
    // 1. Initialize custom isolated test DB
    initDb(dbPath);
    const db = getDb();

    const novelId = 'test-novel-to-delete';
    const now = Date.now();

    // 2. Insert Novel
    const novel: Novel = {
      id: novelId,
      title: '测试删除小说',
      authorId: 'local-user',
      summary: '删除级联与原子性测试',
      status: 'ongoing',
      createdAt: now,
      updatedAt: now,
    };
    createNovel(novel);

    // Verify novel inserted
    const fetchedNovel = getNovel(novelId);
    assert.ok(fetchedNovel);
    assert.equal(fetchedNovel.title, '测试删除小说');

    // 3. Insert related entities across child tables to ensure cascade/foreign key constraints are verified
    db.prepare(`
      INSERT INTO chapters (id, novel_id, volume_name, title, content, "order", word_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('chapter-1', novelId, '默认卷', '第一章', '正文内容', 1, 4, now, now);

    db.prepare(`
      INSERT INTO chapter_versions (id, chapter_id, content, word_count, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('version-1', 'chapter-1', '正文旧版本内容', 6, 'user', now);

    db.prepare(`
      INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('char-1', novelId, '主角萧炎', 'protagonist', '斗帝', '[]', '背景', '状态', now, now);

    db.prepare(`
      INSERT INTO locations (id, novel_id, name, description, region, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('loc-1', novelId, '乌坦城', '萧家所在地', '加玛帝国', now, now);

    db.prepare(`
      INSERT INTO items (id, novel_id, name, description, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('item-1', novelId, '玄重尺', '巨药黑色铁尺', '武器', now, now);

    db.prepare(`
      INSERT INTO factions (id, novel_id, name, description, leader, territory, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('faction-1', novelId, '萧家', '四大家族之一', '萧战', '乌坦城', now, now);

    db.prepare(`
      INSERT INTO power_levels (id, novel_id, name, description, tier, characteristics, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('power-1', novelId, '斗者', '斗气凝聚', 1, '斗气外放', now, now);

    db.prepare(`
      INSERT INTO timeline_events (id, novel_id, title, description, timestamp, status_tag, "order", created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('event-1', novelId, '纳兰嫣然退婚', '三年之约开启', '0', 'completed', 1, now, now);

    db.prepare(`
      INSERT INTO skill_usage_records (id, novel_id, chapter_id, mounted_skill_ids, fit_score, audit_score, user_action, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('usage-1', novelId, 'chapter-1', '["skill-1"]', 0.95, 0.88, 'accepted', '备注', now);

    db.prepare(`
      INSERT INTO idea_fragments (id, novel_id, content, type, status, ai_expansion, target_chapter_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('idea-1', novelId, '灵感片段一', 'scene', 'raw', 'AI扩写内容', 'chapter-1', now, now);

    db.prepare(`
      INSERT INTO foreshadowings (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('fores-1', novelId, '药老苏醒伏笔', '戒指异动', 'planted', 'chapter-1', null, '["char-1"]', '药尘', now, now);

    db.prepare(`
      INSERT INTO chapter_production_runs (id, novel_id, target_chapter_id, status, user_intent, scene_beats, draft_content, style_audit, continuity_report, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-1', novelId, 'chapter-1', 'completed', '写一段故事', '分镜大纲', '正文草稿', '审稿报告', '{}', null, now, now);

    db.prepare(`
      INSERT INTO continuation_packs (id, novel_id, title, status, source_documents, canon_facts, character_states, plot_state, style_profile, contradictions, continuation_task, source_map, reading_questions, continuation_gaps, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('pack-1', novelId, '续写包一', 'completed', '[]', '[]', '[]', '{}', '{}', '[]', '任务', '{}', '[]', '[]', now, now);

    db.prepare(`
      INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('chunk-1', novelId, 'chapter-1', 0, '切片文本', JSON.stringify([0.1, 0.2]));

    db.prepare(`
      INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rel-1', novelId, 'character', 'char-1', 'location', 'loc-1', 'resides_in', '居住在', now);

    // Verify all counts are 1
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM chapters WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM chapter_versions WHERE chapter_id = ?').get('chapter-1').count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM characters WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM locations WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM items WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM factions WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM power_levels WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM timeline_events WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM skill_usage_records WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM idea_fragments WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM foreshadowings WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM chapter_production_runs WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM continuation_packs WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM vector_chunks WHERE novel_id = ?').get(novelId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM entity_relationships WHERE novelId = ?').get(novelId).count, 1);

    // 4. Perform Deletion
    deleteNovel(novelId);

    // 5. Verify everything is 0
    assert.equal(getNovel(novelId), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM chapters WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM chapter_versions WHERE chapter_id = ?').get('chapter-1').count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM characters WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM locations WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM items WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM factions WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM power_levels WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM timeline_events WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM skill_usage_records WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM idea_fragments WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM foreshadowings WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM chapter_production_runs WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM continuation_packs WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM vector_chunks WHERE novel_id = ?').get(novelId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM entity_relationships WHERE novelId = ?').get(novelId).count, 0);

    // Close the DB connection so we can delete the file
    closeDb();

    // Clean up temporary database files
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
      if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Ignored
    }
  });
});
