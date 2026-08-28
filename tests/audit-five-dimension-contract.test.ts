import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../shared/config/prompt-templates';
import { AUDIT_OUTPUT_CONTRACT } from '../server/helpers/prompt-helpers';

test('manualAudit prompt requires 5-dimension scoring', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /可读性/);
  assert.match(prompt, /分镜执行/);
  assert.match(prompt, /冲突推进/);
  assert.match(prompt, /风格契合/);
  assert.match(prompt, /网文章节感/);
});

test('manualAudit prompt enforces PASS/FAIL gate', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /pass.*true.*false|硬阻断/);
  assert.match(prompt, /failReason/);
});

test('manualAudit prompt enforces field length caps', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /≤ ?\d+ ?字/);
});

test('manualAudit prompt requires actionable fatal issues when the hard gate fails', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /(?:任一维度<4|totalScore<30)[^\n]*fatalIssues至少 ?1|fatalIssues至少 ?1[^\n]*(?:任一维度<4|totalScore<30)/);
});

test('manualAudit prompt treats authoring metadata as a blocking defect', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /作品：/);
  assert.match(prompt, /问：\/答：/);
  assert.match(prompt, /必须作为 fatalIssues 报告/);
});

test('runtime audit contract protects saved legacy templates', () => {
  assert.match(AUDIT_OUTPUT_CONTRACT, /只输出一个 JSON 对象/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /scores、totalScore、pass、failReason、fatalIssues、surgerySuggestions/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /fatalIssues 至少1条/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /创作元数据或问答残留时.*pass=false/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /六个字段一个都不能省略/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /issueType.*issueSubtype.*severity.*snippet.*explanation.*patchHint/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /snippet 必须原字原样来自正文/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /"scores".*"totalScore".*"fatalIssues"/s);
  assert.match(AUDIT_OUTPUT_CONTRACT, /evidence/);
  assert.match(AUDIT_OUTPUT_CONTRACT, /scene_execution.*character_state.*hard_canon.*foreshadowing/);
});
