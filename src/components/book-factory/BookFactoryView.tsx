import React from 'react';
import { BookTemplate, Sparkles, X } from 'lucide-react';
import { useBookFactory } from './useBookFactory';
import { BookFactoryInput } from './BookFactoryInput';
import { BookFactoryOutput } from './BookFactoryOutput';
import { useAppStore } from '../../stores/app-store';

export function BookFactoryView() {
  const factory = useBookFactory();
  const { factoryIntent, setFactoryIntent } = useAppStore();

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      <div className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto p-8 relative z-10">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <BookTemplate size={28} className="text-theme-accent" aria-hidden="true" />
            拆书工厂 (Book-to-Skill Studio)
          </h1>
          <p className="text-theme-muted mt-2">上传爆款小说样本，AI 自动提炼文风、句法与爽点套路，结晶为你的专属 Skill 卡牌。</p>
        </div>

        {/* 工作流智能提示横幅 */}
        {factoryIntent?.activeSeriesId === 'book-deconstruction-flow' && (
          <div className="backdrop-blur-md bg-theme-accent/5 border border-theme-accent/20 rounded-2xl p-5 mb-8 shadow-lg relative overflow-hidden group/banner transition-all duration-300 hover:border-theme-accent/40">
            {/* OKLCH 霓虹发光灯带 */}
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-theme-accent via-emerald-500 to-theme-accent animate-pulse" />
            
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-theme-accent/15 text-theme-accent border border-theme-accent/20 shrink-0">
                  <Sparkles size={20} className="animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[9px] font-mono font-bold rounded bg-theme-accent/20 text-theme-accent border border-theme-accent/20 uppercase tracking-widest animate-pulse">
                      ACTIVE SOP STEP
                    </span>
                    <h2 className="text-sm font-bold text-theme-text font-serif leading-none">
                      {factoryIntent.stepId === 'step1' ? '拆书转化流 步骤一：神作高爽节奏拆解' : '拆书转化流 步骤二：神作金句修辞润色'}
                    </h2>
                  </div>
                  
                  <div className="text-xs leading-relaxed text-theme-muted space-y-2.5">
                    {factoryIntent.stepId === 'step1' ? (
                      <>
                        <p className="font-sans font-medium text-theme-text/90">
                          <span className="font-bold text-theme-accent">🎯 任务目标：</span>
                          导入一部具有标志性高爽节奏的神作（如爆款爽文的第一章），由 AI 提炼出其冲突爆发节奏与底层爽点大纲，自动转化为专属节奏卡并装备到本书。
                        </p>
                        <div className="p-3 rounded-lg bg-theme-bg/30 border border-theme-border/40 font-mono text-[11px] leading-relaxed">
                          <span className="font-bold text-theme-accent block mb-1">💡 极简操作向导：</span>
                          1. 将您准备好的爽文样本文本粘贴到左侧「小说文本样本」或直接上传文件。<br />
                          2. 点击「AI 智能分析与提炼」，等待结晶过程。<br />
                          3. 提炼成功后，在右侧面板点击「保存并装备此技能」一键将工作流推向下一阶段！
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="font-sans font-medium text-theme-text/90">
                          <span className="font-bold text-theme-accent">🎯 任务目标：</span>
                          您已装备爽点节奏卡！接下来建议导入一部文笔、修辞顶尖的神作样本，由 AI 分析提炼其金句结构、高级对话节奏与标志性的去 AI 味修辞风格，转化为词风风格卡装备。
                        </p>
                        <div className="p-3 rounded-lg bg-theme-bg/30 border border-theme-border/40 font-mono text-[11px] leading-relaxed">
                          <span className="font-bold text-theme-accent block mb-1">💡 极简操作向导：</span>
                          1. 在左侧贴入或上传文笔惊艳的神作样章。<br />
                          2. 启动 AI 分析，等待大模型在后台进行深度提炼。<br />
                          3. 提炼成功后，在右侧保存并装备该风格卡，完美打通「去 AI 味」高级精修模块！
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => setFactoryIntent(null)}
                className="p-1 rounded-lg border border-theme-border/40 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 transition-colors shrink-0 cursor-pointer"
                title="暂缓当前步骤并收起向导"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <BookFactoryInput
            fileContent={factory.fileContent}
            onFileContentChange={factory.setFileContent}
            isAnalyzing={factory.isAnalyzing}
            onFileUpload={factory.handleFileUpload}
            onAnalyze={factory.handleAnalyze}
          />
          <BookFactoryOutput
            isAnalyzing={factory.isAnalyzing}
            skillCards={factory.skillCards}
            selectedSkillIndex={factory.selectedSkillIndex}
            onSelectSkillIndex={factory.setSelectedSkillIndex}
            deck={factory.deck}
            deckMeta={factory.deckMeta}
            segmentLabels={factory.segmentLabels}
            isSaving={factory.isSaving}
            isEditing={factory.isEditing}
            onSetIsEditing={factory.setIsEditing}
            editableJson={factory.editableJson}
            onSetEditableJson={factory.setEditableJson}
            extractionSource={factory.extractionSource}
            isModelPending={factory.isModelPending}
            extractionWarnings={factory.extractionWarnings}
            extractionStatusNote={factory.extractionStatusNote}
            selectedSkill={factory.selectedSkill}
            updateSelectedSkill={factory.updateSelectedSkill}
            testInput={factory.testInput}
            onTestInputChange={factory.setTestInput}
            testOutput={factory.testOutput}
            isTesting={factory.isTesting}
            showEquipPanel={factory.showEquipPanel}
            onSetShowEquipPanel={factory.setShowEquipPanel}
            equipNovelId={factory.equipNovelId}
            onSetEquipNovelId={factory.setEquipNovelId}
            userNovels={factory.userNovels}
            lastSavedSkillId={factory.lastSavedSkillId}
            savedDeckIds={factory.savedDeckIds}
            onTestDrive={factory.handleTestDrive}
            onSaveSelectedSkill={factory.handleSaveSelectedSkill}
            onSaveDeck={factory.handleSaveDeck}
            onEquipDeck={factory.handleEquipDeck}
            onEquipSkill={factory.handleEquipSkill}
          />
        </div>
      </div>
    </div>
  );
}
