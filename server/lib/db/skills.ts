import type { Skill, SkillUsageRecord } from '../../../shared/types';
import { getDb, notify } from '../db-instance.js';
import { rowToSkill, skillToRow, rowToSkillUsageRecord, skillUsageRecordToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';
import { calculateFeedbackScore, summarizeUsageStats } from '../../../shared/lib/skill-model.js';

const skillCrud = createCrudHelpers<Skill, ReturnType<typeof skillToRow>>({
  tableName: 'skills',
  rowToEntity: rowToSkill,
  entityToRow: skillToRow,
  insertColumns: ['id', 'name', 'description', 'style', 'pacing', 'vocabulary', 'sentence_structure', 'imagery', 'banned_words', 'few_shots', 'character_traits', 'world_building', 'foreshadowing', 'plot_pattern', 'core_patterns', 'banned_elements', 'stability_score', 'evaluation_feedback', 'version', 'parent_skill_id', 'lineage_root_id', 'primary_dimension', 'dimension_tags', 'composition_profile', 'usage_stats', 'feedback_score', 'fusion_meta', 'method_chain', 'why_this_skill_works', 'source_badge', 'created_at', 'updated_at'],
  updateColumns: ['name', 'description', 'style', 'pacing', 'vocabulary', 'sentence_structure', 'imagery', 'banned_words', 'few_shots', 'character_traits', 'world_building', 'foreshadowing', 'plot_pattern', 'core_patterns', 'banned_elements', 'stability_score', 'evaluation_feedback', 'version', 'parent_skill_id', 'lineage_root_id', 'primary_dimension', 'dimension_tags', 'composition_profile', 'usage_stats', 'feedback_score', 'fusion_meta', 'method_chain', 'why_this_skill_works', 'source_badge', 'updated_at'],
  listOrderBy: 'created_at DESC'
});

export function listSkills(): Skill[] {
  return skillCrud.list();
}

export function getSkill(id: string): Skill | undefined {
  return skillCrud.get(id);
}

export function createSkill(s: Skill): void {
  skillCrud.create(s);
}

export function updateSkill(id: string, data: Partial<Skill>): void {
  skillCrud.update(id, data);
}

export function listSkillVersions(skillId: string): Skill[] {
  const skill = getSkill(skillId);
  if (!skill) return [];
  const rootId = skill.lineageRootId || skill.id;
  const rows = getDb()
    .prepare('SELECT * FROM skills WHERE lineage_root_id = ? OR id = ? ORDER BY version ASC, created_at ASC')
    .all(rootId, rootId);
  return rows.map(rowToSkill);
}

export function deleteSkill(id: string): void {
  skillCrud.delete(id);
}

export function listSkillUsageRecords(skillId?: string): SkillUsageRecord[] {
  if (!skillId) {
    return getDb()
      .prepare('SELECT * FROM skill_usage_records ORDER BY created_at DESC')
      .all()
      .map(rowToSkillUsageRecord);
  }

  const rows = getDb()
    .prepare(`
      SELECT sur.*
      FROM skill_usage_records sur
      WHERE EXISTS (
        SELECT 1
        FROM json_each(sur.mounted_skill_ids)
        WHERE value = ?
      )
      ORDER BY sur.created_at DESC
    `)
    .all(skillId);
  return rows.map(rowToSkillUsageRecord);
}

export function syncSkillFeedbackScores(): Skill[] {
  const skills = listSkills();
  const usageRecords = listSkillUsageRecords();
  const updates = skills
    .map((skill) => {
      const relatedRecords = usageRecords.filter((record) => record.mountedSkillIds.includes(skill.id));
      const usageStats = summarizeUsageStats(relatedRecords);
      const feedbackScore = calculateFeedbackScore(usageStats);
      const usageStatsJson = JSON.stringify(usageStats);
      const existingStatsJson = JSON.stringify(skill.usageStats || {});
      return {
        skill,
        usageStats,
        feedbackScore,
        needsUpdate:
          existingStatsJson !== usageStatsJson ||
          (skill.feedbackScore ?? 50) !== feedbackScore,
      };
    });

  const dirtyUpdates = updates.filter((entry) => entry.needsUpdate);
  if (dirtyUpdates.length > 0) {
    const now = Date.now();
    const statement = getDb().prepare(`
      UPDATE skills
      SET usage_stats = @usage_stats, feedback_score = @feedback_score, updated_at = @updated_at
      WHERE id = @id
    `);

    const transaction = getDb().transaction((entries: typeof dirtyUpdates) => {
      for (const entry of entries) {
        statement.run({
          id: entry.skill.id,
          usage_stats: JSON.stringify(entry.usageStats),
          feedback_score: entry.feedbackScore,
          updated_at: now,
        });
      }
    });

    transaction(dirtyUpdates);
    notify();
  }

  return updates.map(({ skill, usageStats, feedbackScore }) => ({
    ...skill,
    usageStats,
    feedbackScore,
  }));
}

export function createSkillUsageRecord(record: SkillUsageRecord): void {
  getDb().prepare(`
    INSERT INTO skill_usage_records (id, novel_id, chapter_id, mounted_skill_ids, fit_score, audit_score, user_action, notes, created_at)
    VALUES (@id, @novel_id, @chapter_id, @mounted_skill_ids, @fit_score, @audit_score, @user_action, @notes, @created_at)
  `).run(skillUsageRecordToRow(record));
  notify();
}
