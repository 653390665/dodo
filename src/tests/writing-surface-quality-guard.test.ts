import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(resolve(__dirname, '../components/WritingSurface.tsx'), 'utf8');

describe('WritingSurface audit surface', () => {
  test('does not ship fake quality guard content or unreachable HUDs', () => {
    expect(source).not.toContain('QualityGuardCenter');
    expect(source).not.toContain('植入AI味测试文本');
    expect(source).not.toContain('正文就绪，等待全方位质量扫描');
    expect(source).not.toContain('伏笔联想');
    expect(source).not.toContain('环境联想');
    expect(source).not.toContain('主创 AGENT 智能指引');
    expect(source).not.toContain('智能导航与上下文遥测');
    expect(source).not.toContain('上下文记忆雷达');
    expect(source).not.toContain('雷达正在深度扫描');
    expect(source).not.toContain('林啸');
    expect(source).not.toContain('false &&');
  });

  test('keeps one state-driven audit action guarded for empty chapters', () => {
    expect(source.match(/void onRunAudit\(\)/g)).toHaveLength(1);
    expect(source).toContain("workflowState.primaryAction === 'audit' && (isGeneratingCritique || isChapterEmpty)");
    expect(source).toContain('正文为空，暂不能审计。');
    expect(source).toContain('readOnly={false}');
  });

  test('empty project copy asks for an explicit first chapter', () => {
    expect(source).toContain('请点击下方按钮新建第一章');
    expect(source).not.toContain('一键开始您的第一章');
  });
});
