/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Library } from './components/Library';
import { EditorView } from './components/EditorView';
import { CharacterHub } from './components/CharacterHub';
import { AIAssistant } from './components/AIAssistant';
import { ViewType, Novel } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { LogIn } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('library');
  const [selectedNovel, setSelectedNovel] = useState<Novel | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    }
  };

  const navigateToEditor = (novel: Novel) => {
    setSelectedNovel(novel);
    setCurrentView('editor');
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-paper">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-xl font-serif italic text-gray-400"
        >
          InkFlow...
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-sage-bg relative overflow-hidden text-sage-text">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sage-accent/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-sage-border rounded-full blur-3xl opacity-50" />
        </div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="z-10 text-center max-w-md px-6"
        >
          <h1 className="text-6xl font-serif font-medium mb-4 tracking-tight text-sage-accent">InkFlow</h1>
          <p className="text-sage-muted mb-12 text-lg italic">沉浸感、灵感、与创作。你的下一部长篇小说，从这里开始。</p>
          
          <button
            onClick={handleSignIn}
            className="group relative inline-flex items-center gap-3 px-8 py-4 bg-sage-accent text-white rounded-full font-medium transition-all hover:scale-105 active:scale-95 shadow-xl hover:shadow-2xl"
          >
            <LogIn size={20} />
            <span>开始创作之旅</span>
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex bg-sage-bg text-sage-text overflow-hidden">
      <Sidebar 
        currentView={currentView} 
        onNavigate={setCurrentView} 
        user={user}
      />
      
      <main className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.3 }}
            className="h-full"
          >
            {currentView === 'library' && (
              <Library onSelectNovel={navigateToEditor} userId={user.uid} />
            )}
            {currentView === 'editor' && selectedNovel && (
              <EditorView novel={selectedNovel} onBack={() => setCurrentView('library')} />
            )}
            {currentView === 'world' && selectedNovel && (
              <CharacterHub novelId={selectedNovel.id} />
            )}
            {currentView === 'ai' && (
              <AIAssistant />
            )}
            {currentView === 'editor' && !selectedNovel && (
              <div className="h-full flex items-center justify-center p-12 text-gray-400">
                <p>请先在书库中选择或创建一个作品</p>
              </div>
            )}
            {currentView === 'world' && !selectedNovel && (
              <div className="h-full flex items-center justify-center p-12 text-gray-400 text-center">
                <p>人物与设定集是针对特定作品的。<br/>请先在书库中选择并进入作品。</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
