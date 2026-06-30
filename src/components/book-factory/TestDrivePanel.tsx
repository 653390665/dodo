import React from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import type { Skill } from '../../../shared/types';

interface TestDrivePanelProps {
  selectedSkill: Skill;
  testInput: string;
  onTestInputChange: (val: string) => void;
  testOutput: string;
  isTesting: boolean;
  onTestDrive: () => void;
}

export function TestDrivePanel({
  selectedSkill: _selectedSkill,
  testInput,
  onTestInputChange,
  testOutput,
  isTesting,
  onTestDrive,
}: TestDrivePanelProps) {
  return (
    <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50 border-dashed mt-6">
      <h4 className="text-[10px] font-bold text-theme-text uppercase mb-2">功能模拟验证 (Test Drive)</h4>
      <div className="space-y-3">
        <textarea
          value={testInput}
          onChange={(e) => onTestInputChange(e.target.value)}
          placeholder="输入一段普通文本或细纲，测试该技能的风格涂抹能力..."
          className="w-full h-20 p-2 text-xs bg-theme-sidebar border border-theme-border rounded-lg outline-none focus:border-theme-accent transition-all resize-none"
        />
        <button
          onClick={onTestDrive}
          disabled={isTesting || !testInput}
          className="w-full py-2 bg-theme-text/10 text-theme-text text-[10px] font-bold rounded-lg border border-theme-text/20 hover:bg-theme-text/20 transition-all flex items-center justify-center gap-2"
        >
          {isTesting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} 运行风格涂抹测试
        </button>
        {testOutput && (
          <div className="p-3 bg-theme-sidebar border border-theme-border rounded-lg text-xs text-theme-text italic leading-relaxed font-serif shadow-inner">
            {testOutput}
          </div>
        )}
      </div>
    </div>
  );
}
