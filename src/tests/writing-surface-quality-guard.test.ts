import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { WritingSurface } from '../components/WritingSurface';

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
    expect(source).toContain('正文为空，暂不能审计。');
  });

  test('keeps the textarea editable while generating', () => {
    // 特征化测试：登记已知缺陷「正文生成期间 readOnly 仍为 false，流式预览不锁定编辑器」。
    // 修复该缺陷时本断言应翻转为 readonly === true，勿删除。
    render(
      createElement(WritingSurface, {
        novel: {
          id: 'novel-1',
          title: 'Novel',
          authorId: 'user',
          summary: '',
          status: 'ongoing',
          createdAt: 1,
          updatedAt: 1,
        },
        currentChapter: {
          id: 'chapter-1',
          novelId: 'novel-1',
          title: '第一章',
          content: '正文',
          wordCount: 2,
          order: 1,
          sceneBeats: '',
          createdAt: 1,
          updatedAt: 1,
        },
        isGeneratingBeats: false,
        isGeneratingCritique: false,
        isGeneratingContent: true,
        auditStatus: null,
        isChapterEmpty: false,
        mountedSkillsCount: 0,
        runCopilotAction: vi.fn().mockResolvedValue(undefined),
        contentRef: { current: null },
        onGenerateBeats: vi.fn().mockResolvedValue(undefined),
        onRunAudit: vi.fn().mockResolvedValue(undefined),
        onUpdateContent: vi.fn(),
        onQueueContentWrite: vi.fn(),
        onAddFirstChapter: vi.fn().mockResolvedValue(undefined),
        onAddChapter: vi.fn().mockResolvedValue(undefined),
        setAgentTab: vi.fn(),
        setIsAgentSidebarOpen: vi.fn(),
      })
    );
    expect(screen.getByRole('textbox').hasAttribute('readonly')).toBe(false);
  });

  test('empty project copy asks for an explicit first chapter', () => {
    expect(source).toContain('请点击下方按钮新建第一章');
    expect(source).not.toContain('一键开始您的第一章');
  });
});
