import React from 'react';
import { Loader2, Upload, ChevronRight } from 'lucide-react';

interface BookFactoryInputProps {
  fileContent: string;
  onFileContentChange: (value: string) => void;
  isAnalyzing: boolean;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAnalyze: () => void;
}

export function BookFactoryInput({
  fileContent,
  onFileContentChange,
  isAnalyzing,
  onFileUpload,
  onAnalyze,
}: BookFactoryInputProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="bg-theme-sidebar rounded-2xl shadow-sm border border-theme-border overflow-hidden flex flex-col h-full min-h-[500px]">
        <div className="p-4 bg-theme-sidebar border-b border-theme-border flex justify-between items-center">
          <h3 className="font-bold text-theme-text flex gap-2 items-center"><Upload size={18} /> 上传范例文稿</h3>
          <label className="cursor-pointer px-4 py-1.5 bg-theme-text text-white text-xs font-bold rounded-lg hover:bg-theme-text/90 transition-colors">
            选择 TXT 文件
            <input type="file" accept=".txt,.md" className="hidden" onChange={onFileUpload} />
          </label>
        </div>
        <div className="p-0 relative flex-1">
          <textarea
            value={fileContent}
            onChange={(e) => onFileContentChange(e.target.value)}
            placeholder="或直接粘贴小说文本到此处..."
            className="w-full h-full p-6 text-sm text-theme-muted leading-relaxed outline-none resize-none bg-transparent"
          />
        </div>
        <div className="p-4 border-t border-theme-border bg-theme-bg/30">
          <button
            onClick={onAnalyze}
            disabled={!fileContent || isAnalyzing}
            className="w-full py-4 bg-theme-accent text-white font-bold rounded-xl shadow-md hover:bg-theme-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 transition-all text-lg"
          >
            {isAnalyzing ? (
              <><Loader2 size={20} className="animate-spin" /> 正在提炼文风模型的灵魂...</>
            ) : (
              <>开始拆书与萃取 Skill <ChevronRight size={20}/></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
