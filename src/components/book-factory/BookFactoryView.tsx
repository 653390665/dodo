import React from 'react';
import { BookTemplate } from 'lucide-react';
import { useBookFactory } from './useBookFactory';
import { BookFactoryInput } from './BookFactoryInput';
import { BookFactoryOutput } from './BookFactoryOutput';
import type { BookFactoryChapterContext } from './useBookFactory';

export function BookFactoryView(context: BookFactoryChapterContext = {}) {
  const factory = useBookFactory(context);

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      <div className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto p-8 relative z-10">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <BookTemplate size={28} className="text-theme-accent" aria-hidden="true" />
            拆书工厂
          </h1>
          <p className="text-theme-muted mt-2">上传爆款小说样本，生成可保存的专属拆书卡候选，拆解文风、句法与爽点套路。</p>
        </div>

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
            extractionQuality={factory.extractionQuality}
            selectedSkill={factory.selectedSkill}
            updateSelectedSkill={factory.updateSelectedSkill}
            testInput={factory.testInput}
            onTestInputChange={factory.setTestInput}
            testOutput={factory.testOutput}
            testError={factory.testError}
            testStyleResolution={factory.testStyleResolution}
            testStyleCandidates={factory.testStyleCandidates}
            onConfirmTestStyle={factory.onConfirmTestStyle}
            onGenerateWithTestStyle={factory.onGenerateWithTestStyle}
            isTesting={factory.isTesting}
            showEquipPanel={factory.showEquipPanel}
            onSetShowEquipPanel={factory.setShowEquipPanel}
            equipNovelId={factory.equipNovelId}
            onSetEquipNovelId={factory.setEquipNovelId}
            userNovels={factory.userNovels}
            selectedSavedSkillId={factory.selectedSavedSkillId}
            savedDeckIds={factory.savedDeckIds}
            onTestDrive={factory.handleTestDrive}
            onSaveSelectedSkill={factory.handleSaveSelectedSkill}
            onSaveDeck={factory.handleSaveDeck}
            onEquipDeck={factory.handleEquipDeck}
            onEquipSkill={factory.handleEquipSkill}
            deckSelection={factory.deckSelection}
            onDeckSelectionChange={factory.setDeckSelection}
          />
        </div>
      </div>
    </div>
  );
}
