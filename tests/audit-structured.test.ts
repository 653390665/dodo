import test from 'node:test';
import assert from 'node:assert/strict';
import {
  embedStructuredAudit,
  extractStructuredAudit,
  parseStructuredAuditResponse,
  renderStructuredAuditMarkdown,
} from '../src/lib/audit-structured';
import { extractPolishTargetsFromCritique, selectRewriteTargetsForPatch } from '../src/lib/chapter-polish';

test('structured audit roundtrip preserves exact issue metadata', () => {
  const raw = JSON.stringify({
    score: 82,
    fatalIssues: [
      {
        issueType: 'dialogue-logic',
        issueSubtype: 'dialogue-abrupt-info',
        severity: 'critical',
        snippet: '“三……三天。”',
        explanation: '半截信息突然冒出，读者接不住。',
        patchHint: '在前文补一个追问。',
      },
    ],
    sceneChecks: [
      { scene: '场景三：掌柜露破绽', status: 'weak', note: '关键信息落点偏突兀。' },
    ],
    surgerySuggestions: ['先补前因，再保留“三天”的迟疑感。'],
  });

  const structured = parseStructuredAuditResponse(raw);
  assert.ok(structured);
  const markdown = renderStructuredAuditMarkdown(structured!);
  const embedded = embedStructuredAudit(markdown, structured!);
  const extracted = extractStructuredAudit(embedded);

  assert.deepEqual(extracted, structured);
});

test('chapter polish prefers structured audit snippets over markdown inference', () => {
  const raw = JSON.stringify({
    score: 82,
    fatalIssues: [
      {
        issueType: 'duplicate',
        issueSubtype: 'duplicate-rupture',
        severity: 'critical',
        snippet: '掌柜的脸色刷地白了一层。',
        explanation: '重复导致节奏断裂。',
        patchHint: '保留第一次，删除后续重复。',
      },
      {
        issueType: 'dialogue-logic',
        issueSubtype: 'dialogue-abrupt-info',
        severity: 'major',
        snippet: '“三……三天。”',
        explanation: '信息突兀。',
        patchHint: '补上前因追问。',
      },
    ],
    sceneChecks: [],
    surgerySuggestions: ['补前因。'],
  });

  const structured = parseStructuredAuditResponse(raw)!;
  const critique = embedStructuredAudit(renderStructuredAuditMarkdown(structured), structured);
  const targets = extractPolishTargetsFromCritique(critique);

  assert.deepEqual(targets.duplicateTargets, ['掌柜的脸色刷地白了一层。']);
  assert.deepEqual(targets.rewriteTargets, ['“三……三天。”']);

  const selected = selectRewriteTargetsForPatch(
    '掌柜的脸色刷地白了一层。\n\n“三……三天。”声音几乎是贴着桌面传过来的。',
    targets.rewriteTargets,
    3,
    critique,
  );
  assert.equal(selected[0]?.issueType, 'dialogue-logic');
  assert.equal(selected[0]?.issueSubtype, 'dialogue-abrupt-info');
});

test('structured audit parser repairs unescaped inner quotes in snippets', () => {
  const raw = `{
    "score": 2,
    "fatalIssues": [
      {
        "issueType": "duplicate",
        "issueSubtype": "duplicate-rupture",
        "severity": "critical",
        "snippet": "主角问"那您腰间那串钥匙，开的是什么？"掌柜回答"地窖、柴房、杂物间。"",
        "explanation": "问答链出现未转义引号，但整体仍应被服务端修复并解析。",
        "patchHint": "保留原意，后续统一转成可读报告。"
      }
    ],
    "sceneChecks": [],
    "surgerySuggestions": ["修复 JSON 字符串中的内层引号。"]
  }`;

  const structured = parseStructuredAuditResponse(raw);
  assert.ok(structured);
  assert.equal(structured?.fatalIssues[0]?.issueType, 'duplicate');
  assert.match(structured?.fatalIssues[0]?.snippet || '', /那您腰间那串钥匙/);
});
