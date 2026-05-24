import type { Skill, SkillUsageRecord } from '../types';
import { call } from './db-transport';

export async function listSkills(): Promise<Skill[]> { return call('listSkills'); }
export async function getSkill(id: string): Promise<Skill | undefined> { return call('getSkill', id); }
export async function createSkill(s: Skill): Promise<void> { return call('createSkill', s); }
export async function updateSkill(id: string, data: Partial<Skill>): Promise<void> { return call('updateSkill', id, data); }
export async function listSkillVersions(skillId: string): Promise<Skill[]> { return call('listSkillVersions', skillId); }
export async function deleteSkill(id: string): Promise<void> { return call('deleteSkill', id); }
export async function listSkillUsageRecords(skillId?: string): Promise<SkillUsageRecord[]> { return call('listSkillUsageRecords', skillId); }
export async function syncSkillFeedbackScores(): Promise<Skill[]> { return call('syncSkillFeedbackScores'); }
export async function createSkillUsageRecord(record: SkillUsageRecord): Promise<void> { return call('createSkillUsageRecord', record); }
