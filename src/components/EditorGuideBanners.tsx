import { Sparkles } from 'lucide-react';
import type { Chapter } from '../../shared/types';

interface EditorGuideBannersProps {
  currentChapter: Chapter | null;
  isChapterEmpty: boolean;
  showEmptyChapterGuide: boolean;
  showHasContentGuide: boolean;
  onCloseEmptyGuide: () => void;
  onCloseContentGuide: () => void;
}

export function EditorGuideBanners({
  currentChapter,
  isChapterEmpty,
  showEmptyChapterGuide,
  showHasContentGuide,
  onCloseEmptyGuide,
  onCloseContentGuide,
}: EditorGuideBannersProps) {
  return (
    <>
      {currentChapter && isChapterEmpty && showEmptyChapterGuide && (
        <div className="mx-6 mt-4 relative rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-theme-accent/5 p-4 text-left shadow-sm backdrop-blur-md animate-fade-in">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-2.5">
              <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 font-sans">
                  空章节指引
                </h4>
                <p className="text-xs text-theme-text/85 leading-relaxed font-sans">
                  当前章节暂无正文。您可以：(1) 直接在编辑器中起笔或输入文字；(2) 打开右侧【智能助理】下的【分镜规划】或【扩写生成】进行 AI 智能辅助创作。
                </p>
              </div>
            </div>
            <button
              onClick={onCloseEmptyGuide}
              className="text-theme-muted hover:text-theme-text transition-colors text-xs p-1 font-bold font-mono"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {currentChapter && (currentChapter.wordCount || 0) > 100 && showHasContentGuide && (
        <div className="mx-6 mt-4 relative rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-theme-accent/5 p-4 text-left shadow-sm backdrop-blur-md animate-fade-in">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-2.5">
              <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 font-sans">
                  章节打磨与审计指引
                </h4>
                <p className="text-xs text-theme-text/85 leading-relaxed font-sans">
                  本章正文已具雏形！您可以：(1) 打开右侧【智能助理】的【审稿】面板对本章进行一致性和节奏审计，找出 AI 味；(2) 在右侧【大纲与设定】面板中提取或补充人物/地点设定，确保设定长效一致；(3) 回到【立项驾驶舱】总览小说大局。
                </p>
              </div>
            </div>
            <button
              onClick={onCloseContentGuide}
              className="text-theme-muted hover:text-theme-text transition-colors text-xs p-1 font-bold font-mono"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}