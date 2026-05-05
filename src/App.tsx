/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Library } from './components/Library';
import { EditorView } from './components/EditorView';
import { WorldBibleView } from './components/WorldBibleView';
import { AIAssistant } from './components/AIAssistant';
import { SkillsStudioView } from './components/SkillsStudioView';
import { BookFactoryView } from './components/BookFactoryView';
import { ViewType, Novel } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { createNovel, createChapter } from './lib/api';
import { SettingsModal } from './components/SettingsModal';

const LOCAL_USER = { uid: 'local-user' };

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('library');
  const [selectedNovel, setSelectedNovel] = useState<Novel | null>(null);
  const [user] = useState(LOCAL_USER);
  const [loading, setLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const handleOpenSettings = () => setIsSettingsOpen(true);
    window.addEventListener('open-settings', handleOpenSettings);
    return () => window.removeEventListener('open-settings', handleOpenSettings);
  }, []);

  const navigateToEditor = (novel: Novel) => {
    setSelectedNovel(novel);
    setCurrentView('editor');
  };

  const handleCreateNovelFromIdea = async (idea: string) => {
    const newNovelId = Date.now().toString();
    const now = Date.now();
    const newNovel: Novel = {
      id: newNovelId,
      title: '灵感新作',
      authorId: 'local-user',
      summary: idea,
      status: 'ongoing',
      createdAt: now,
      updatedAt: now
    };
    await createNovel(newNovel);
    await createChapter({
      id: Date.now().toString(),
      novelId: newNovelId,
      title: '第一章',
      content: '',
      order: 0,
      wordCount: 0,
      volumeName: '默认卷',
      createdAt: now,
      updatedAt: now
    });
    navigateToEditor(newNovel);
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-paper">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-xl font-serif italic text-gray-400"
        >
          InkFlow Starting...
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex bg-theme-bg text-theme-text overflow-hidden p-3 gap-3">
      <div className="shrink-0">
        <Sidebar 
          currentView={currentView} 
          onNavigate={setCurrentView} 
          user={user}
        />
      </div>
      
      <main className="flex-1 relative overflow-hidden bg-white rounded-2xl border border-theme-border shadow-sm flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden h-full"
          >
            {currentView === 'library' && (
              <Library onSelectNovel={navigateToEditor} userId={'local-user'} />
            )}
            {currentView === 'editor' && selectedNovel && (
              <EditorView novel={selectedNovel} onBack={() => setCurrentView('library')} />
            )}
            {currentView === 'world' && selectedNovel && (
              <WorldBibleView novel={selectedNovel} />
            )}
            {currentView === 'ai' && (
              <AIAssistant onCreateNovel={handleCreateNovelFromIdea} />
            )}
            {currentView === 'factory' && (
              <BookFactoryView />
            )}
            {currentView === 'skills' && (
              <SkillsStudioView />
            )}
            {currentView === 'editor' && !selectedNovel && (
              <div className="h-full flex flex-col items-center justify-center p-12 text-gray-400 bg-theme-bg/30 relative">
                <div className="w-32 h-32 bg-theme-sidebar/50 rounded-full flex items-center justify-center mb-6 border border-theme-border shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-theme-muted"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                </div>
                <h2 className="text-3xl font-serif font-bold text-theme-text mb-4">创作舞台暂未开启</h2>
                <p className="text-theme-muted mb-8 text-center max-w-md">您似乎还没有选择要编辑的作品。<br/>不同的作品对应独立的写作空间，请先前往「书库」创建或加载您的灵感结晶。</p>
                <button 
                  onClick={() => setCurrentView('library')}
                  className="px-8 py-4 bg-theme-accent text-white font-bold rounded-2xl hover:bg-theme-accent/90 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 16 16 12 12 8"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  前往书库
                </button>
              </div>
            )}
            {currentView === 'world' && !selectedNovel && (
              <div className="h-full flex flex-col items-center justify-center p-12 text-gray-400 bg-theme-bg/30 relative text-center">
                <div className="w-32 h-32 bg-theme-sidebar/50 rounded-full flex items-center justify-center mb-6 border border-theme-border shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-theme-muted"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                </div>
                <h2 className="text-3xl font-serif font-bold text-theme-text mb-4">设定集未关联</h2>
                <p className="text-theme-muted mb-8 max-w-md text-center">人物与设定集是与作品深度绑定的「数据库」。<br/>请先在书库中选择并进入一部作品，以开启其专属的世界圣经。</p>
                <button 
                  onClick={() => setCurrentView('library')}
                  className="px-8 py-4 bg-white border-2 border-theme-border text-theme-text font-bold rounded-2xl hover:border-theme-accent transition-all shadow-sm hover:shadow active:scale-95"
                >
                  返回书库选择作品
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
