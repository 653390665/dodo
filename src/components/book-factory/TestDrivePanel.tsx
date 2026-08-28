import React from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import type { Skill } from '../../../shared/types';
import { countChineseCharacters, MIN_BOOK_FACTORY_TEXT_CHARS } from './useBookFactory';
import { WritingStyleControl } from '../WritingStyleControl';
import type { WritingStyleCandidate, WritingStyleMode, WritingStyleResolution } from '../../lib/writing-style-client';

interface TestDrivePanelProps {
  selectedSkill: Skill;
  testInput: string;
  onTestInputChange: (val: string) => void;
  testOutput: string;
  testError?: string | null;
  testStyleResolution?: WritingStyleResolution | null;
  testStyleCandidates?: WritingStyleCandidate[];
  onConfirmTestStyle?: (mode: WritingStyleMode) => Promise<string | void> | string | void;
  onGenerateWithTestStyle?: (fingerprint?: string) => Promise<void> | void;
  isTesting: boolean;
  onTestDrive: () => void;
}

export function TestDrivePanel({
  selectedSkill: _selectedSkill,
  testInput,
  onTestInputChange,
  testOutput,
  testError,
  testStyleResolution,
  testStyleCandidates,
  onConfirmTestStyle,
  onGenerateWithTestStyle,
  isTesting,
  onTestDrive,
}: TestDrivePanelProps) {
  const effectiveChineseChars = countChineseCharacters(testInput);
  const hasEnoughInput = effectiveChineseChars >= MIN_BOOK_FACTORY_TEXT_CHARS;
  return (
    <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50 border-dashed mt-6">
      <h4 className="text-[10px] font-bold text-theme-text uppercase mb-2">写法试跑</h4>
      <div className="space-y-3">
        <textarea
          value={testInput}
          onChange={(e) => onTestInputChange(e.target.value)}
          placeholder={`输入至少 ${MIN_BOOK_FACTORY_TEXT_CHARS} 个有效中文字符，试跑这张能力卡的写法效果...`}
          className="w-full h-20 p-2 text-xs bg-theme-sidebar border border-theme-border rounded-lg outline-none focus:border-theme-accent transition-all resize-none"
        />
        <p className="text-[10px] text-theme-muted">试跑要求：至少 {MIN_BOOK_FACTORY_TEXT_CHARS} 个有效中文字符，当前 {effectiveChineseChars} 个；不足时不会发送模型请求。</p>
        <button
          onClick={onTestDrive}
          disabled={isTesting || !hasEnoughInput}
          className="w-full py-2 bg-theme-text/10 text-theme-text text-[10px] font-bold rounded-lg border border-theme-text/20 hover:bg-theme-text/20 transition-all flex items-center justify-center gap-2"
        >
          {isTesting ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Wand2 size={12} aria-hidden="true" />} 试跑写法效果
        </button>
        {testError && <p role="alert" className="text-[11px] text-red-600">{testError}</p>}
        {(testStyleResolution || testStyleCandidates?.length) && onConfirmTestStyle && onGenerateWithTestStyle ? (
          <WritingStyleControl
            resolution={testStyleResolution}
            candidates={testStyleCandidates}
            onConfirm={onConfirmTestStyle}
            onGenerate={onGenerateWithTestStyle}
            confirmed={Boolean(testStyleResolution?.confirmed)}
            disabled={isTesting}
          />
        ) : null}
        {testOutput && (
          <div className="p-3 bg-theme-sidebar border border-theme-border rounded-lg text-xs text-theme-text italic leading-relaxed font-serif shadow-inner">
            {testOutput}
          </div>
        )}
      </div>
    </div>
  );
}
